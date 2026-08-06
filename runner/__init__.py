"""sharetube runner — invoked by GitHub Actions.

Single-process CLI: download (yt-dlp) → transcode (ffmpeg) → upload
(cf-share). Each step pushes progress to the Cloudflare Worker via
``POST $BACKEND_URL/api/internal/update`` carrying a shared bearer
token (the same secret stored as ``INTERNAL_TOKEN`` in the Worker's
secrets and in the runner's ``secrets`` GH repo).

Cookies for the YouTube bot wall come from
``secrets/cookies.txt.enc`` in the repo, decrypted with
``$COOKIES_PASS``. The file is intentionally empty when the user
doesn't need cookies; the runner only passes ``--cookies`` to yt-dlp
when the decrypted content is non-empty *and* the per-job config
sets ``use_cookies=true``.
"""
__version__ = "0.1.0"
