-- Initial schema for sharetube D1.
-- Run via: `wrangler d1 migrations apply sharetube-db --local` (dev)
--          `wrangler d1 migrations apply sharetube-db` (production)

CREATE TABLE IF NOT EXISTS jobs (
  -- Random uuid, created client-side so the frontend can address the
  -- new row before the runner has even started.
  id          TEXT PRIMARY KEY,
  -- The URL submitted by the user. yt-dlp ultimately opens it.
  url         TEXT NOT NULL,

  -- Lifecycle.
  status      TEXT NOT NULL DEFAULT 'pending',  -- pending|running|done|error
  phase       TEXT,                              -- Download|Transcode|Upload
  meta        TEXT NOT NULL DEFAULT '',          -- current phase meta string

  -- Per-phase pct (0..100). Cumulative: once done, dl_pct, tx_pct, up_pct
  -- are all 100. The UI weights download 30 / transcode 50 / upload 20.
  dl_pct      REAL NOT NULL DEFAULT 0,
  tx_pct      REAL NOT NULL DEFAULT 0,
  up_pct      REAL NOT NULL DEFAULT 0,

  -- Logs: capped server-side at MAX_LOG_LINES (200). We keep a
  -- rolling tail because yt-dlp stderr can be megabytes.
  log_lines   TEXT NOT NULL DEFAULT '[]',

  -- Upload result (only populated on `done`).
  share_url   TEXT,
  direct_url  TEXT,
  expires_at  INTEGER,

  -- Error message (only populated on `error`).
  error       TEXT,

  -- The settings payload the user submitted. Stored verbatim so the
  -- job can be re-run or audited.
  config_json TEXT NOT NULL,

  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);

-- Used by the polling list endpoint (`GET /api/jobs`).
CREATE INDEX IF NOT EXISTS jobs_created_at_idx ON jobs (created_at DESC);

-- Used to find pending / running jobs quickly.
CREATE INDEX IF NOT EXISTS jobs_status_idx ON jobs (status);
