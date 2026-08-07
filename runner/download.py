"""yt-dlp wrapper.

Drains stderr on a background thread (so it can never deadlock the
stdout reader); routes each progress / log / error line to the
backend push client. Cookies — when ``use_cookies`` is on and the
decrypted file exists — are passed via ``--cookies <path>``.

Three client-set attempts are tried in sequence to handle YouTube's
SABR / PO Token failures; partial output files are wiped between
retries so the final-path glob doesn't pick up a previous attempt.
"""
from __future__ import annotations

import os
import re
import shutil
import subprocess
import threading
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

from .backend import Backend, JobCancelled
from .config import Config

_PROGRESS_TEMPLATE = (
    # Structured progress line. Uses yt-dlp's stable progress-template
    # API fields (numerical, not the human-readable "1.2MiB/s ETA 00:30"
    # text that changes between releases):
    #   downloaded_bytes / total_bytes   (int)
    #   progress.speed                   (float bytes/s, NA when unknown)
    #   progress.eta                     (float seconds, NA when unknown)
    # We render our own human-friendly string server-side.
    "download: %(progress.downloaded_bytes)s/%(progress.total_bytes)s "
    "speed=%(progress.speed)s eta=%(progress.eta)s"
)


def _fmt_bytes(n) -> str:
    if n is None or n < 0:
        return ""
    if n < 1024:
        return f"{int(n)} B"
    if n < 1024 * 1024:
        return f"{n / 1024:.1f} KB"
    if n < 1024 * 1024 * 1024:
        return f"{n / 1024 / 1024:.1f} MB"
    return f"{n / 1024 / 1024 / 1024:.2f} GB"


def _fmt_speed(bps: float | None) -> str:
    """bytes/sec → '1.46 MiB/s'."""
    if not bps or bps <= 0:
        return ""
    return f"{_fmt_bytes(bps)}/s"


# Lines worth surfacing in the user log. yt-dlp's full stderr is
# otherwise too chatty (network retries, format probes, etc.).
_KEEP_RE = re.compile(
    r"^(?:\[(?:youtube|generic)\]|Destination:|\[Merger\]|\[ExtractAudio\]|"
    r"ERROR: |WARNING: |\[error\])"
)


@dataclass
class DownloadResult:
    path: Path
    title: str


def _run_once(
    url: str,
    outdir: Path,
    cfg: Config,
    extra_args: list[str],
    backend: Backend,
) -> DownloadResult:
    out_template = str(outdir / "%(title).150B-[%(id)s].%(ext)s")
    n = cfg.job_cfg.max_resolution.rstrip("p")
    sort_res = "res" if cfg.job_cfg.max_resolution == "best" else f"res:{n}"

    cmd = [
        cfg.ytdlp_bin,
        "--newline",
        "--no-part",
        "-o", out_template,
        *(["--proxy", cfg.proxy_url] if cfg.proxy_url else []),
        "-S", f"vcodec:h264,vcodec:vp9,vcodec:hevc,{sort_res}",
        "-f",
        "(bv*[vcodec^=avc1]+ba)/"
        "(bv*[vcodec=vp9]+ba)/"
        "(bv*[vcodec=hevc]+ba)/"
        "b[vcodec^=avc1][ext=mp4]/"
        "b[vcodec=h264]/b",
        "--merge-output-format", "mp4",
        "--progress-template", _PROGRESS_TEMPLATE,
        # Capture the friendly title into a file during the same run —
        # avoids a second resolve (slow over the proxy) just for the
        # title.
        "--print-to-file", "%(title)s", str(outdir / "title.txt"),
        *extra_args,
        url,
    ]

    # yt-dlp spends several seconds resolving the URL (webpage, player
    # API, JS challenge) before any progress line appears — tell the
    # user it's working so the UI doesn't look frozen.
    backend.log(["Resolving video info…"])

    proc = subprocess.Popen(
        cmd,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        bufsize=1,
        start_new_session=True,
    )

    stderr_log_buffer: list[str] = []
    # RLock so _flush_log_buffer() can be called from inside the lock
    # in _drain_stderr without deadlocking.
    stderr_log_lock = threading.RLock()

    def _flush_log_buffer() -> None:
        with stderr_log_lock:
            if not stderr_log_buffer:
                return
            backend.log(stderr_log_buffer)
            stderr_log_buffer.clear()

    def _drain_stderr() -> None:
        assert proc.stderr is not None
        for ln in proc.stderr:
            stripped = ln.rstrip()
            if _KEEP_RE.match(stripped):
                # Stream promptly: one batch per line so the UI shows
                # progress during yt-dlp's pre-download resolution
                # (webpage/player API fetches) instead of buffering 20
                # lines and dumping them all at once.
                with stderr_log_lock:
                    stderr_log_buffer.append(stripped)
                    if len(stderr_log_buffer) >= 4:
                        _flush_log_buffer()
        _flush_log_buffer()

    t = threading.Thread(target=_drain_stderr, name="ytdlp-stderr", daemon=True)
    t.start()

    final_path: Optional[Path] = None
    smoothed_speed: Optional[float] = None
    # Structured progress line (see _PROGRESS_TEMPLATE):
    #   download: 1024/1128375 speed=1188644.08 eta=0
    # Also tolerated (older/newer yt-dlp without progress-template
    # support): "download: 45.2% speed=1.2MiB/s eta=00:30 of=12345"
    dl_re = re.compile(r"^\s*(?:download:\s*)?(\d+)\s*/(\d+|NA)\s+speed=([^\s]+)\s+eta=([^\s]+)")
    pct_re = re.compile(r"^\s*(?:download:\s*)?([\d.]+)%")
    speed_re = re.compile(r"speed=([^\s]+)")
    eta_re = re.compile(r"eta=([^\s]+)")
    of_re = re.compile(r"of=(\S+)")
    assert proc.stdout is not None
    for line in proc.stdout:
        line = line.rstrip()
        if not line:
            continue
        # User force-stop: kill the subprocess promptly.
        try:
            backend.raise_if_cancelled()
        except JobCancelled:
            try:
                proc.kill()
            except Exception:
                pass
            raise
        m = dl_re.match(line)
        if m:
            # Numerical progress line.
            try:
                dl = int(m.group(1))
            except ValueError:
                dl = 0
            total_raw = m.group(2)
            total = int(total_raw) if total_raw != "NA" else 0
            speed_raw = m.group(3)
            eta_raw = m.group(4)
            try:
                speed_bps = float(speed_raw) if speed_raw != "NA" else 0.0
            except ValueError:
                speed_bps = 0.0
            try:
                eta_s = float(eta_raw) if eta_raw != "NA" else 0.0
            except ValueError:
                eta_s = 0.0

            # Raw yt-dlp speed/eta jitter a lot (380 KB/s then 17 MB/s
            # within a second) — the UI would flicker wildly. Smooth the
            # speed with an exponential moving average and recompute ETA
            # from the smoothed value so both stay stable.
            if speed_bps > 0:
                if smoothed_speed is None:
                    smoothed_speed = speed_bps
                else:
                    smoothed_speed += (speed_bps - smoothed_speed) * 0.35
            pct = (dl / total * 100.0) if total > 0 else 0.0
            parts = []
            if smoothed_speed and smoothed_speed > 0:
                parts.append(_fmt_speed(smoothed_speed))
                if total > dl > 0:
                    rem = total - dl
                    eta_s = rem / smoothed_speed
                    if eta_s >= 1:
                        parts.append(f"ETA {int(eta_s)}s")
            if total > 0:
                parts.append(_fmt_bytes(total))
            meta = " ".join(parts)
            backend.push_progress("Download", pct, meta)
            continue
        m = pct_re.match(line)
        if m:
            try:
                pct = float(m.group(1))
            except ValueError:
                continue
            sm = speed_re.search(line)
            em = eta_re.search(line)
            om = of_re.search(line)
            speed = sm.group(1) if sm and sm.group(1) != "NA" else ""
            eta = em.group(1) if em and em.group(1) != "NA" else ""
            try:
                size = _fmt_bytes(int(om.group(1))) if om and om.group(1) != "NA" else ""
            except (ValueError, TypeError):
                size = ""
            meta = " ".join(p for p in [speed, eta, size] if p)
            backend.push_progress("Download", pct, meta)
            continue
        if _KEEP_RE.match(line):
            # yt-dlp emits resolution lines ('[youtube] Downloading
            # webpage', 'player API JSON', …) on stdout. Flush them
            # immediately so the UI streams instead of buffering them
            # all until the download finishes.
            with stderr_log_lock:
                stderr_log_buffer.append(line)
            _flush_log_buffer()
        if line.startswith("[Merger] Merging formats into ") or line.startswith("Destination:"):
            try:
                fname = line.rsplit('"', 2)[-2]
                final_path = outdir / fname
            except IndexError:
                pass

    # Download stream complete; yt-dlp may still be merging audio/
    # video / post-processing, which emits no stdout progress. Push a
    # status log so the UI shows activity instead of stalling at 100%.
    backend.log(["Download stream complete — merging & post-processing…"])
    rc = proc.wait(timeout=3600)
    t.join(timeout=5)
    if rc != 0:
        # Drain remaining stderr to capture the failure tail.
        try:
            tail = (proc.stderr.read() if proc.stderr else "")[-2000:]
        except Exception:
            tail = ""
        raise RuntimeError(f"yt-dlp exited with code {rc}\n--- tail ---\n{tail}")
    if final_path is None or not final_path.exists():
        candidates = sorted(outdir.iterdir(), key=lambda p: p.stat().st_mtime)
        if not candidates:
            raise RuntimeError("yt-dlp produced no output file")
        final_path = candidates[-1]

    # Friendly title written by --print-to-file during the same run.
    title = ""
    try:
        tp = outdir / "title.txt"
        if tp.exists():
            title = tp.read_text(encoding="utf-8", errors="replace").strip()
    except Exception:
        pass
    if not title:
        title = final_path.stem
        # Strip the "-[videoId]" suffix the output template appends.
        idx = title.rfind("-")
        if idx != -1:
            title = title[:idx]
    return DownloadResult(path=final_path, title=title)


def download(
    url: str,
    outdir: Path,
    cfg: Config,
    backend: Backend,
    cookies_path: Optional[Path] = None,
) -> DownloadResult:
    """Download `url` into `outdir`, pushing progress to `backend`."""
    ytdlp_bin = shutil.which(cfg.ytdlp_bin) or cfg.ytdlp_bin
    try:
        ver = subprocess.run(
            [ytdlp_bin, "--version"], capture_output=True, text=True, timeout=10
        ).stdout.strip()
    except Exception as e:  # noqa: BLE001
        ver = f"unknown ({e})"
    backend.log([f"yt-dlp: {ytdlp_bin} ({ver})"])
    outdir.mkdir(parents=True, exist_ok=True)

    user_args = os.environ.get("CF_SHARE_YTDLP_ARGS", "").split()

    # Cookies: only when we successfully decrypted one above.
    cookies_arg: list[str] = []
    if cookies_path and cookies_path.is_file() and cookies_path.stat().st_size > 0:
        cookies_arg = ["--cookies", str(cookies_path)]
        backend.log([f"using cookies: {cookies_path}"])
    else:
        backend.log(["no cookies (some videos may trip the bot wall)"])

    # Wipe stale output from previous attempts.
    for p in outdir.iterdir():
        if p == cookies_path:
            continue
        try:
            p.unlink()
        except Exception:
            pass

    attempts = [
        ("default", [*cookies_arg, *user_args]),
        ("tv,web,ios,android_vr", [
            "--extractor-args", "youtube:player_client=tv,web,ios,android_vr",
            *cookies_arg, *user_args,
        ]),
        ("mweb,web_creator", [
            "--extractor-args", "youtube:player_client=mweb,web_creator",
            *cookies_arg, *user_args,
        ]),
    ]

    last_err: Optional[Exception] = None
    for label, extra in attempts:
        backend.log([f"attempt: client_set={label}"])
        try:
            return _run_once(url, outdir, cfg, extra, backend)
        except Exception as e:  # noqa: BLE001
            last_err = e
            first = str(e).splitlines()[0] if str(e) else ""
            backend.log([f"attempt {label!r} failed: {type(e).__name__}: {first}"])
            for p in outdir.iterdir():
                if p == cookies_path:
                    continue
                try:
                    p.unlink()
                except Exception:
                    pass
            continue
    assert last_err is not None
    raise last_err
