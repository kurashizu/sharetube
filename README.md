# sharetube

> Paste a video URL → download → transcode (ffmpeg h264) → share.
> Frontend on Cloudflare Workers, backend on GitHub Actions.

```
┌─────────────────┐  POST /api/jobs     ┌──────────────────────────────┐
│ Browser (UI)    │────────────────────▶│ Cloudflare Worker (D1 state) │
│ SvelteKit SPA   │◀──── GET /api/jobs  │  + repository_dispatch to GH │
└─────────────────┘   every 1 s (poll)  └──────────────────────────────┘
                                                   │ bearer token
                                                   ▼
                                         ┌──────────────────────────────┐
                                         │ GitHub Actions: per-job run  │
                                         │  - check out repo            │
                                         │  - cache yt-dlp + ffmpeg     │
                                         │  - decrypt secrets/cookies…  │
                                         │  - python -m runner          │
                                         └──────────────────────────────┘
                                                   │ POST progress
                                                   ▼
                                         (same Worker, /api/internal/update)
```

## Repository layout

```
sharetube/
├── web/                          # Cloudflare Worker (SvelteKit SPA + REST)
│   ├── src/routes/
│   │   ├── +page.svelte         # UI
│   │   └── api/
│   │       ├── jobs/+server.ts          # POST submit, GET list
│   │       ├── jobs/[id]/+server.ts     # GET one
│   │       └── internal/update/+server.ts  # POST from runner (auth)
│   ├── migrations/0001_init.sql         # D1 schema
│   ├── wrangler.jsonc                   # CF binding: D1 + vars
│   └── adapter-cloudflare               # builds to .svelte-kit/cloudflare/_worker.js
├── runner/                       # Python (uv-managed) GitHub Actions job
│   ├── __main__.py               # `python -m runner`
│   ├── config.py                 # env-driven; no JSON file
│   ├── backend.py                # background-thread progress push
│   ├── download.py               # yt-dlp wrapper, 3-client fallback
│   ├── transcode.py              # ffmpeg h264 (VAAPI when GPU present, else libx264)
│   └── upload.py                 # cf-share (single-PUT / multipart)
├── secrets/
│   └── cookies.txt.enc           # encrypted YouTube cookies (committed)
└── .github/workflows/sharetube.yml
```

## Local development

```bash
# Worker dev (Hot reload + local D1)
cd web
npm install --legacy-peer-deps
npm run dev               # vite dev (UI)
npx wrangler dev          # full Worker + D1

# Run a job locally (after a Worker run is started):
cd runner
JOB_ID=… JOB_URL=… JOB_CONFIG_JSON='{}' INTERNAL_TOKEN=… \
  python -m runner
```

## First-time deployment

### 1. GitHub

```bash
gh repo create sharetube --public --source=. --remote=origin --push
```

### 2. Cloudflare D1

```bash
cd web
wrangler d1 create sharetube-db
# → copy the database_id into wrangler.jsonc under d1_databases

# Apply migrations
wrangler d1 migrations apply sharetube-db --remote
```

### 3. Worker secrets

```bash
# GH_TOKEN: PAT with `repo` + `workflow` scope so the Worker can
# `POST /repos/{owner}/{repo}/dispatches`.
echo -n "ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" | \
  wrangler secret put GH_DISPATCH_TOKEN

# Shared secret the GH runner uses to authenticate progress pushes.
python -c "import secrets; print(secrets.token_urlsafe(32))" | \
  wrangler secret put INTERNAL_TOKEN
```

### 4. GH repo secrets / variables

In **Settings → Secrets and variables → Actions**:

| Kind     | Name             | Value                                                                                  |
|----------|------------------|----------------------------------------------------------------------------------------|
| Secret   | `INTERNAL_TOKEN` | same value as Worker's `INTERNAL_TOKEN`                                                |
| Secret   | `COOKIES_PASS`   | the passphrase used to encrypt `secrets/cookies.txt.enc`                              |
| Variable | `WORKER_URL`     | `https://sharetube.<your-account-subdomain>.workers.dev`                              |

### 5. Set the GitHub repo name in wrangler.jsonc

`wrangler.jsonc` ships with `vars.GH_REPO = "kurashizu/sharetube"` —
edit it to match your repo.

### 6. Deploy

```bash
cd web
npm run build              # builds .svelte-kit/cloudflare/_worker.js
npx wrangler deploy        # or: npm run deploy
```

## Cookie file

YouTube trips a bot wall ("Sign in to confirm you're not a bot") on
some videos. To work around it we ship an **encrypted** cookies.txt
inside the repo and decrypt it at job time:

```bash
# Export Netscape-format cookies from a logged-in browser
# (via a "Get cookies.txt" extension), then encrypt:

COOKIES_PASS="<your-passphrase>" openssl enc -aes-256-cbc -salt -pbkdf2 -iter 200000 \
  -in cookies.txt -out secrets/cookies.txt.enc -pass env:COOKIES_PASS

git add secrets/cookies.txt.enc
git commit -m "rotate cookies"
git push
```

The same passphrase must be set as the `COOKIES_PASS` secret on the
GitHub repo. Sessions expire every ~30 days — repeat the above when
the runner starts tripping the wall.

To disable cookies, set `use_cookies: false` in the frontend
settings (and the runner won't pass `--cookies` to yt-dlp even if the
encrypted file exists).

## Tool caching in CI

`.github/workflows/sharetube.yml` resolves the latest versions on
each run:

- **yt-dlp** — `https://api.github.com/repos/yt-dlp/yt-dlp/releases/latest`
  → tag like `2026.07.04`
- **ffmpeg** — `https://api.github.com/repos/BtbN/FFmpeg-Builds/releases`
  → highest `nX.Y` tag (currently `n8.1`)

Cache key: `tools-$OS-yt-<yt-dlp-version>-ffmpeg-<ffmpeg-version>`.
Cache restores when both versions match the last successful run,
falling back to any older matching yt-dlp then any older overall.

## Manual re-run

```bash
gh workflow run sharetube.yml -f job_id=<uuid-from-/api/jobs>
```
