CREATE TABLE IF NOT EXISTS runs (
  run_id     INTEGER PRIMARY KEY,           -- MAX+1; rows are never deleted, so a run_id is never reused
  started_at INTEGER NOT NULL,
  ended_at   INTEGER,                       -- NULL: running, or stopped unexpectedly
  outcome    TEXT CHECK (outcome IN ('archived', 'archive_failed')),
  zip_name   TEXT,
  resumes    TEXT NOT NULL DEFAULT '[]',    -- JSON [{last_sign_of_life, resumed_at}], one per unexpected stop
  last_track_seq      INTEGER NOT NULL DEFAULT 0,   -- per-run ID counters: survive deletes,
  last_geofeature_seq INTEGER NOT NULL DEFAULT 0,   -- start again next run
  last_object_seq     INTEGER NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX IF NOT EXISTS single_open_run ON runs((1)) WHERE ended_at IS NULL;
