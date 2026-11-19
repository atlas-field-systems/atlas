CREATE TABLE IF NOT EXISTS tasks (
  run_id        INTEGER NOT NULL,
  asset_id      TEXT    NOT NULL,
  task_id       INTEGER NOT NULL,          -- 1, 2, 3 ... per Asset per run; next = MAX+1 (rows never deleted in a run)
  body          TEXT    NOT NULL,          -- the task record as last sent (tasks.updated replaces it)
  requested_by  TEXT    NOT NULL,
  request_event INTEGER NOT NULL,          -- event_id of its tasks.requested
  state         TEXT    NOT NULL CHECK (state IN ('sent','queued','active','completed','failed','cancelled','dropped')),
  state_time    INTEGER NOT NULL,          -- report time of the state, or Core's time for sent / dropped
  object_ids    TEXT,                      -- from a completed report, JSON
  geofeature_id TEXT GENERATED ALWAYS AS (json_extract(body, '$.geofeature_id')) VIRTUAL,
  PRIMARY KEY (run_id, asset_id, task_id)
);
CREATE INDEX IF NOT EXISTS tasks_place ON tasks(run_id, geofeature_id) WHERE geofeature_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS tasks_unfinished ON tasks(run_id, asset_id, state);
