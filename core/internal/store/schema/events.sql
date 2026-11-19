CREATE TABLE IF NOT EXISTS events (
  event_id     INTEGER PRIMARY KEY AUTOINCREMENT,  -- AUTOINCREMENT: never reused, even after a run is cleared
  run_id       INTEGER NOT NULL,
  time         INTEGER NOT NULL,                   -- Core's receive time, ms
  kind         TEXT    NOT NULL,
  asset_id     TEXT,                               -- the Asset the event is about or addressed to
  record       TEXT    NOT NULL,                   -- the Protocol record (an array for tasks.requested / tasks.updated)
  requested_by TEXT,                               -- geo feature events only
  clock_ahead  INTEGER NOT NULL DEFAULT 0,
  request_id     INTEGER GENERATED ALWAYS AS (json_extract(record, '$.request_id')) VIRTUAL,
  plugin_id      TEXT    GENERATED ALWAYS AS (json_extract(record, '$.plugin_id')) VIRTUAL,
  sub_kind       TEXT    GENERATED ALWAYS AS (json_extract(record, '$.kind')) VIRTUAL,
  observation_id TEXT    GENERATED ALWAYS AS (json_extract(record, '$.observation_id')) VIRTUAL,
  subsystem_id   TEXT    GENERATED ALWAYS AS (json_extract(record, '$.subsystem_id')) VIRTUAL,
  task_id        INTEGER GENERATED ALWAYS AS (json_extract(record, '$.task_id')) VIRTUAL,
  track_id       TEXT    GENERATED ALWAYS AS (json_extract(record, '$.track_id')) VIRTUAL,
  geofeature_id  TEXT    GENERATED ALWAYS AS (json_extract(record, '$.geofeature_id')) VIRTUAL,
  order_time     INTEGER GENERATED ALWAYS AS (
    CASE WHEN kind LIKE 'report.%' OR kind = 'track.updated' THEN json_extract(record, '$.time') ELSE time END) VIRTUAL
);
-- answers and drops of a request
CREATE INDEX IF NOT EXISTS events_request ON events(request_id) WHERE request_id IS NOT NULL;
-- per-Asset streams, latest reports, report history
CREATE INDEX IF NOT EXISTS events_asset ON events(run_id, asset_id, kind, order_time, event_id);
-- latest subsystem condition, latest Task report
CREATE INDEX IF NOT EXISTS events_status ON events(run_id, asset_id, sub_kind, subsystem_id, task_id, order_time)
  WHERE kind = 'report.status';
CREATE INDEX IF NOT EXISTS events_fusion ON events(run_id, event_id)
  WHERE kind = 'report.observation' AND clock_ahead = 0;
-- Observations: latest per (asset_id, observation_id)
CREATE INDEX IF NOT EXISTS events_observation ON events(run_id, asset_id, observation_id, order_time, event_id)
  WHERE kind = 'report.observation' AND clock_ahead = 0;
-- Plugin calls and their answers
CREATE INDEX IF NOT EXISTS events_plugin ON events(run_id, plugin_id, kind, event_id) WHERE plugin_id IS NOT NULL;
-- Track and geo feature history
CREATE INDEX IF NOT EXISTS events_track ON events(run_id, track_id, order_time, event_id) WHERE kind LIKE 'track.%';
CREATE INDEX IF NOT EXISTS events_geofeature ON events(run_id, geofeature_id, event_id) WHERE kind LIKE 'geofeature.%';
