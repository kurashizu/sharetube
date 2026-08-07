"""Environment-driven configuration for the runner.

All inputs come from GitHub Actions `env:` (which itself pulls from
repo secrets + the dispatch payload). The runner is stateless: every
run is fully specified upfront so it can be replayed / audited.
"""
from __future__ import annotations

import json
import os
from dataclasses import dataclass


def _require(name: str) -> str:
    val = os.environ.get(name)
    if not val:
        raise RuntimeError(f"required env var missing: {name}")
    return val


def _opt(name: str, default: str) -> str:
    val = os.environ.get(name)
    return val if val else default


# Defaults mirrored from web/src/lib/stores/config.svelte.ts so a
# dispatch without those fields still has a sensible value.
DEFAULT_VIDEO_BITRATE = "600k"
DEFAULT_AUDIO_BITRATE = "128k"
DEFAULT_VAAPI_DEVICE = "/dev/dri/renderD128"
DEFAULT_ENCODER_PRESET = "ultrafast"
DEFAULT_TTL_SECONDS = 6 * 60 * 60


@dataclass(frozen=True)
class JobConfig:
    max_resolution: str = "720p"
    output_resolution: str = "720p"
    video_bitrate: str = DEFAULT_VIDEO_BITRATE
    audio_bitrate: str = DEFAULT_AUDIO_BITRATE
    ttl_seconds: int = DEFAULT_TTL_SECONDS
    watermark_enabled: bool = True
    watermark_line1: str = "sharetube.krsz.in"
    watermark_line2: str = "{title} · {resolution} · {duration}"
    watermark_font_size: int = 28
    use_cookies: bool = True

    @classmethod
    def from_json(cls, data) -> "JobConfig":
        if isinstance(data, str):
            try:
                data = json.loads(data)
            except json.JSONDecodeError as e:
                raise RuntimeError(f"JOB_CONFIG_JSON is not valid JSON: {e}") from e
        if not isinstance(data, dict):
            raise RuntimeError("JOB_CONFIG_JSON must decode to an object")
        out: dict[str, object] = {}
        for k in (
            "max_resolution", "output_resolution",
            "video_bitrate", "audio_bitrate",
            "watermark_line1", "watermark_line2",
        ):
            if k in data and isinstance(data[k], str):
                out[k] = data[k]
        if "ttl_seconds" in data:
            try:
                out["ttl_seconds"] = int(data["ttl_seconds"])
            except (TypeError, ValueError):
                out["ttl_seconds"] = DEFAULT_TTL_SECONDS
        if "watermark_font_size" in data:
            try:
                out["watermark_font_size"] = int(data["watermark_font_size"])
            except (TypeError, ValueError):
                out["watermark_font_size"] = 28
        if "watermark_enabled" in data and isinstance(data["watermark_enabled"], bool):
            out["watermark_enabled"] = data["watermark_enabled"]
        if "use_cookies" in data and isinstance(data["use_cookies"], bool):
            out["use_cookies"] = data["use_cookies"]
        return cls(**out)  # type: ignore[arg-type]


@dataclass(frozen=True)
class Config:
    job_id: str
    url: str
    job_cfg: JobConfig
    backend_url: str
    app_url: str
    internal_token: str
    vaapi_device: str
    encoder_preset: str
    ffmpeg_bin: str
    ytdlp_bin: str
    proxy_url: str | None = None  # e.g. "socks5://user:pass@host:1080"

    @classmethod
    def from_env(cls) -> "Config":
        return cls(
            job_id=_require("JOB_ID"),
            url=_require("JOB_URL"),
            job_cfg=JobConfig.from_json(_require("JOB_CONFIG_JSON")),
            backend_url=_opt("BACKEND_URL", "https://sharetube.kurashizu.workers.dev").rstrip("/"),
            app_url=_opt("APP_URL", "https://share.krsz.in").rstrip("/"),
            internal_token=_require("INTERNAL_TOKEN"),
            vaapi_device=_opt("VAAPI_DEVICE", DEFAULT_VAAPI_DEVICE),
            encoder_preset=_opt("ENCODER_PRESET", DEFAULT_ENCODER_PRESET),
            ffmpeg_bin=_opt("FFMPEG_BIN", "ffmpeg"),
            ytdlp_bin=_opt("YTDLP_BIN", "yt-dlp"),
            proxy_url=(os.environ.get("PROXY_URL") or None),
        )
