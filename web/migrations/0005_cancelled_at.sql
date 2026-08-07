-- 0005_cancelled_at.sql
-- Record when a force-stop was requested so zombie cleanup can force
-- the job to error if the runner never reports back (e.g. the GH run
-- was cancelled externally or the runner died mid-pipeline).
ALTER TABLE jobs ADD COLUMN cancelled_at INTEGER;  -- unix seconds, NULL unless force-stopped