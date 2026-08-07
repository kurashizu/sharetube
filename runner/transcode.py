"""ffmpeg h264 transcoder, VAAPI when available, libx264 fallback.

The runner is invoked on GitHub-hosted runners which have NO GPU,
so we default to ``libx264``. When ``$VAAPI_DEVICE`` exists on the
runner host (self-hosted), we use ``h264_vaapi`` for ~4× speedup.
"""
from __future__ import annotations

import json
import re
import shutil
import subprocess
import threading
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

from .backend import Backend, JobCancelled
from .config import Config

_OUT_TIME_RE = re.compile(r"out_time_ms=(\d+)")
_SPEED_RE = re.compile(r"speed=\s*([\d.]+)x")


@dataclass
class TranscodeResult:
    path: Path


# ── ffprobe helpers ────────────────────────────────────────────────────


def _probe_json(args: list[str], timeout: float = 15.0):
    try:
        proc = subprocess.run(
            args, capture_output=True, text=True, check=True, timeout=timeout
        )
    except Exception:
        return None
    try:
        return json.loads(proc.stdout)
    except Exception:
        return None


def _probe_duration(src: Path) -> float:
    proc = subprocess.run(
        [
            "ffprobe", "-v", "error",
            "-show_entries", "format=duration",
            "-of", "default=noprint_wrappers=1:nokey=1",
            str(src),
        ],
        capture_output=True, text=True, check=True,
    )
    return float(proc.stdout.strip())


def probe_video_bitrate(src: Path) -> Optional[int]:
    proc = subprocess.run(
        [
            "ffprobe", "-v", "error",
            "-select_streams", "v:0",
            "-show_entries", "stream=bit_rate",
            "-of", "default=noprint_wrappers=1:nokey=1",
            str(src),
        ],
        capture_output=True, text=True, check=True, timeout=15,
    )
    val = proc.stdout.strip()
    if val and val != "N/A":
        return int(val) // 1000
    data = _probe_json([
        "ffprobe", "-v", "error",
        "-show_entries", "format=duration,size",
        "-of", "json",
        str(src),
    ])
    if not data:
        return None
    dur = float(data.get("format", {}).get("duration", 0))
    size = int(data.get("format", {}).get("size", 0))
    if dur > 0 and size > 0:
        return int(size * 8 / dur / 1000)
    return None


def probe_video_height(src: Path) -> Optional[int]:
    proc = subprocess.run(
        [
            "ffprobe", "-v", "error",
            "-select_streams", "v:0",
            "-show_entries", "stream=height",
            "-of", "default=noprint_wrappers=1:nokey=1",
            str(src),
        ],
        capture_output=True, text=True, check=True, timeout=15,
    )
    val = proc.stdout.strip()
    return int(val) if val and val != "N/A" else None


def _parse_bitrate(s: str) -> int:
    s = s.strip()
    if s.lower().endswith("m"):
        return int(float(s[:-1]) * 1000)
    if s.lower().endswith("k"):
        return int(float(s[:-1]))
    return int(float(s) / 1000)


def _find_cjk_font() -> Optional[str]:
    for p in (
        # Cached in ~/.local/share/fonts by the workflow (frozen cache)
        str(Path.home() / ".local" / "share" / "fonts" / "NotoSansCJK-Regular.ttc"),
        str(Path.home() / ".local" / "share" / "fonts" / "NotoSansCJK-Bold.ttc"),
        # Ubuntu 24.04 (GH ubuntu-latest) — fonts-noto-cjk package
        "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
        "/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc",
        # Arch / Manjaro
        "/usr/share/fonts/noto-cjk/NotoSansCJK-Regular.ttc",
        "/usr/share/fonts/noto-cjk/NotoSansCJK-Bold.ttc",
        "/usr/share/fonts/google-noto-cjk/NotoSansCJK-Regular.ttc",
        # Generic Noto / DejaVu fallbacks (ASCII-only glyphs)
        "/usr/share/fonts/noto/NotoSans-Regular.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    ):
        if Path(p).exists():
            return p
    # Last resort: ask fontconfig for any usable face.
    try:
        out = subprocess.run(
            ["fc-match", "-f", "%{file}", "sans-serif"],
            capture_output=True, text=True, timeout=5,
        ).stdout.strip()
        if out and Path(out).exists():
            return out
    except Exception:  # noqa: BLE001
        pass
    return None


def _escape_drawtext(text: str) -> str:
    text = text.replace("\n", "\\n")
    text = text.replace(":", "\\:")
    text = text.replace("%", "%%")
    return text


def _format_watermark(cfg: Config, src: Path) -> tuple[str, str]:
    info: dict[str, str] = {}
    data = _probe_json([
        "ffprobe", "-v", "error",
        "-show_entries",
        "format=duration,size:stream=codec_type,codec_name,width,height,bit_rate",
        "-of", "json",
        str(src),
    ])
    if data:
        fmt = data.get("format", {})
        streams = data.get("streams", [])
        video = next((s for s in streams if s.get("codec_type") == "video"), {})
        dur = float(fmt.get("duration", 0))
        m, s = divmod(int(dur), 60)
        h, m = divmod(m, 60)
        info["duration"] = f"{h}h{m:02d}m{s:02d}s" if h else f"{m}m{s:02d}s"
        w = video.get("width", 0)
        h_px = video.get("height", 0)
        info["resolution"] = f"{w}x{h_px}" if w and h_px else ""
        info["codec"] = (video.get("codec_name") or "").upper()
        vbr = video.get("bit_rate")
        info["bitrate"] = f"{int(vbr) // 1000}k" if vbr else ""
        info["title"] = (
            src.stem.split("[")[0].rstrip(" -_").strip()
            if "[" in src.stem else src.stem
        )
    line1 = cfg.job_cfg.watermark_line1
    try:
        line2 = cfg.job_cfg.watermark_line2.format(**info)
    except KeyError:
        line2 = cfg.job_cfg.watermark_line2
    return line1, line2


def _build_cmd(
    src: Path,
    dst: Path,
    cfg: Config,
    source_bitrate_kbps: Optional[int],
    effective_resolution: str,
    use_watermark: bool,
    font: Optional[str],
    use_vaapi: bool,
) -> list[str]:
    cfg_kbps = _parse_bitrate(cfg.job_cfg.video_bitrate)
    if source_bitrate_kbps and source_bitrate_kbps > 0:
        vbr_kbps = min(cfg_kbps, source_bitrate_kbps)
    else:
        vbr_kbps = cfg_kbps
    effective_bitrate = f"{vbr_kbps}k"
    maxrate_str = f"{max(vbr_kbps, int(vbr_kbps * 1.25))}k"
    bufsize_str = f"{max(vbr_kbps * 2, 4000)}k"

    if use_watermark:
        line1, line2 = _format_watermark(cfg, src)
        fs = cfg.job_cfg.watermark_font_size
        vf_parts = []
        if line1:
            esc1 = _escape_drawtext(line1)
            vf_parts.append(
                f"drawtext=fontfile='{font}':text='{esc1}':"
                f"fontsize={fs}:fontcolor=white:"
                f"shadowx=2:shadowy=2:shadowcolor=black@0.6:"
                f"x=10:y=10:"
                f"box=1:boxcolor=black@0.4:boxborderw=6"
            )
        if line2:
            esc2 = _escape_drawtext(line2)
            vf_parts.append(
                f"drawtext=fontfile='{font}':text='{esc2}':"
                f"fontsize={fs}:fontcolor=white:"
                f"shadowx=2:shadowy=2:shadowcolor=black@0.6:"
                f"x=10:y=h-th-10:"
                f"box=1:boxcolor=black@0.4:boxborderw=6"
            )
        if effective_resolution != "source":
            h = effective_resolution.rstrip("p")
            vf_parts.append(f"scale=-2:{h}")
        vf = ",".join(vf_parts)
        return [
            cfg.ffmpeg_bin, "-hide_banner", "-y",
            "-i", str(src),
            "-vf", vf,
            "-c:v", "libx264", "-preset", cfg.encoder_preset,
            "-b:v", effective_bitrate,
            "-maxrate", maxrate_str, "-bufsize", bufsize_str,
            "-c:a", "aac", "-b:a", cfg.job_cfg.audio_bitrate,
            "-movflags", "+faststart",
            "-progress", "pipe:1", "-nostats",
            str(dst),
        ]

    if use_vaapi:
        vf_parts = ["format=vaapi"]
        if effective_resolution != "source":
            h = effective_resolution.rstrip("p")
            vf_parts.append(f"scale_vaapi=-2:{h}:mode=fast")
        vf = ",".join(vf_parts)
        return [
            cfg.ffmpeg_bin,
            "-hide_banner", "-y",
            "-vaapi_device", cfg.vaapi_device,
            "-hwaccel", "vaapi",
            "-hwaccel_output_format", "vaapi",
            "-i", str(src),
            "-vf", vf,
            "-c:v", "h264_vaapi",
            "-rc_mode", "VBR",
            "-b:v", effective_bitrate,
            "-maxrate", maxrate_str,
            "-bufsize", bufsize_str,
            "-c:a", "aac",
            "-b:a", cfg.job_cfg.audio_bitrate,
            "-movflags", "+faststart",
            "-progress", "pipe:1",
            "-nostats",
            str(dst),
        ]

    # CPU software path (default on GH runners).
    vf_parts = []
    if effective_resolution != "source":
        h = effective_resolution.rstrip("p")
        vf_parts.append(f"scale=-2:{h}")
    vf = ",".join(vf_parts) if vf_parts else None
    cmd = [
        cfg.ffmpeg_bin,
        "-hide_banner", "-y",
        "-i", str(src),
    ]
    if vf:
        cmd += ["-vf", vf]
    cmd += [
        "-c:v", "libx264", "-preset", cfg.encoder_preset,
        "-b:v", effective_bitrate,
        "-maxrate", maxrate_str, "-bufsize", bufsize_str,
        "-c:a", "aac", "-b:a", cfg.job_cfg.audio_bitrate,
        "-movflags", "+faststart",
        "-progress", "pipe:1", "-nostats",
        str(dst),
    ]
    return cmd


def transcode(
    src: Path,
    dst: Path,
    cfg: Config,
    backend: Backend,
) -> TranscodeResult:
    if shutil.which(cfg.ffmpeg_bin) is None:
        raise RuntimeError("ffmpeg not on PATH")
    if shutil.which("ffprobe") is None:
        raise RuntimeError("ffprobe not on PATH")

    use_vaapi = Path(cfg.vaapi_device).exists()
    if use_vaapi:
        backend.log([f"Transcoding: VAAPI device={cfg.vaapi_device}"])
    else:
        backend.log([f"Transcoding: software libx264 (no GPU at {cfg.vaapi_device})"])

    duration_s = _probe_duration(src)
    backend.log([f"Source duration: {duration_s:.1f}s"])
    src_height = probe_video_height(src)
    src_kbps = probe_video_bitrate(src)
    if src_kbps:
        backend.log([f"Source video bitrate: {src_kbps} kbps"])
    if src_height:
        backend.log([f"Source resolution: {src_height}p"])

    effective_resolution = cfg.job_cfg.output_resolution
    if src_height and effective_resolution != "source":
        target_h = int(effective_resolution.rstrip("p"))
        if target_h > src_height:
            backend.log([
                f"Capping resolution: {effective_resolution} → source ({src_height}p, no upscale)"
            ])
            effective_resolution = "source"

    use_watermark = cfg.job_cfg.watermark_enabled
    font = _find_cjk_font() if use_watermark else None
    if use_watermark and not font:
        # Watermark is the default behaviour; never silently drop it.
        # Missing font is a hard error so the CI install step can't be
        # forgotten again.
        raise RuntimeError("watermark enabled but no usable font found")
    if use_watermark:
        backend.log([f"watermark font: {font}"])

    cmd = _build_cmd(
        src, dst, cfg, src_kbps, effective_resolution,
        use_watermark=use_watermark, font=font, use_vaapi=use_vaapi,
    )
    backend.log(["$ " + " ".join(cmd)])

    proc = subprocess.Popen(
        cmd,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        bufsize=1,
        start_new_session=True,
    )

    stderr_buf: list[str] = []

    def _drain_stderr() -> None:
        assert proc.stderr is not None
        for ln in proc.stderr:
            line = ln.rstrip()
            if line:
                stderr_buf.append(f"[ffmpeg] {line}")
                if len(stderr_buf) >= 30:
                    backend.log(stderr_buf)
                    stderr_buf.clear()
        if stderr_buf:
            backend.log(stderr_buf)
            stderr_buf.clear()

    t = threading.Thread(target=_drain_stderr, name="ffmpeg-stderr", daemon=True)
    t.start()

    last_speed: float = 0.0
    assert proc.stdout is not None
    for line in proc.stdout:
        line = line.rstrip()
        if not line:
            continue
        # User force-stop: kill the ffmpeg subprocess promptly.
        try:
            backend.raise_if_cancelled()
        except JobCancelled:
            try:
                proc.kill()
            except Exception:
                pass
            raise
        m = _OUT_TIME_RE.match(line)
        if m:
            current_us = int(m.group(1))
            pct = min(100.0, (current_us / 1_000_000) / duration_s * 100)
            meta = f"speed={last_speed:.2f}x" if last_speed else ""
            backend.push_progress("Transcode", pct, meta)
            continue
        sm = _SPEED_RE.match(line)
        if sm:
            try:
                last_speed = float(sm.group(1))
            except ValueError:
                pass

    rc = proc.wait(timeout=3600)
    t.join(timeout=5)
    if rc != 0:
        raise RuntimeError(f"ffmpeg exited with code {rc}")
    if not dst.exists() or dst.stat().st_size == 0:
        raise RuntimeError("ffmpeg produced no output file")
    backend.log([f"Transcode done: {dst} ({dst.stat().st_size:,} bytes)"])
    return TranscodeResult(path=dst)
