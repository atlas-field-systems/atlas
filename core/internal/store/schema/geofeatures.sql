CREATE TABLE IF NOT EXISTS geofeatures (
  creating_call INTEGER,
  run_id        INTEGER NOT NULL,
  geofeature_id TEXT    NOT NULL,          -- from runs.last_geofeature_seq, never reused in the run
  record        TEXT    NOT NULL,
  requested_by  TEXT    NOT NULL,          -- who created it; not in the record (api.md#geo-features)
  object_id     TEXT GENERATED ALWAYS AS (json_extract(record, '$.object_id')) VIRTUAL,  -- imagery
  PRIMARY KEY (run_id, geofeature_id)
);
CREATE INDEX IF NOT EXISTS geofeatures_object ON geofeatures(run_id, object_id) WHERE object_id IS NOT NULL;
