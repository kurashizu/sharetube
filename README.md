# sharetube

> Paste a video URL → download → transcode (ffmpeg h264) → share.
> Frontend on Cloudflare Workers, backend on GitHub Actions (up to 4
> parallel runners).

```mermaid
flowchart LR
    Browser["Browser (UI)<br/>SvelteKit SPA"]
    Worker["Cloudflare Worker<br/>(D1 state, scheduler)"]
    GH["GitHub Actions runner<br/>(python -m runner)"]

    Browser -- "POST /api/jobs<br/>GET /api/jobs (poll)" --> Worker
    Worker -- "repository_dispatch<br/>(bearer token)" --> GH
    GH  -- "POST /api/internal/update<br/>(progress + done)" --> Worker
```

## Repository layout

```
sharetube/
├── web/                          # Cloudflare Worker (SvelteKit SPA + REST)
│   ├── src/
│   │   ├── routes/
│   │   │   ├── +page.svelte             # UI (two-column layout)
│   │   │   └── api/
│   │   │       ├── jobs/+server.ts              # POST submit, GET list, DELETE history
│   │   │       ├── jobs/[id]/+server.ts         # GET one, DELETE one
│   │   │       ├── jobs/[id]/move/+server.ts    # POST {direction: up|down}
│   │   │       ├── jobs/[id]/cancel/+server.ts  # POST force-stop
│   │   │       └── internal/update/+server.ts   # POST from runner (auth, monotonic pct)
│   │   ├── lib/
│   │   │   ├── server/dispatch.ts      # queue scheduler (MAX_PARALLEL=4) + zombie cleanup
│   │   │   ├── components/             # JobCard, Header, Hero, QueueDrawer, …
│   │   │   └── stores/                 # jobs.svelte.ts (poll), active.svelte.ts
│   ├── migrations/
│   │   ├── 0001_init.sql               # base jobs table
│   │   ├── 0002_queue_and_cancel.sql   # queue_pos, title, cancelled
│   │   └── 0003_dispatch.sql           # dispatched flag + index
│   ├── wrangler.jsonc                  # CF binding: D1 + vars
│   └── adapter-cloudflare              # builds to .svelte-kit/cloudflare/_worker.js
├── runner/                       # Python (stdlib-only) GitHub Actions job
│   ├── __main__.py               # `python -m runner`; phase orchestration + cancel checks
│   ├── config.py                 # env-driven; no JSON file
│   ├── backend.py                # background-thread progress push + cancelled polling
│   ├── download.py               # yt-dlp wrapper, 3-client fallback
│   ├── transcode.py              # ffmpeg h264 (VAAPI when GPU present, else libx264) + drawtext watermark
│   └── upload.py                 # cf-share (single-PUT / multipart), browser UA
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

## How the scheduler works

The Worker is the **queue scheduler** — submitting a URL never directly
fires a GH run, it only inserts a `pending` row with an increasing
`queue_pos`:

- At most **`MAX_PARALLEL` (= 4)** GH runs are in flight at once.
  "In flight" = `status='running'` **or** `pending & dispatched=1`
  (dispatch fired, runner still booting) — so bursts can't overshoot.
- `dispatchPending()` is called after `POST /api/jobs` and whenever a
  job leaves `running` (update endpoint, cancel endpoint). It claims
  the oldest undispatched pending rows atomically (`dispatched` flag)
  and fires `repository_dispatch` per claimed job.
- Freed slots are backfilled immediately: when a runner reports
  `done`/`error`, the update endpoint dispatches the next queued job
  in queue order.
- **Zombie detection** (on `GET`): `pending` with `dispatched=0` older
  than 30 min → error "Queued but never dispatched"; `pending &
  dispatched=1` stale 15 min → "runner never started"; `running` with
  no updates for 30 min → "Runner lost contact". Pending jobs that are
  simply waiting in line are **not** killed (that's normal with 4
  runners).

Frontend queue management: reorder (`↑↓` swaps `queue_pos`), force-stop
(`cancel`), delete, and a "clear history" button (`DELETE /api/jobs`).

Force-stop: `POST /api/jobs/[id]/cancel` marks the row `cancelled=1`
and records `cancelled_at`. The runner polls the flag on every push
(and during long transcode/merge via `raise_if_cancelled()`) and aborts
the pipeline, reporting `error: cancelled by user`. If the runner never
reports back (killed externally, GH run cancelled), zombie cleanup
force-errors any `running & cancelled` job whose `cancelled_at` is
older than 90 s — so a force-stop always resolves within ~90 s even if
the runner is dead. `pollGhRuns` additionally watches the GH run of
cancelled/pending jobs and frees the slot when the run dies.

## Download pipeline

The runner wraps yt-dlp and pushes **structured progress** (not
human-readable text) so the UI stays consistent across yt-dlp releases:

- The progress template uses yt-dlp's stable API fields
  (`progress.downloaded_bytes/total_bytes`, `progress.speed`,
  `progress.eta`) — numbers, never localized "1.46MiB/s ETA 00:30"
  text. The runner formats its own friendly string and smooths the
  speed with an exponential moving average (raw values jitter wildly:
  380 KB/s → 17 MB/s in under a second).
- `--concurrent-fragments 8` fetches DASH/HLS fragments in parallel;
  single-file mp4 is unaffected. Large downloads that used to sit at
  ~200 KB/s (Oracle egress throttling) now run at 6–14 MB/s.
- The title is captured with `--print-to-file %(title)s` during the
  same run — no second `--print --no-download` resolve (which used to
  time out and leave the title empty).
- Logs stream to the UI instead of buffering: pre-download resolution
  lines (`[youtube] …`) flush immediately, ffmpeg stderr is deduped
  (repeated per-frame warnings collapse into a single `×N` entry), and
  a "Resolving video info…" marker tells the user work is happening
  before the first progress line.

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

| Kind     | Name              | Value                                                                                  |
|----------|-------------------|----------------------------------------------------------------------------------------|
| Secret   | `INTERNAL_TOKEN`  | same value as Worker's `INTERNAL_TOKEN`                                                |
| Secret   | `COOKIES_PASS`    | passphrase used to encrypt `secrets/cookies.txt.enc`                                   |
| Secret   | `PROXY_TOKEN`     | OmniProxy tunnel token (for the Oracle exit-IP tunnel)                                 |
| Variable | `WORKER_URL`      | `https://sharetube.<your-account-subdomain>.workers.dev`                               |
| Variable | `OMNIPROXY_SERVER`| e.g. `op-au.022025.xyz` (wss, port 443)                                                |
| Variable | `DENO_VER`        | pinned deno release tag, e.g. `v2.9.4`                                                 |

`OMNIPROXY_SERVER` / `PROXY_TOKEN` / `DENO_VER` are optional — without
them the runner still works but YouTube bot-wall protection may block
some videos (cookies are bound to the exit IP).

### 5. Set the GitHub repo name in wrangler.jsonc

`wrangler.jsonc` ships with `vars.GH_REPO = "kurashizu/sharetube"` —
edit it to match your repo.

### 6. Deploy

```bash
cd web
npm run build              # builds .svelte-kit/cloudflare/_worker.js
npx wrangler deploy        # or: npm run deploy
```

## Cookies & the tunnel

YouTube trips a bot wall ("Sign in to confirm you're not a bot") on
some videos. Two things make downloads work from CI:

1. **Encrypted cookies** — `secrets/cookies.txt.enc` is committed,
   decrypted at job time with `COOKIES_PASS` into a temp file, and
   **wiped in the cleanup step**. Cookies are **always** sent to
   yt-dlp (there is no `use_cookies` toggle anymore).
2. **OmniProxy tunnel** — the runner starts a local SOCKS5 client
   (`127.0.0.1:1080`) that tunnels over WebSocket to the Oracle server
   (`op-au.022025.xyz`), so yt-dlp exits from the Oracle IP — where the
   cookies were minted — instead of Azure. This defeats the bot wall
   and keeps cookies valid.

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

> **Security (public repo!)**: CI logs and artifacts are visible to
> anyone. Never print cookie values in the workflow, and never upload
> `cookies.txt` or decrypted content as artifacts — the failure
> transcript step is an explicit no-op for this reason.

## Watermark

Every transcoded video gets a `drawtext` watermark, **always on**:

- top-left: `sharetube.krsz.in`
- bottom-left: `{title} · {resolution} · {duration}` (metadata
  substituted at transcode time)

The runner resolves a CJK-capable font (Noto Sans CJK, cached in CI;
falls back to any fontconfig face). If **no** font can be found the
transcode **fails loudly** rather than silently dropping the watermark.

## Tool caching in CI

Two separate caches, so setup stays fast:

- **yt-dlp** — version-checked every run (`Resolve yt-dlp version`
  hits the GitHub API); cache key `ytdlp-$OS-<tag>`. The install step
  compares the restored binary's version and re-downloads only when
  there's a newer release.
- **frozen tools** — Linux uses the BtbN ffmpeg build; macOS uses a
  pinned Apple Silicon static ffmpeg build with VideoToolbox. Deno
  (`DENO_VER`), omni-client (`OMNIPROXY_VER`), and CJK fonts are also
  downloaded as ordinary files and cached under stable OS-specific keys.
  Bump the workflow key suffix manually to force a refresh. Fonts are
  unpacked from the `fonts-noto-cjk` .deb on Linux and downloaded directly
  on macOS.

All downloads carry `--max-time` / `--retry` so a slow mirror fails
fast instead of hanging the whole run. The Settings modal offers three
proxy modes: Oracle Australia (default), Cloudflare WARP (placeholder),
and Disabled. Only the Oracle tunnel is currently implemented.

## Manual re-run

```bash
gh workflow run sharetube.yml -f job_id=<uuid-from-/api/jobs>
```
