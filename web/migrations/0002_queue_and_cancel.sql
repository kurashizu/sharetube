-- Queue ordering, friendly title, and cancel flag for jobs.
-- Run via: `wrangler d1 migrations apply sharetube-db` (production)

-- Position in the user's queue (pending jobs only). New jobs get
-- MAX(queue_pos)+1; up/down moves swap adjacent pending entries.
ALTER TABLE jobs ADD COLUMN queue_pos INTEGER NOT NULL DEFAULT 0;

-- Friendly display name (video title) reported by the runner after
-- extraction. NULL until the runner reports it.
ALTER TABLE jobs ADD COLUMN title TEXT;

-- 1 = user requested a force-stop. The runner polls this via the
-- internal update response; on seeing it, it aborts the pipeline and
-- marks the job error "cancelled by user".
ALTER TABLE jobs ADD COLUMN cancelled INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS jobs_queue_idx ON jobs (queue_pos);
