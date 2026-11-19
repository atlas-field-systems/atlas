CREATE TABLE IF NOT EXISTS asset_heard (
  run_id     INTEGER NOT NULL,
  asset_id   TEXT NOT NULL,
  last_heard INTEGER NOT NULL,
  PRIMARY KEY(run_id,asset_id)
);
