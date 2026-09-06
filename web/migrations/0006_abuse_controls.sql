-- 0006_abuse_controls.sql
-- Abuse controls: per-IP rate limiting and per-owner job ownership.
--
-- `owner` ties a job to the browser that created it (an opaque token
-- kept in the HttpOnly `st_owner` cookie). Write operations — cancel,
-- move, delete — require the caller to present the matching token, so
-- one visitor cannot tamper with another's queue. Rows created before
-- this migration have owner = NULL and stay world-writable, since no
-- browser holds a token for them.
ALTER TABLE jobs ADD COLUMN owner TEXT;  -- opaque owner token, NULL for legacy rows

-- Used by the per-owner enqueue quota (see lib/server/guard.ts).
CREATE INDEX IF NOT EXISTS jobs_owner_idx ON jobs (owner);

-- Fixed-window request counters keyed by "<bucket>:<ip>". Rows are
-- reaped opportunistically once their window has passed, so the table
-- stays proportional to the number of *active* clients, not to total
-- traffic ever seen.
CREATE TABLE IF NOT EXISTS rate_limits (
  key          TEXT PRIMARY KEY,   -- "<bucket>:<client ip>"
  count        INTEGER NOT NULL,   -- hits recorded in the current window
  window_start INTEGER NOT NULL    -- unix seconds; window resets past its length
);

CREATE INDEX IF NOT EXISTS rate_limits_window_idx ON rate_limits (window_start);
