-- 0004_phase_meta.sql
-- Persist a per-phase completion meta (e.g. "5.2 MB" after download,
-- "12.3 MB · speed=8.40x" after transcode) so the UI can show final
-- info on a finished phase bar instead of just a ✓.
-- Runner still reports the current phase's `meta`; the Worker folds it
-- into the last-seen snapshots under the matching phase key.
ALTER TABLE jobs ADD COLUMN phase_meta_json TEXT NOT NULL DEFAULT '{}';