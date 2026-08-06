-- Concurrency-limited dispatch for 4 parallel runners.
--
-- The Worker is the scheduler: jobs are inserted as `pending` and the
-- Worker dispatches at most MAX_PARALLEL GitHub Actions runs at once.
-- `dispatched` marks a pending job whose workflow run has been
-- triggered (so we don't double-dispatch when several requests race).

ALTER TABLE jobs ADD COLUMN dispatched INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS jobs_dispatch_idx ON jobs (status, dispatched, queue_pos);
