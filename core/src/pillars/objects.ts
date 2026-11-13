import { createHash, randomUUID } from "node:crypto";
import { open, mkdir, rename, rm, readdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { refuse, checkOrRefuse } from "../api/errors.ts";
import { encodeShortId } from "../ids.ts";
import { nextRunSeq } from "../store/runs.ts";
import * as entities from "./entities.ts";
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
  creating_call INTEGER,
  deletion      TEXT,                      -- the deletion record once deleted (kept, hidden)
  geofeature_id TEXT GENERATED ALWAYS AS (json_extract(record, '$.geofeature_id')) VIRTUAL,
  PRIMARY KEY (run_id, object_id)
);
CREATE INDEX IF NOT EXISTS objects_geofeature ON objects(run_id, geofeature_id) WHERE geofeature_id IS NOT NULL;`,
  },
];

export type ReceivedFile = {
  token: string;
  content_type: string;
  size_bytes: number;
  sha256: string;
  geotiff: boolean;
};

export async function receive(
  env: Env,
  body: Readable,
  contentType: string,
): Promise<ReceivedFile> {
  const token = randomUUID();
  const path = join(env.paths.uploadsDir, token);
  const handle = await open(path, "wx+");
  const hash = createHash("sha256");
  let size_bytes = 0;
  try {
    for await (const chunk of body.iterator({ destroyOnReturn: false })) {
      const bytes = Buffer.from(chunk);
      size_bytes += bytes.length;
      if (size_bytes > env.config.max_object_bytes)
        refuse("too_large", "Object exceeds max_object_bytes");
      hash.update(bytes);
      await handle.writeFile(bytes);
    }
    await handle.sync();
    return {
      token,
      content_type: contentType,
      size_bytes,
      sha256: hash.digest("hex"),
      geotiff:
        contentType === "image/tiff" && (await isGeoTiff(handle, size_bytes)),
    };
  } catch (error) {
    await rm(path, { force: true });
    throw error;
  } finally {
    await handle.close();
  }
}

export function store(
  tx: Tx,
  file: ReceivedFile,
  meta: { name: string; geofeature_id?: string },
  by: string,
  creatingCall: number | null = null,
): { object_id: string; event_id: number } {
  if (meta.geofeature_id && !entities.geofeatureExists(tx, meta.geofeature_id))
    refuse("not_found", "No such geo feature");
  const object_id = encodeShortId(nextRunSeq(tx, "object"));
  const record: ObjectRecord = {
    time: tx.now,
    object_id,
    name: meta.name,
    content_type: file.content_type,
    size_bytes: file.size_bytes,
    requested_by: by,
    ...(meta.geofeature_id ? { geofeature_id: meta.geofeature_id } : {}),
  };
  checkOrRefuse(tx.env.protocol, "object", record);
  tx.run(
    "INSERT INTO objects(run_id,object_id,record,file,sha256,geotiff,creating_call) VALUES (?,?,?,?,?,?,?)",
    tx.runId,
    object_id,
    JSON.stringify(record),
    file.token,
    file.sha256,
    file.geotiff ? 1 : 0,
    creatingCall,
  );
  return { object_id, event_id: tx.append("object.stored", record) };
}

export function list(
  tx: ReadTx,
  geofeature_id: string | null,
): { as_of: number; items: ObjectRecord[] } {
  return {
    as_of: tx.asOf(),
    items: tx
      .all<{ record: string }>(
        "SELECT record FROM objects WHERE run_id=? AND deletion IS NULL AND (? IS NULL OR geofeature_id=?) ORDER BY object_id",
        tx.runId,
        geofeature_id,
        geofeature_id,
      )
      .map((r) => JSON.parse(r.record)),
  };
}
export function get(tx: ReadTx, object_id: string): ObjectRecord {
  const row = rowOf(tx, object_id);
  return JSON.parse(row.record);
}
export function fileOf(
  tx: ReadTx,
  object_id: string,
): { path: string; content_type: string; size_bytes: number } {
  const row = rowOf(tx, object_id);
  const record: ObjectRecord = JSON.parse(row.record);
  return {
    path: join(tx.env.paths.objectsDir(tx.runId), row.file),
    content_type: record.content_type,
    size_bytes: record.size_bytes,
  };
}

export function attach(
  tx: Tx,
  object_id: string,
  geofeature_id: string | null,
): { event_id: number } {
  const record = get(tx, object_id);
  if ((record.geofeature_id ?? null) === geofeature_id)
    return {
      event_id: tx.get<{ id: number }>(
        "SELECT MAX(event_id) id FROM events WHERE run_id=? AND kind IN ('object.stored','object.changed') AND json_extract(record,'$.object_id')=?",
        tx.runId,
        object_id,
      )!.id,
    };
  if (geofeature_id && !entities.geofeatureExists(tx, geofeature_id))
    refuse("not_found", "No such geo feature");
  delete record.geofeature_id;
  if (geofeature_id) record.geofeature_id = geofeature_id;
  record.time = tx.now;
  tx.run(
    "UPDATE objects SET record=? WHERE run_id=? AND object_id=?",
    JSON.stringify(record),
    tx.runId,
    object_id,
  );
  return { event_id: tx.append("object.changed", record) };
}

export function remove(
  tx: Tx,
  object_id: string,
  by: string,
): { event_id: number } {
  get(tx, object_id);
  if (entities.imageryShows(tx, object_id))
    refuse("object_shown", "Imagery still shows this Object");
  const deletion: Deletion = { time: tx.now, object_id, requested_by: by };
  tx.run(
    "UPDATE objects SET deletion=? WHERE run_id=? AND object_id=?",
    JSON.stringify(deletion),
    tx.runId,
    object_id,
  );
  return { event_id: tx.append("object.deleted", deletion) };
}

export function objectForImagery(tx: ReadTx, object_id: string): void {
  const row = tx.get<ObjectRow>(
    "SELECT * FROM objects WHERE run_id=? AND object_id=?",
    tx.runId,
    object_id,
  );
  if (!row || row.deletion) refuse("not_found", "No such Object");
  if (!row.geotiff) refuse("not_geotiff", "Imagery requires a GeoTIFF");
}

export function exportRows(tx: ReadTx): {
  objects: unknown[];
  files: {
    object_id: string;
    path: string;
    size_bytes: number;
    sha256: string;
  }[];
} {
  const rows = tx.all<ObjectRow & { object_id: string; sha256: string }>(
    "SELECT * FROM objects WHERE run_id=?",
    tx.runId,
  );
  return {
    objects: rows,
    files: rows.map((r) => ({
      object_id: r.object_id,
      path: join(tx.env.paths.objectsDir(tx.runId), r.file),
      size_bytes: JSON.parse(r.record).size_bytes,
      sha256: r.sha256,
    })),
  };
}

type ObjectRow = {
  record: string;
  file: string;
  deletion: string | null;
  geotiff: number;
  creating_call: number | null;
};
function rowOf(tx: ReadTx, id: string): ObjectRow {
  const row = tx.get<ObjectRow>(
    "SELECT * FROM objects WHERE run_id=? AND object_id=?",
    tx.runId,
    id,
  );
  if (!row) refuse("not_found", "No such Object");
  if (row.deletion)
    refuse("deleted", "Object deleted", { deletion: JSON.parse(row.deletion) });
  return row;
}
export function createdFor(tx: ReadTx, id: string, call: number): boolean {
  const row = tx.get<ObjectRow>(
    "SELECT * FROM objects WHERE run_id=? AND object_id=?",
    tx.runId,
    id,
  );
  return !!row && !row.deletion && row.creating_call === call;
}
export async function placeFile(
  env: Env,
  runId: number,
  file: ReceivedFile,
): Promise<void> {
  const dir = env.paths.objectsDir(runId);
  await mkdir(dir, { recursive: true });
  await rename(join(env.paths.uploadsDir, file.token), join(dir, file.token));
  for (const directory of [dir, dirname(dir), env.config.data_directory]) {
    const handle = await open(directory, "r");
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
  }
}
export async function abandon(
  env: Env,
  runId: number,
  file: ReceivedFile,
): Promise<void> {
  await rm(join(env.paths.uploadsDir, file.token), { force: true });
  await rm(join(env.paths.objectsDir(runId), file.token), { force: true });
}
export async function cleanOrphans(
  env: Env,
  runId: number,
  files: readonly string[],
): Promise<void> {
  for (const file of await readdir(env.paths.uploadsDir))
    await rm(join(env.paths.uploadsDir, file), { force: true });
  const dir = env.paths.objectsDir(runId);
  await mkdir(dir, { recursive: true });
  const kept = new Set(files);
  for (const file of await readdir(dir))
    if (!kept.has(file)) await rm(join(dir, file), { force: true });
}
async function isGeoTiff(
  file: Awaited<ReturnType<typeof open>>,
  size: number,
): Promise<boolean> {
  const header = Buffer.alloc(8);
  if ((await file.read(header, 0, 8, 0)).bytesRead !== 8) return false;
  const little = header.toString("ascii", 0, 2) === "II";
  if (!little && header.toString("ascii", 0, 2) !== "MM") return false;
  const u16 = (b: Buffer, o: number) =>
    little ? b.readUInt16LE(o) : b.readUInt16BE(o);
  const u32 = (b: Buffer, o: number) =>
    little ? b.readUInt32LE(o) : b.readUInt32BE(o);
  if (u16(header, 2) !== 42) return false;
  const seen = new Set<number>();
  let offset = u32(header, 4);
  const bytes = Buffer.alloc(12);
  while (offset && !seen.has(offset)) {
    seen.add(offset);
    if (offset + 2 > size) return false;
    await file.read(bytes, 0, 2, offset);
    const count = u16(bytes, 0);
    if (offset + 2 + count * 12 + 4 > size) return false;
    for (let i = 0; i < count; i++) {
      await file.read(bytes, 0, 12, offset + 2 + i * 12);
      if (u16(bytes, 0) === 34735) return true;
    }
    await file.read(bytes, 0, 4, offset + 2 + count * 12);
    offset = u32(bytes, 0);
  }
  return false;
}

export function storedFiles(tx: ReadTx): string[] {
  return tx
    .all<{ file: string }>("SELECT file FROM objects WHERE run_id=?", tx.runId)
    .map((r) => r.file);
}
