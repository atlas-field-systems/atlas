CREATE TABLE IF NOT EXISTS queues (
  run_id      INTEGER NOT NULL,
  asset_id    TEXT    NOT NULL,
  task_ids    TEXT    NOT NULL,            -- JSON array from the latest queue report
  report_time INTEGER NOT NULL,
  event_id    INTEGER NOT NULL,            -- the report's event; ties on report_time break by it
  PRIMARY KEY (run_id, asset_id)
);
