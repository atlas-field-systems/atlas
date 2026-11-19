CREATE TABLE IF NOT EXISTS objects (
  run_id        INTEGER NOT NULL,
  object_id     TEXT    NOT NULL,          -- from runs.last_object_seq, never reused in the run
  record        TEXT    NOT NULL,          -- the object record, latest (object.changed re-stamps time)
  file          TEXT    NOT NULL,          -- token under objects/run-<run_id>/
  sha256        TEXT    NOT NULL,          -- of the file; the ZIP manifest reuses it
  geotiff       INTEGER NOT NULL,          -- TIFF with GeoTIFF tags, checked once at upload
  creating_call INTEGER,
  deletion      TEXT,                      -- the deletion record once deleted (kept, hidden)
  geofeature_id TEXT GENERATED ALWAYS AS (json_extract(record, '$.geofeature_id')) VIRTUAL,
  PRIMARY KEY (run_id, object_id)
);
CREATE INDEX IF NOT EXISTS objects_geofeature ON objects(run_id, geofeature_id) WHERE geofeature_id IS NOT NULL;
