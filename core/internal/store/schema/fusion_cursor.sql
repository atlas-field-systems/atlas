CREATE TABLE IF NOT EXISTS fusion_cursor (
  run_id         INTEGER PRIMARY KEY,
  after_event_id INTEGER NOT NULL          -- last report.observation event Fusion handled
);
