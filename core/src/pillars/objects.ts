/**
 * Objects pillar (pillars.md, api.md#objects): files Core holds, what each one
 * is, and the geo feature it is attached to. Owns `objects` and the files
 * under paths.objectsDir(run).
 *
 * "Stored whole or not at all": the upload streams to uploads/<token>.part
 * (async, before any transaction), is fsynced and renamed into
 * objects/run-<id>/<token>, and only then does one transaction insert the row
 * and object.stored. A crash before the commit leaves a file no row names;
 * startCore deletes those at the next start. A row never names a missing file.
 * Files are named by a random token, not the object_id, so assigning the ID
 * inside the transaction needs no rename. The Reset ZIP names them by object_id.
 */
import type { ProtocolTypes } from "@atlas/protocol/types";
import type { Readable } from "node:stream";
import type { Env } from "../core.ts";
import type { ReadTx, TableDef, Tx } from "../store/db.ts";

type ObjectRecord = ProtocolTypes["object"];
type Deletion = ProtocolTypes["deletion"];

export const TABLES: TableDef[] = [
  {
    owner: "objects",
    name: "objects",
    runScoped: true,
    ddl: `
CREATE TABLE IF NOT EXISTS objects (
  run_id        INTEGER NOT NULL,
  object_id     TEXT    NOT NULL,          -- from runs.last_object_seq, never reused in the run
  record        TEXT    NOT NULL,          -- the object record, latest (object.changed re-stamps time)
  file          TEXT    NOT NULL,          -- token under objects/run-<run_id>/
  sha256        TEXT    NOT NULL,          -- of the file; the ZIP manifest reuses it
  geotiff       INTEGER NOT NULL,          -- image/tiff with GeoTIFF tags, checked once at upload
  deletion      TEXT,                      -- the deletion record once deleted (kept, hidden)
  geofeature_id TEXT GENERATED ALWAYS AS (json_extract(record, '$.geofeature_id')) VIRTUAL,
  PRIMARY KEY (run_id, object_id)
);
CREATE INDEX IF NOT EXISTS objects_geofeature ON objects(run_id, geofeature_id) WHERE geofeature_id IS NOT NULL;`,
  },
];

/** The file on disk before its row exists. Produced by `receive`, consumed by `store`. */
export type ReceivedFile = {
  token: string;
  content_type: string;
  size_bytes: number;
  sha256: string;
  geotiff: boolean;
};

/**
 * The route's async prepare step. Streams the body to disk while hashing and
 * counting; stops and deletes the part file past max_object_bytes (413
 * too_large). Checks GeoTIFF-ness for image/tiff: a TIFF whose first IFD has
 * the GeoKeyDirectory tag (34735), read from the first bytes only.
 */
export async function receive(
  env: Env,
  body: Readable,
  contentType: string,
): Promise<ReceivedFile> {
  throw new Error("not implemented");
}

/**
 * POST /objects?name=&geofeature_id=, an account, a Plugin, an Asset on IP, or a
 * gateway acting for a carried Asset (by = that asset_id). geofeature_id
 * that does not exist → 404. Assigns object_id; adds object.stored. 201 {object_id, event_id}.
 * If the transaction refuses or fails, the caller deletes the file (pipeline `abandon`).
 */
export function store(
  tx: Tx,
  file: ReceivedFile,
  meta: { name: string; geofeature_id?: string },
  by: string,
): { object_id: string; event_id: number } {
  throw new Error("not implemented");
}

/** GET /objects?geofeature_id=: records not deleted, with as_of. */
export function list(
  tx: ReadTx,
  geofeature_id: string | null,
): { as_of: number; items: ObjectRecord[] } {
  throw new Error("not implemented");
}
/** GET /objects/{id}: 404, or 410 deleted with {deletion}. */
export function get(tx: ReadTx, object_id: string): ObjectRecord {
  throw new Error("not implemented");
}
/** GET /objects/{id}/file: same refusals; the path and content_type to stream. */
export function fileOf(
  tx: ReadTx,
  object_id: string,
): { path: string; content_type: string; size_bytes: number } {
  throw new Error("not implemented");
}

/**
 * PATCH /objects/{id} {"geofeature_id": id | null}, an account. The end state:
 * the same value again changes nothing and adds no event, and answers with the
 * current state's last event (doc gap G24 on what event_id it returns).
 * geofeature_id that does not exist → 404. Otherwise object.changed.
 */
export function attach(
  tx: Tx,
  object_id: string,
  geofeature_id: string | null,
): { event_id: number } {
  throw new Error("not implemented");
}

/** DELETE /objects/{id}, an account. 409 object_shown while imagery shows it (Entities.imageryShows). Keeps the file; adds object.deleted. */
export function remove(
  tx: Tx,
  object_id: string,
  by: string,
): { event_id: number } {
  throw new Error("not implemented");
}

/** For Entities.createGeofeature (imagery): 404 unknown or deleted, 409 not_geotiff. */
export function objectForImagery(tx: ReadTx, object_id: string): void {
  throw new Error("not implemented");
}

/** Reset ZIP: every row (deleted ones marked) and each file's path, size, and sha256. */
export function exportRows(tx: ReadTx): {
  objects: unknown[];
  files: {
    object_id: string;
    path: string;
    size_bytes: number;
    sha256: string;
  }[];
} {
  throw new Error("not implemented");
}
