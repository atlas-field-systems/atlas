CREATE TABLE IF NOT EXISTS tracks (
  run_id   INTEGER NOT NULL,
  track_id TEXT    NOT NULL,               -- from runs.last_track_seq, never reused in the run
  record   TEXT    NOT NULL,               -- the track record as Fusion last wrote it
  PRIMARY KEY (run_id, track_id)
);
