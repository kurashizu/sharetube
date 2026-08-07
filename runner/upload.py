"""Upload the transcoded MP4 to the cf-share endpoint.

Mirrors the previous FastAPI upload flow: ``/api/upload/init`` returns
either a single PUT or a multipart plan; we drive that, then call
``/api/upload/complete`` and return the share URL + token + TTL.

``cfg.app_url`` is the cf-share base (default
``https://share.krsz.in``), kept separate from ``cfg.backend_url``
which is the sharetube Worker hosting this repo's API. They happen
to be different hosts in production.
"""
from __future__ import annotations

import base64
import json
import os
import urllib.error
import urllib.request
from dataclasses import dataclass
from pathlib import Path
from typing import Callable

from .config import Config


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


@dataclass
class UploadResult:
    share_url: str
    direct_url: str
    expires_at: int


def _maybe_admin_headers() -> dict[str, str]:
    user = os.environ.get("CF_SHARE_ADMIN_USER")
    pw = os.environ.get("CF_SHARE_ADMIN_PASS")
    if not user or not pw:
        return {}
    raw = f"{user}:{pw}".encode()
    return {"Authorization": "Basic " + base64.b64encode(raw).decode()}


# Cloudflare on the cf-share host 403s urllib's default UA
# (``Python-urllib/3.x``). Send a browser-ish UA on every request.
_UA = {"User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36"}


def _guess_content_type(filename: str) -> str:
    n = filename.lower()
    if n.endswith(".mp4"):
        return "video/mp4"
    if n.endswith(".m4v"):
        return "video/x-m4v"
    if n.endswith(".mkv"):
        return "video/x-matroska"
    if n.endswith(".webm"):
        return "video/webm"
    if n.endswith(".mov"):
        return "video/quicktime"
    return "application/octet-stream"


def _request(url: str, body, headers: dict, method: str = "POST") -> dict:
    if isinstance(body, (dict, list)):
        body_bytes = json.dumps(body).encode()
        headers = {**headers, "Content-Type": "application/json"}
    else:
        body_bytes = body
    req = urllib.request.Request(url, data=body_bytes, method=method, headers={**_UA, **headers})
    with urllib.request.urlopen(req, timeout=300) as r:
        ctype = r.headers.get("Content-Type", "")
        if "json" in ctype:
            return json.loads(r.read().decode())
        return {"_text": r.read(1024).decode("utf-8", errors="replace")}


def _capture_etag(url: str, body: bytes, headers: dict) -> str:
    """PUT to S3 and read the ETag header from the response."""
    req = urllib.request.Request(url, data=body, method="PUT", headers={**_UA, **headers})
    try:
        with urllib.request.urlopen(req, timeout=300) as r:
            return (r.headers.get("ETag") or "").strip().strip('"')
    except urllib.error.HTTPError as e:
        # urllib raises on 4xx/5xx, headers still readable.
        etag = (e.headers.get("ETag") or "").strip().strip('"')
        if etag:
            return etag
        raise


# Type aliases for the callbacks the web/worker never knew about.
ProgressCb = Callable[[float, str], None]
LogCb = Callable[[str], None]


def upload(
    src: Path,
    cfg: Config,
    on_log: LogCb,
    on_progress: ProgressCb,
    filename: str | None = None,
) -> UploadResult:
    headers = _maybe_admin_headers()
    on_log(f"Upload mode: {'admin' if headers else 'anonymous'}")

    size = src.stat().st_size
    filename = filename or src.name
    ctype = _guess_content_type(filename)
    ttl = max(300, min(7 * 24 * 60 * 60, int(cfg.job_cfg.ttl_seconds)))
    on_log(f"TTL: {ttl} s ({ttl // 3600}h{ttl % 3600 // 60:02d}m)")

    # ── 1. init ────────────────────────────────────────────────────────
    on_log(f"POST {cfg.app_url}/api/upload/init size={size} name={filename}")
    init = _request(
        f"{cfg.app_url}/api/upload/init",
        {"filename": filename, "size": size, "contentType": ctype, "ttl": ttl},
        headers,
    )
    mode = init["mode"]

    # ── 2. PUT (single or multipart) ──────────────────────────────────
    if mode == "single":
        put_url = init["url"]
        upload_id = init["uploadId"]
        key = init["key"]
        on_log(f"Mode: single PUT (url valid {init.get('expiresIn', '?')}s)")
        on_progress(0.0, f"Uploading {_fmt_bytes(size)}…")
        on_log(f"PUT {size:,} bytes → S3 (single PUT)")
        sent = 0
        last_pct = -1.0
        chunk_size = 1024 * 1024
        body_parts: list[bytes] = []
        with open(src, "rb") as f:
            while True:
                chunk = f.read(chunk_size)
                if not chunk:
                    break
                body_parts.append(chunk)
                sent += len(chunk)
                pct = sent / size * 100.0 if size else 100.0
                if pct - last_pct >= 1.0 or pct >= 100.0:
                    last_pct = pct
                    on_progress(min(100.0, pct), f"{pct:.0f}% {_fmt_bytes(sent)}/{_fmt_bytes(size)}")
        full_body = b"".join(body_parts)
        etag = _capture_etag(
            put_url, full_body,
            {**headers, "Content-Type": ctype, "Content-Length": str(size)},
        )
        if not etag:
            raise RuntimeError("S3 PUT returned no ETag header")
        on_progress(100.0, f"{_fmt_bytes(size)} uploaded")
        complete_body = {
            "uploadId": upload_id,
            "key": key,
            "filename": filename,
            "size": size,
            "contentType": ctype,
            "etag": etag,
            "ttl": ttl,
        }
    elif mode == "multipart":
        parts = init["parts"]
        total_parts = len(parts)
        upload_id = init["uploadId"]
        s3_upload_id = init["s3UploadId"]
        key = init["key"]
        on_log(f"Mode: multipart, {total_parts} parts × {init.get('partSize', '?')}B")
        data = src.read_bytes()
        sent = 0
        last_pct = -1.0
        completed: list[dict] = []
        for i, part in enumerate(parts, 1):
            chunk = data[: part["size"]]
            data = data[part["size"]:]
            on_log(f"PUT part {i}/{total_parts} ({len(chunk):,} bytes) → S3")
            etag = _capture_etag(
                part["url"], chunk,
                {**headers, "Content-Type": ctype, "Content-Length": str(len(chunk))},
            )
            if not etag:
                raise RuntimeError(f"part {i} PUT returned no ETag")
            completed.append({"partNumber": part["partNumber"], "etag": etag})
            sent += len(chunk)
            pct = sent / size * 100.0 if size else 100.0
            if pct - last_pct >= 1.0 or pct >= 100.0:
                last_pct = pct
                on_progress(
                    min(100.0, pct),
                    f"part {i}/{total_parts} ({_fmt_bytes(sent)}/{_fmt_bytes(size)})",
                )
        on_progress(100.0, f"{_fmt_bytes(size)} uploaded")
        complete_body = {
            "mode": "multipart",
            "uploadId": upload_id,
            "s3UploadId": s3_upload_id,
            "key": key,
            "filename": filename,
            "size": size,
            "contentType": ctype,
            "parts": completed,
            "ttl": ttl,
        }
    else:
        raise RuntimeError(f"unknown upload mode: {mode!r}")

    # ── 3. complete ────────────────────────────────────────────────────
    on_log("POST /api/upload/complete")
    comp = _request(
        f"{cfg.app_url}/api/upload/complete",
        complete_body,
        headers,
    )

    share_url = comp.get("fullUrl") or f"{cfg.app_url}/d/{comp['shareToken']}"
    return UploadResult(
        share_url=share_url,
        direct_url=f"{cfg.app_url}/api/download/{comp['shareToken']}",
        expires_at=comp["expiresAt"],
    )
