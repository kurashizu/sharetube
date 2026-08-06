"""Runner entry point. Run via ``python -m runner`` from the repo root.

Expected environment:

  Required:
    JOB_ID            uuid returned by the Worker on POST /api/jobs
    JOB_URL           the user-submitted URL (e.g. YouTube watch URL)
    JOB_CONFIG_JSON   JSON-encoded per-job settings (see web/.../types.ts)
    BACKEND_URL       Worker URL for the progress pushes
    INTERNAL_TOKEN    shared secret matching the Worker's INTERNAL_TOKEN

  Optional (with defaults baked into Config.from_env):
    COOKIES_PASS      passphrase; if absent we never pass --cookies
    VAAPI_DEVICE      /dev/dri/renderD128
    ENCODER_PRESET    medium
    FFMPEG_BIN        ffmpeg (PATH lookup)
    YTDLP_BIN         yt-dlp (PATH lookup)
"""
from __future__ import annotations

import asyncio
import json
import os
import sys
import tempfile
import traceback
from pathlib import Path

from . import backend, config, download, transcode, upload


REPO_ROOT = Path(os.environ.get("GITHUB_WORKSPACE", ".")).resolve()
ENCRYPTED_COOKIES = REPO_ROOT / "secrets" / "cookies.txt.enc"


def _maybe_decrypt_cookies() -> Path | None:
    """Decrypt ``secrets/cookies.txt.enc`` using $COOKIES_PASS into a
    temp file. Returns the temp file path on success, or None if the
    encrypted file isn't present / the passphrase is unset / the file
    decodes to empty bytes.

    The downloaded file is wiped after the pipeline returns.
    """
    if not ENCRYPTED_COOKIES.is_file():
        return None
    passphrase = os.environ.get("COOKIES_PASS", "").strip()
    if not passphrase:
        print("warning: COOKIES_PASS not set; skipping cookies", file=sys.stderr)
        return None
    out = Path(tempfile.gettempdir()) / "sharetube-cookies.txt"
    import subprocess
    try:
        proc = subprocess.run(
            [
                "openssl", "enc", "-d", "-aes-256-cbc", "-pbkdf2",
                "-iter", "200000",
                "-in", str(ENCRYPTED_COOKIES),
                "-out", str(out),
                "-pass", "env:COOKIES_PASS",
            ],
            env={**os.environ, "COOKIES_PASS": passphrase},
            check=True, capture_output=True, text=True,
        )
    except subprocess.CalledProcessError as e:
        print(f"warning: cookie decryption failed: {e.stderr.strip() or e}", file=sys.stderr)
        return None
    if not out.exists() or out.stat().st_size == 0:
        # Decryption succeeded but file is empty → user has no cookies.
        if out.exists():
            out.unlink(missing_ok=True)
        return None
    return out


async def run_pipeline() -> int:
    try:
        cfg = config.Config.from_env()
    except Exception as e:
        # Bootstrap a backend just to push a useful error before
        # dying. We don't have auth creds yet, so we read them
        # leniently from the env and skip the push if they're
        # missing.
        token = os.environ.get("INTERNAL_TOKEN", "").strip()
        url = os.environ.get("BACKEND_URL", "").strip()
        job_id = os.environ.get("JOB_ID", "").strip()
        print(f"Config error: {type(e).__name__}: {e}", file=sys.stderr)
        if token and url and job_id:
            import urllib.request
            req = urllib.request.Request(
                f"{url.rstrip('/')}/api/internal/update",
                data=json.dumps({"job_id": job_id, "status": "error", "error": f"config: {e}"}).encode(),
                method="POST",
                headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
            )
            try:
                urllib.request.urlopen(req, timeout=10).read()
            except Exception:
                pass
        return 1
    print(f"sharetube-runner {cfg.job_id}: {cfg.url}")

    be = backend.Backend(cfg.backend_url, cfg.internal_token, cfg.job_id)
    be.update_sync({"status": "running"})

    cookies_path: Path | None = None
    if cfg.job_cfg.use_cookies:
        cookies_path = _maybe_decrypt_cookies()
        if cookies_path:
            be.log([f"decrypted cookies → {cookies_path} ({cookies_path.stat().st_size} bytes)"])
        else:
            be.log(["use_cookies requested but no usable decrypted file; skipping"])
    # Else: leave as None → download module skips --cookies.

    tmpdir = Path(tempfile.mkdtemp(prefix="sharetube-"))
    try:
        # ── 1. download ─────────────────────────────────────────────
        be.log([f"tmpdir: {tmpdir}"])
        dl = download.download(cfg.url, tmpdir, cfg, be, cookies_path=cookies_path)
        be.log([f"downloaded: {dl.path} ({dl.path.stat().st_size:,} bytes)"])
        be.update_sync({
            "phase": "Download",
            "download_pct": 100,
            "meta": f"{dl.path.stat().st_size:,} bytes"
        })

        # ── 2. transcode ───────────────────────────────────────────
        out_mp4 = tmpdir / "out.mp4"
        tx_mod = transcode.transcode(dl.path, out_mp4, cfg, be)
        be.log([f"transcoded: {tx_mod.path} ({tx_mod.path.stat().st_size:,} bytes)"])
        be.update_sync({
            "phase": "Transcode",
            "transcode_pct": 100,
            "meta": f"{tx_mod.path.stat().st_size:,} bytes"
        })

        # ── 3. upload ──────────────────────────────────────────────
        def _upload_progress(pct: float, meta: str) -> None:
            be.update_sync({
                "phase": "Upload",
                "upload_pct": pct,
                "meta": meta,
            })

        up_res = upload.upload(
            tx_mod.path,
            cfg,
            on_log=lambda m: be.log([m]),
            on_progress=_upload_progress,
            filename=dl.path.name,
        )

        # Final: status=done + share URL.
        be.update_sync({
            "status": "done",
            "upload_pct": 100,
            "share_url": up_res.share_url,
            "direct_url": up_res.direct_url,
            "expires_at": up_res.expires_at,
        })
        be.log([
            "",
            f"✓ Share URL: {up_res.share_url}",
            f"  Direct:    {up_res.direct_url}",
            f"  Expires:   {up_res.expires_at}",
        ])
        return 0

    except Exception as e:  # noqa: BLE001
        be.log([f"✗ {type(e).__name__}: {e}"])
        be.update_sync({"status": "error", "error": str(e)[:2000]})
        traceback.print_exc()
        return 1
    finally:
        await be.close()
        # Wipe tmpdir; keep cookies file (small).
        import shutil
        shutil.rmtree(tmpdir, ignore_errors=True)
        if cookies_path and cookies_path.exists():
            cookies_path.unlink(missing_ok=True)


if __name__ == "__main__":
    sys.exit(asyncio.run(run_pipeline()))
