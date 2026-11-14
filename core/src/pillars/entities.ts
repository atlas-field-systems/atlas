import { isDeepStrictEqual } from "node:util";
import * as objects from "./objects.ts";
import { refuse, checkOrRefuse } from "../api/errors.ts";
import { nextGlobalId, nextRunSeq } from "../store/runs.ts";
import { encodeShortId } from "../ids.ts";
import {
  latestReport,
  historyPage,
  dropUnsettled,
  EVENT_KINDS,
} from "../store/events.ts";
import * as tasks from "./tasks.ts";
import * as admin from "./administration.ts";
import type { ProtocolTypes } from "@atlas/protocol/types";
import type { ReadTx, TableDef, Tx } from "../store/db.ts";
import type {
  AtlasEvent,
  Cursor,
  HistoryPage,
  ReportKind,
} from "../store/events.ts";

type Description = ProtocolTypes["description"];
type Contact = ProtocolTypes["contact"];
type Track = ProtocolTypes["track"];
type Geofeature = ProtocolTypes["geofeature"];
type Observation = ProtocolTypes["report.observation"];
type Settings = ProtocolTypes["settings_change"]["settings"];
type Position = ProtocolTypes["report.telemetry"]["position"];
type Report =
  ProtocolTypes[`report.${"status" | "failsafe" | "telemetry" | "battery" | "gimbal" | "settings" | "observation"}`];

export const TABLES: TableDef[] = [
  {
    owner: "entities",
    name: "asset_heard",
    runScoped: true,
    ddl: `
CREATE TABLE IF NOT EXISTS asset_heard (
  run_id     INTEGER NOT NULL,
  asset_id   TEXT NOT NULL,
  last_heard INTEGER NOT NULL,
  PRIMARY KEY(run_id,asset_id)
);`,
  },

  {
    owner: "entities",
    name: "assets",
    runScoped: true,
    ddl: `
CREATE TABLE IF NOT EXISTS assets (
  run_id      INTEGER NOT NULL,
  asset_id    TEXT    NOT NULL,
  key_id      TEXT,                        -- the Asset key that registered it (Asset on IP)
  gateway_id  TEXT,                        -- the gateway carrying it (radio Asset); requested_by of its registration
  description TEXT,                        -- latest description record; NULL for a radio not yet signed up
  contact     TEXT    NOT NULL,            -- contact record as of its last change
  removed     INTEGER NOT NULL DEFAULT 0,  -- kept, not listed (storage.md)
  PRIMARY KEY (run_id, asset_id)
);
-- "A key registers at most one Asset at a time" (api.md)
CREATE UNIQUE INDEX IF NOT EXISTS assets_key ON assets(run_id, key_id) WHERE key_id IS NOT NULL AND removed = 0;
CREATE INDEX IF NOT EXISTS assets_gateway ON assets(run_id, gateway_id) WHERE gateway_id IS NOT NULL;`,
  },
  {
    owner: "entities",
    name: "tracks",
    runScoped: true,
    ddl: `
CREATE TABLE IF NOT EXISTS tracks (
  run_id   INTEGER NOT NULL,
  track_id TEXT    NOT NULL,               -- from runs.last_track_seq, never reused in the run
  record   TEXT    NOT NULL,               -- the track record as Fusion last wrote it
  PRIMARY KEY (run_id, track_id)
);`,
  },
  {
    owner: "entities",
    name: "geofeatures",
    runScoped: true,
    ddl: `
CREATE TABLE IF NOT EXISTS geofeatures (
  creating_call INTEGER,
  run_id        INTEGER NOT NULL,
  geofeature_id TEXT    NOT NULL,          -- from runs.last_geofeature_seq, never reused in the run
  record        TEXT    NOT NULL,
  requested_by  TEXT    NOT NULL,          -- who created it; not in the record (api.md#geo-features)
  object_id     TEXT GENERATED ALWAYS AS (json_extract(record, '$.object_id')) VIRTUAL,  -- imagery
  PRIMARY KEY (run_id, geofeature_id)
);
CREATE INDEX IF NOT EXISTS geofeatures_object ON geofeatures(run_id, object_id) WHERE object_id IS NOT NULL;`,
  },
];

export function assetForKey(tx: ReadTx, key_id: string): string | null {
  return (
    tx.get<{ asset_id: string }>(
      "SELECT asset_id FROM assets WHERE run_id=? AND key_id=? AND removed=0",
      tx.runId,
      key_id,
    )?.asset_id ?? null
  );
}
export function carrierOf(tx: ReadTx, asset_id: string): string | null {
  return (
    tx.get<{ gateway_id: string | null }>(
      "SELECT gateway_id FROM assets WHERE run_id=? AND asset_id=? AND removed=0",
      tx.runId,
      asset_id,
    )?.gateway_id ?? null
  );
}
export function carriedBy(tx: ReadTx, gateway_id: string): string[] {
  return tx
    .all<{
      asset_id: string;
    }>(
      "SELECT asset_id FROM assets WHERE run_id=? AND gateway_id=? AND removed=0",
      tx.runId,
      gateway_id,
    )
    .map((row) => row.asset_id);
}

export function registerAsset(
  tx: Tx,
  key_id: string,
  body: ProtocolTypes["requests.asset"],
): { asset_id: string; last_task_id: number } {
  let asset_id = assetForKey(tx, key_id);
  if (asset_id) restart(tx, asset_id);
  else {
    asset_id = nextGlobalId(tx);
    if (!asset_id) refuse("asset_ids_exhausted", "Asset IDs exhausted");
    tx.run(
      "INSERT INTO assets(run_id,asset_id,key_id,contact) VALUES (?,?,?,?)",
      tx.runId,
      asset_id,
      key_id,
      JSON.stringify({ time: tx.now, asset_id, contact: "online" }),
    );
    tx.append("asset.registered", { time: tx.now, asset_id });
    tx.append("asset.contact", { time: tx.now, asset_id, contact: "online" });
  }
  const description = { ...body, time: tx.now, asset_id };
  tx.run(
    "UPDATE assets SET description=? WHERE run_id=? AND asset_id=?",
    JSON.stringify(description),
    tx.runId,
    asset_id,
  );
  tx.append("asset.described", description);
  applyContact(tx, asset_id, { time: tx.now, asset_id, contact: "online" });
  return { asset_id, last_task_id: tasks.lastTaskId(tx, asset_id) };
}

export function registerRadio(
  tx: Tx,
  gateway_id: string,
  body: ProtocolTypes["requests.radio"],
):
  | { registered: true; asset_id: string }
  | { registered: false; refusal_event_id: number } {
  if (body.definitions_hash !== tx.env.protocol.hash)
    return {
      registered: false,
      refusal_event_id: tx.append("definitions.refused", {
        time: tx.now,
        gateway_id,
        radio: true,
        definitions_hash: body.definitions_hash,
      }),
    };
  const asset_id = nextGlobalId(tx);
  if (!asset_id) refuse("asset_ids_exhausted", "Asset IDs exhausted");
  tx.run(
    "INSERT INTO assets(run_id,asset_id,gateway_id,contact) VALUES (?,?,?,?)",
    tx.runId,
    asset_id,
    gateway_id,
    JSON.stringify({ time: tx.now, asset_id, contact: "offline" }),
  );
  tx.append("asset.registered", {
    time: tx.now,
    asset_id,
    requested_by: gateway_id,
  });
  tx.append("asset.contact", { time: tx.now, asset_id, contact: "offline" });
  return { registered: true, asset_id };
}

export function signUpRadio(
  tx: Tx,
  asset_id: string,
  description: Description,
): { event_id: number } {
  const row = requireAsset(tx, asset_id);
  if (description.asset_id !== asset_id)
    refuse("invalid", "Description Asset differs from path");
  if (row.description) restart(tx, asset_id);
  tx.run(
    "UPDATE assets SET description=? WHERE run_id=? AND asset_id=?",
    JSON.stringify(description),
    tx.runId,
    asset_id,
  );
  return { event_id: tx.append("asset.described", description) };
}

export function removeAsset(
  tx: Tx,
  asset_id: string,
  by: string,
): { event_id: number } {
  requireAsset(tx, asset_id);
  restart(tx, asset_id);
  tx.run(
    "UPDATE assets SET removed=1 WHERE run_id=? AND asset_id=?",
    tx.runId,
    asset_id,
  );
  return {
    event_id: tx.append("asset.removed", {
      time: tx.now,
      asset_id,
      requested_by: by,
    }),
  };
}

export function storeReports(
  tx: Tx,
  asset_id: string,
  reports: unknown[],
): { stored: number } {
  requireAsset(tx, asset_id);
  noteHeard(tx, asset_id);
  for (const [i, value] of reports.entries()) {
    if (
      !value ||
      typeof value !== "object" ||
      !("type" in value) ||
      typeof value.type !== "string" ||
      !reportKinds.includes(value.type as ReportKind)
    )
      refuse("invalid", `/reports/${i}/type: unknown report`);
    const report = checkOrRefuse<Report>(tx.env.protocol, value.type, value);
    if (report.asset_id !== asset_id)
      refuse("forbidden", "Report Asset differs from path");
    const ahead = report.time > tx.now + tx.env.config.clock_ahead_s * 1000;
    const event_id = tx.append(
      report.type,
      report,
      ahead ? { clock_ahead: true } : undefined,
    );
    tx.env.log.record({
      level: "trace",
      area: "entities",
      msg: "Report stored",
      asset_id,
      event_id,
      report_type: report.type,
      report_time: report.time,
      clock_ahead: ahead,
    });
    if (report.type === "report.status" && report.kind === "task")
      tasks.applyTaskReport(tx, asset_id, report);
    if (report.type === "report.status" && report.kind === "queue")
      tasks.applyQueueReport(tx, asset_id, report, event_id, ahead);
  }
  return { stored: reports.length };
}

export function applyContact(
  tx: Tx,
  asset_id: string,
  record: Contact,
): { changed: boolean } {
  const row = requireAsset(tx, asset_id);
  if (record.asset_id !== asset_id)
    refuse("invalid", "Contact Asset differs from path");
  if (record.contact === "online") noteHeard(tx, asset_id);
  if (JSON.parse(row.contact).contact === record.contact)
    return { changed: false };
  tx.run(
    "UPDATE assets SET contact=? WHERE run_id=? AND asset_id=?",
    JSON.stringify(record),
    tx.runId,
    asset_id,
  );
  const event_id = tx.append("asset.contact", record);
  tx.env.log.record({
    level: "trace",
    area: "contact",
    msg: "Asset contact changed",
    asset_id,
    event_id,
    contact: record.contact,
    last_heard: record.time,
  });
  if (record.contact === "offline") {
    dropUnsettled(tx, { asset_id });
    tasks.dropUnconfirmed(tx, asset_id);
  }
  return { changed: true };
}
export function onlineAssetsOnIp(tx: ReadTx): string[] {
  return tx
    .all<{ asset_id: string }>(
      "SELECT asset_id FROM assets WHERE run_id=? AND removed=0 AND gateway_id IS NULL AND json_extract(contact,'$.contact')='online'",
      tx.runId,
    )
    .map((r) => r.asset_id);
}

export type AdmissionView = {
  asset_id: string;
  description: Description; // a radio Asset not yet signed up has none → refused not_supported
  online: boolean;
  flying: boolean; // description lists takeoff
  hasCriticalBatteryRule: boolean; // latest reported failsafe_policy has a battery_below rule with critical: true
};
export function admissionView(tx: ReadTx, asset_id: string): AdmissionView {
  const row = requireAsset(tx, asset_id);
  const online =
    JSON.parse(row.contact).contact === "online" &&
    (!row.gateway_id ||
      admin.gatewayContact(tx, row.gateway_id).contact === "online");
  if (!row.description) refuse("not_supported", "Asset has no description");
  const description: Description = JSON.parse(row.description);
  const latest = latestReport(tx, {
    asset_id,
    kind: "report.settings",
    setting: "failsafe_policy",
  });
  return {
    asset_id,
    description,
    online,
    flying: description.commands.includes("takeoff"),
    hasCriticalBatteryRule: policyHasCriticalBatteryRule(
      latest?.kind === "report.settings"
        ? latest.record.settings.failsafe_policy
        : undefined,
    ),
  };
}
export function policyHasCriticalBatteryRule(
  policy: Settings["failsafe_policy"],
): boolean {
  return !!policy?.some((rule) =>
    rule.conditions.some(
      (c) => c.kind === "battery_below" && c.critical === true,
    ),
  );
}

export function requestSettings(
  tx: Tx,
  asset_id: string,
  body: ProtocolTypes["requests.settings"],
  by: string,
): { event_id: number } {
  const v = admissionView(tx, asset_id);
  if (!v.online) refuse("asset_offline", "Asset is offline");
  checkSettings(v, body.settings);
  return {
    event_id: tx.append("settings.requested", {
      time: tx.now,
      asset_id,
      requested_by: by,
      settings: body.settings,
    }),
  };
}

export type AssetEntry = {
  asset_id: string;
  gateway_id: string | null;
  description: Description | null;
  contact: Contact;
  reports: Partial<Record<Exclude<ReportKind, "report.observation">, Report>>;
  settings: Partial<{
    [K in keyof Settings]: { value: Settings[K]; time: number };
  }>;
  subsystems: Record<string, ProtocolTypes["report.status"]>;
};

export function listAssets(tx: ReadTx): {
  as_of: number;
  items: AssetEntry[];
  gateways: Contact[];
} {
  return {
    as_of: tx.asOf(),
    items: tx
      .all<AssetRow>(
        "SELECT * FROM assets WHERE run_id=? AND removed=0 ORDER BY asset_id",
        tx.runId,
      )
      .map((r) => assetEntry(tx, r)),
    gateways: admin.exportRows(tx).gateways.map((row) => {
      if (
        !row ||
        typeof row !== "object" ||
        !("gateway_id" in row) ||
        typeof row.gateway_id !== "string"
      )
        throw new Error("Invalid gateway row");
      return admin.gatewayContact(tx, row.gateway_id);
    }),
  };
}
export function getAsset(
  tx: ReadTx,
  asset_id: string,
): { as_of: number; item: AssetEntry } {
  return { as_of: tx.asOf(), item: assetEntry(tx, requireAsset(tx, asset_id)) };
}
export function listObservations(tx: ReadTx): {
  as_of: number;
  items: Observation[];
} {
  return {
    as_of: tx.asOf(),
    items: tx
      .all<{ record: string }>(
        "SELECT record FROM (SELECT record,ROW_NUMBER() OVER (PARTITION BY asset_id,observation_id ORDER BY order_time DESC,event_id DESC) n FROM events WHERE run_id=? AND kind='report.observation' AND clock_ahead=0) WHERE n=1",
        tx.runId,
      )
      .map((r) => JSON.parse(r.record)),
  };
}
export function listTracks(tx: ReadTx): { as_of: number; items: Track[] } {
  return {
    as_of: tx.asOf(),
    items: tx
      .all<{ record: string }>(
        "SELECT record FROM tracks WHERE run_id=? ORDER BY track_id",
        tx.runId,
      )
      .map((r) => JSON.parse(r.record)),
  };
}
export function getTrack(
  tx: ReadTx,
  track_id: string,
): { as_of: number; item: Track } {
  const row = tx.get<{ record: string }>(
    "SELECT record FROM tracks WHERE run_id=? AND track_id=?",
    tx.runId,
    track_id,
  );
  if (!row) refuse("not_found", "No such Track");
  return { as_of: tx.asOf(), item: JSON.parse(row.record) };
}
export function listGeofeatures(tx: ReadTx): {
  as_of: number;
  items: Geofeature[];
} {
  return {
    as_of: tx.asOf(),
    items: tx
      .all<{ record: string }>(
        "SELECT record FROM geofeatures WHERE run_id=? ORDER BY geofeature_id",
        tx.runId,
      )
      .map((r) => JSON.parse(r.record)),
  };
}
export function getGeofeature(
  tx: ReadTx,
  geofeature_id: string,
): { as_of: number; item: Geofeature } {
  const row = tx.get<{ record: string }>(
    "SELECT record FROM geofeatures WHERE run_id=? AND geofeature_id=?",
    tx.runId,
    geofeature_id,
  );
  if (!row) refuse("not_found", "No such geo feature");
  return { as_of: tx.asOf(), item: JSON.parse(row.record) };
}
export function picture(tx: ReadTx): {
  as_of: number;
  assets: AssetEntry[];
  observations: Observation[];
  tracks: Track[];
  geofeatures: Geofeature[];
} {
  return {
    as_of: tx.asOf(),
    assets: listAssets(tx).items,
    observations: listObservations(tx).items,
    tracks: listTracks(tx).items,
    geofeatures: listGeofeatures(tx).items,
  };
}

export function history(
  tx: ReadTx,
  of: "reports" | "tracks" | "geofeatures",
  query: URLSearchParams,
  cursor: Cursor | null,
): HistoryPage<AtlasEvent> {
  const time = (key: string) => {
    const raw = query.get(key);
    if (raw === null) return undefined;
    const n = Number(raw);
    if (!Number.isSafeInteger(n) || n < 0)
      refuse("invalid", `${key} must be a time`);
    return n;
  };
  const limit = Number(query.get("limit") ?? 1000);
  if (!Number.isInteger(limit) || limit < 1)
    refuse("invalid", "Invalid history limit");
  if (cursor) {
    try {
      const pair = JSON.parse(Buffer.from(cursor, "base64url").toString());
      if (
        !Array.isArray(pair) ||
        pair.length !== 2 ||
        !pair.every((n) => Number.isSafeInteger(n) && n >= 0)
      )
        throw Error();
    } catch {
      refuse("invalid", "Invalid history cursor");
    }
  }
  const common = { since: time("since"), until: time("until") };
  if (of === "reports") {
    const report = query.get("report");
    const kind = report
      ? report.startsWith("report.")
        ? report
        : `report.${report}`
      : undefined;
    if (kind && !reportKinds.includes(kind as ReportKind))
      refuse("invalid", "Unknown report kind");
    return historyPage(
      tx,
      {
        of,
        ...common,
        ...(query.has("asset_id") ? { asset_id: query.get("asset_id")! } : {}),
        ...(kind ? { report: kind as ReportKind } : {}),
      },
      cursor,
      limit,
    );
  }
  return historyPage(
    tx,
    of === "tracks"
      ? {
          of,
          ...common,
          ...(query.has("track_id")
            ? { track_id: query.get("track_id")! }
            : {}),
        }
      : {
          of,
          ...common,
          ...(query.has("geofeature_id")
            ? { geofeature_id: query.get("geofeature_id")! }
            : {}),
        },
    cursor,
    limit,
  );
}

export function createGeofeature(
  tx: Tx,
  body: ProtocolTypes["requests.geofeature"],
  by: string,
  creatingCall: number | null = null,
): { geofeature: Geofeature; event_id: number } {
  if (body.kind === "imagery") objects.objectForImagery(tx, body.object_id);
  const geofeature: Geofeature = {
    ...body,
    time: tx.now,
    geofeature_id: encodeShortId(nextRunSeq(tx, "geofeature")),
  };
  tx.run(
    "INSERT INTO geofeatures(run_id,geofeature_id,record,requested_by,creating_call) VALUES (?,?,?,?,?)",
    tx.runId,
    geofeature.geofeature_id,
    JSON.stringify(geofeature),
    by,
    creatingCall,
  );
  return {
    geofeature,
    event_id: tx.append("geofeature.created", geofeature, { requested_by: by }),
  };
}

export function replaceGeofeature(
  tx: Tx,
  geofeature_id: string,
  body: ProtocolTypes["requests.geofeature"],
  updateTasks: boolean,
  by: string,
): {
  geofeature: Geofeature;
  event_id: number;
  updated_task_ids?: { asset_id: string; task_id: number }[];
  not_updated_task_ids?: { asset_id: string; task_id: number }[];
} {
  const old = getGeofeature(tx, geofeature_id).item;
  if (
    (old.kind === "imagery" || body.kind === "imagery") &&
    !(
      old.kind === "imagery" &&
      body.kind === "imagery" &&
      old.object_id === body.object_id
    )
  )
    refuse("imagery_fixed", "Imagery may change only its name");
  const geofeature: Geofeature = { ...body, time: tx.now, geofeature_id };
  tx.run(
    "UPDATE geofeatures SET record=? WHERE run_id=? AND geofeature_id=?",
    JSON.stringify(geofeature),
    tx.runId,
    geofeature_id,
  );
  const event_id = tx.append("geofeature.replaced", geofeature, {
    requested_by: by,
  });
  return {
    geofeature,
    event_id,
    ...(updateTasks ? tasks.updatePlace(tx, geofeature) : {}),
  };
}

export function deleteGeofeature(
  tx: Tx,
  geofeature_id: string,
  by: string,
): { event_id: number } {
  const old = getGeofeature(tx, geofeature_id).item;
  tx.run(
    "DELETE FROM geofeatures WHERE run_id=? AND geofeature_id=?",
    tx.runId,
    geofeature_id,
  );
  return {
    event_id: tx.append("geofeature.deleted", old, { requested_by: by }),
  };
}

export function pointOf(tx: ReadTx, geofeature_id: string): Position {
  const place = getGeofeature(tx, geofeature_id).item;
  if (place.kind !== "point") refuse("not_a_point", "Place is not a point");
  return place.position;
}
export function geofeatureExists(tx: ReadTx, geofeature_id: string): boolean {
  return !!tx.get(
    "SELECT 1 FROM geofeatures WHERE run_id=? AND geofeature_id=?",
    tx.runId,
    geofeature_id,
  );
}
export function imageryShows(tx: ReadTx, object_id: string): boolean {
  return !!tx.get(
    "SELECT 1 FROM geofeatures WHERE run_id=? AND object_id=?",
    tx.runId,
    object_id,
  );
}

export function putTrack(
  tx: Tx,
  track: Omit<Track, "track_id"> & { track_id?: string },
): string {
  const record: Track = {
    ...track,
    track_id: track.track_id ?? encodeShortId(nextRunSeq(tx, "track")),
  };
  const old = tx.get<{ record: string }>(
    "SELECT record FROM tracks WHERE run_id=? AND track_id=?",
    tx.runId,
    record.track_id,
  );
  if (old && isDeepStrictEqual(JSON.parse(old.record), record))
    return record.track_id;
  tx.run(
    "INSERT INTO tracks VALUES (?,?,?) ON CONFLICT(run_id,track_id) DO UPDATE SET record=excluded.record",
    tx.runId,
    record.track_id,
    JSON.stringify(record),
  );
  tx.append("track.updated", record);
  return record.track_id;
}
export function removeTrack(tx: Tx, track_id: string): void {
  const old = getTrack(tx, track_id).item;
  tx.run(
    "DELETE FROM tracks WHERE run_id=? AND track_id=?",
    tx.runId,
    track_id,
  );
  tx.append("track.removed", old);
}
export function tracksWithSource(
  tx: ReadTx,
  asset_id: string,
  observation_id: string,
): Track[] {
  return tx
    .all<{ record: string }>(
      "SELECT record FROM tracks WHERE run_id=? AND EXISTS (SELECT 1 FROM json_each(tracks.record,'$.sources') s WHERE json_extract(s.value,'$.asset_id')=? AND json_extract(s.value,'$.observation_id')=?)",
      tx.runId,
      asset_id,
      observation_id,
    )
    .map((r) => JSON.parse(r.record));
}

export function exportRows(tx: ReadTx): {
  assets: unknown[];
  tracks: unknown[];
  geofeatures: unknown[];
} {
  return {
    assets: tx.all("SELECT * FROM assets WHERE run_id=?", tx.runId),
    tracks: tx.all("SELECT * FROM tracks WHERE run_id=?", tx.runId),
    geofeatures: tx.all("SELECT * FROM geofeatures WHERE run_id=?", tx.runId),
  };
}

export function assetIdInUse(tx: ReadTx, id: string): boolean {
  return !!tx.get(
    "SELECT 1 FROM assets WHERE run_id=? AND asset_id=?",
    tx.runId,
    id,
  );
}

type AssetRow = {
  asset_id: string;
  gateway_id: string | null;
  description: string | null;
  contact: string;
};
export function requireAsset(tx: ReadTx, asset_id: string): AssetRow {
  const row = tx.get<AssetRow>(
    "SELECT * FROM assets WHERE run_id=? AND asset_id=? AND removed=0",
    tx.runId,
    asset_id,
  );
  if (!row) refuse("not_found", "No such Asset");
  return row;
}
function restart(tx: Tx, asset_id: string): void {
  dropUnsettled(tx, { asset_id });
  tasks.dropUnfinished(tx, asset_id);
}
export function checkSettings(v: AdmissionView, settings: Settings): void {
  for (const rule of settings.failsafe_policy ?? [])
    checkCommand(v.description, rule.response);
  for (const key of Object.keys(settings))
    if (!v.description.settings?.some((s) => s === key))
      refuse("not_supported", "Setting is not declared");
  if (
    v.flying &&
    settings.failsafe_policy &&
    !policyHasCriticalBatteryRule(settings.failsafe_policy)
  )
    refuse("no_critical_battery_rule", "Policy needs a critical battery rule");
}
const reportKinds = Object.keys(EVENT_KINDS).filter((k): k is ReportKind =>
  k.startsWith("report."),
);
function assetEntry(tx: ReadTx, row: AssetRow): AssetEntry {
  const description: Description | null = row.description
    ? JSON.parse(row.description)
    : null;
  const reports: AssetEntry["reports"] = {};
  for (const kind of reportKinds)
    if (kind !== "report.observation") {
      const e = latestReport(tx, { asset_id: row.asset_id, kind });
      if (e) reports[kind] = e.record;
    }
  const settings: AssetEntry["settings"] = {};
  for (const name of [
    "run_state",
    "lights",
    "landing_gear",
    "link_loss_after_s",
    "failsafe_policy",
    "home_position",
    "telemetry_every_s",
  ] as const) {
    const e = latestReport(tx, {
      asset_id: row.asset_id,
      kind: "report.settings",
      setting: name,
    });
    if (e?.kind === "report.settings")
      Object.assign(settings, {
        [name]: { value: e.record.settings[name], time: e.record.time },
      });
  }
  const subsystems: AssetEntry["subsystems"] = {};
  for (const { subsystem_id } of description?.subsystems ?? []) {
    const e = latestReport(tx, {
      asset_id: row.asset_id,
      kind: "report.status",
      sub_kind: "subsystem",
      subsystem_id,
    });
    if (e?.kind === "report.status") subsystems[subsystem_id] = e.record;
  }
  return {
    asset_id: row.asset_id,
    gateway_id: row.gateway_id,
    description,
    contact: JSON.parse(row.contact),
    reports,
    settings,
    subsystems,
  };
}

export function createdFor(tx: ReadTx, id: string, call: number): boolean {
  return !!tx.get(
    "SELECT 1 FROM geofeatures WHERE run_id=? AND geofeature_id=? AND creating_call=?",
    tx.runId,
    id,
    call,
  );
}

export function checkCommand(
  description: Description,
  command: { kind: Description["commands"][number]; camera_id?: string },
): void {
  if (!description.commands.includes(command.kind))
    refuse("not_supported", "Command is not declared");
  if (
    command.kind === "capture" &&
    !description.cameras?.some((c) => c.camera_id === command.camera_id)
  )
    refuse("not_supported", "Camera is not declared");
}

export function noteHeard(tx: Tx, asset_id: string): void {
  tx.run(
    "INSERT INTO asset_heard VALUES (?,?,?) ON CONFLICT(run_id,asset_id) DO UPDATE SET last_heard=excluded.last_heard",
    tx.runId,
    asset_id,
    tx.now,
  );
}
export function lastHeard(tx: ReadTx, asset_id: string): number | undefined {
  return tx.get<{ last_heard: number }>(
    "SELECT last_heard FROM asset_heard WHERE run_id=? AND asset_id=?",
    tx.runId,
    asset_id,
  )?.last_heard;
}
