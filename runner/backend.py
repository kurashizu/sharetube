"""Background progress push client (stdlib-only).

The runner never blocks the pipeline on a single push; we run a small
worker thread that drains a queue of payloads. That keeps stderr /
stdout drains on the main thread non-blocking even when the Worker is
slow. Failures are logged and dropped — the next successful push (a
few ms later usually) reconciles state.

Bounded concurrency (one worker) keeps memory low even when yt-dlp is
emitting 50 lines/second during a download.
"""
from __future__ import annotations

import json
import logging
import threading
import time
import urllib.error
import urllib.request
from queue import Queue
from typing import Iterable

logger = logging.getLogger("sharetube.runner")

MAX_LOG_LINES = 50         # batched per call
PUSH_INTERVAL_S = 0.05     # min interval between background pushes (50ms)


class Backend:
    """Synchronous-feeling client used from the runner's main path."""

    def __init__(self, base_url: str, internal_token: str, job_id: str):
        self._url = base_url.rstrip("/")
        self._token = internal_token
        self._job_id = job_id
        self._queue: Queue = Queue(maxsize=2000)
        self._closed = False
        self._last_push_at = 0.0
        self._lock = threading.Lock()
        self._cancelled = False
        self._worker = threading.Thread(
            target=self._drain, name="sharetube-push", daemon=True
        )
        self._worker.start()

    # ── public API ────────────────────────────────────────────────────

    def update_sync(self, payload: dict) -> None:
        """Synchronous push. Used at well-defined checkpoints (start of
        a phase, end of a phase, terminal done/error)."""
        self._send(dict(payload, job_id=self._job_id))

    def push_progress(self, phase: str, pct: float, meta: str = "") -> None:
        """Hot-path async push used inside download/transcode/upload
        callbacks. Goes through the worker thread."""
        pct = max(0.0, min(100.0, float(pct)))
        payload: dict = {
            "status": "running",
            "phase": phase,
            "meta": meta,
        }
        if phase == "Download":
            payload["download_pct"] = pct
        elif phase == "Transcode":
            payload["transcode_pct"] = pct
        elif phase == "Upload":
            payload["upload_pct"] = pct
        self._enqueue(payload)

    def log(self, lines: Iterable[str]) -> None:
        """Append log lines server-side. Caller batches so each push
        body stays small."""
        chunk = [ln for ln in lines if isinstance(ln, str)]
        if not chunk:
            return
        self._enqueue({"append_log": chunk[:MAX_LOG_LINES]})

    def close(self, drain_timeout: float = 5.0) -> None:
        """Stop accepting new payloads and drain the queue one last
        time. Called from the runner's finally block."""
        self._closed = True
        # Queue the shutdown sentinel directly on the queue — the
        # worker thread drains it and exits. (Sending it through
        # _enqueue would hit the "closed" branch and send an empty
        # API payload, causing HTTP 400.)
        try:
            self._queue.put_nowait(_SHUTDOWN_SENTINEL)
        except Exception:
            pass
        self._worker.join(timeout=drain_timeout)
        # Anything still left is dropped; the next push in a future
        # job (or via direct update_sync) will catch up.

    def raise_if_cancelled(self) -> None:
        """Raise JobCancelled if the user force-stopped this job.

        The server returns `cancelled: 1` on update responses; the
        worker thread records it here. The pipeline calls this at
        phase boundaries / progress callbacks so a force-stop takes
        effect within a couple of seconds.
        """
        if self._cancelled:
            raise JobCancelled()

    # ── internals ─────────────────────────────────────────────────────

    def _enqueue(self, payload: dict) -> None:
        if payload is _SHUTDOWN_SENTINEL:
            # Internal control signal for the worker thread — never an
            # API payload. close() queues it directly; nothing sends it
            # here.
            return
        if self._closed:
            # After close: still allow direct update_sync to go through.
            if payload.get("_sync"):
                self._send({k: v for k, v in payload.items() if not k.startswith("_")})
            return
        # Bypass the worker if the queue is overflowing (it'd back up
        # callbacks). Fall back to a synchronous push.
        try:
            self._queue.put_nowait(payload)
        except Exception:
            self._send(dict(payload, job_id=self._job_id))

    def _drain(self) -> None:
        while True:
            item = self._queue.get()
            if item is _SHUTDOWN_SENTINEL:
                self._queue.task_done()
                return
            with self._lock:
                # Honor a small inter-push delay so a chatty stderr
                # doesn't flood the Worker.
                wait = PUSH_INTERVAL_S - (time.monotonic() - self._last_push_at)
                if wait > 0:
                    time.sleep(wait)
            try:
                self._send(dict(item, job_id=self._job_id))
            except Exception as e:  # noqa: BLE001
                logger.warning("push failed: %s", e)
            finally:
                self._last_push_at = time.monotonic()
                self._queue.task_done()

    def _send(self, payload: dict) -> None:
        url = f"{self._url}/api/internal/update"
        body = json.dumps(payload).encode("utf-8")
        req = urllib.request.Request(
            url,
            data=body,
            method="POST",
            headers={
                "Authorization": f"Bearer {self._token}",
                "Content-Type": "application/json",
                "User-Agent": "sharetube-runner/0.1",
            },
        )
        try:
            with urllib.request.urlopen(req, timeout=20) as r:
                if r.status >= 400:
                    content = r.read(300).decode("utf-8", errors="replace")
                    logger.warning(
                        "update → %s: %s; body=%s",
                        r.status, r.reason, content,
                    )
                    return
                try:
                    resp = json.loads(r.read().decode("utf-8", errors="replace"))
                    if resp.get("cancelled"):
                        self._cancelled = True
                except Exception:  # noqa: BLE001
                    pass
        except Exception as e:  # noqa: BLE001
            # urllib raises HTTPError for 4xx/5xx; log and continue.
            logger.warning("update → %s", e)


class JobCancelled(Exception):
    """Raised inside the pipeline when the user force-stops the job."""


_SHUTDOWN_SENTINEL: dict = {"_sync": True, "_shutdown": True}
