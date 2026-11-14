import type { ProtocolTypes } from "@atlas/protocol/types";
import type { ReadTx, TableDef, Tx } from "./db.ts";

type RecordName = keyof ProtocolTypes;

type KindSpec = {
  readonly record: RecordName;
  readonly audience: "accounts" | "asset" | "plugin";
  readonly many?: true;
  readonly request?: {
    readonly recipient: "asset_id" | "plugin_id";
    readonly answers: readonly string[];
    readonly droppedAs: "request.dropped" | "plugin.dropped";
  };
  readonly stamps?: readonly ("requested_by" | "clock_ahead")[];
};

const REPORT = { audience: "accounts", stamps: ["clock_ahead"] } as const;
const TO_ASSET = {
  recipient: "asset_id",
  droppedAs: "request.dropped",
} as const;

export const EVENT_KINDS = {
  "asset.registered": { record: "registration", audience: "accounts" },
  "asset.removed": { record: "registration", audience: "accounts" },
  "asset.described": { record: "description", audience: "accounts" },
  "asset.contact": { record: "contact", audience: "accounts" },
  "gateway.provisioned": { record: "provisioning", audience: "accounts" },
  "gateway.removed": { record: "provisioning", audience: "accounts" },
  "gateway.contact": { record: "contact", audience: "accounts" },
  "plugin.provisioned": { record: "provisioning", audience: "accounts" },
  "plugin.removed": { record: "provisioning", audience: "accounts" },
  "plugin.described": { record: "plugin.description", audience: "accounts" },
  "plugin.contact": { record: "contact", audience: "accounts" },
  "plugin.called": {
    record: "plugin.call",
    audience: "plugin",
    request: {
      recipient: "plugin_id",
      answers: ["plugin.result", "plugin.failed"],
      droppedAs: "plugin.dropped",
    },
  },
  "plugin.result": { record: "plugin.result", audience: "accounts" },
  "plugin.failed": { record: "plugin.failure", audience: "accounts" },
  "plugin.dropped": { record: "drop", audience: "accounts" },
  "object.stored": { record: "object", audience: "accounts" },
  "object.changed": { record: "object", audience: "accounts" },
  "object.deleted": { record: "deletion", audience: "accounts" },
  "definitions.refused": { record: "refusal", audience: "accounts" },
  "tasks.requested": {
    record: "task",
    many: true,
    audience: "asset",
    request: { ...TO_ASSET, answers: ["report.status"] },
  },
  "tasks.updated": {
    record: "task",
    many: true,
    audience: "asset",
    request: { ...TO_ASSET, answers: ["report.status"] },
  },
  "settings.requested": {
    record: "settings_change",
    audience: "asset",
    request: { ...TO_ASSET, answers: ["report.settings"] },
  },
  "cancel.requested": {
    record: "cancel",
    audience: "asset",
    request: { ...TO_ASSET, answers: ["report.status"] },
  },
  "task.dropped": { record: "drop", audience: "asset" },
  "request.dropped": { record: "drop", audience: "accounts" },
  "report.status": { record: "report.status", ...REPORT },
  "report.failsafe": { record: "report.failsafe", ...REPORT },
  "report.telemetry": { record: "report.telemetry", ...REPORT },
  "report.battery": { record: "report.battery", ...REPORT },
  "report.gimbal": { record: "report.gimbal", ...REPORT },
  "report.settings": { record: "report.settings", ...REPORT },
  "report.observation": { record: "report.observation", ...REPORT },
  "track.updated": { record: "track", audience: "accounts" },
  "track.removed": { record: "track", audience: "accounts" },
  "geofeature.created": {
    record: "geofeature",
    audience: "accounts",
    stamps: ["requested_by"],
  },
  "geofeature.replaced": {
    record: "geofeature",
    audience: "accounts",
    stamps: ["requested_by"],
  },
  "geofeature.deleted": {
    record: "geofeature",
    audience: "accounts",
    stamps: ["requested_by"],
  },
} as const satisfies Record<string, KindSpec>;

export type EventKind = keyof typeof EVENT_KINDS;
type Spec<K extends EventKind> = (typeof EVENT_KINDS)[K];
export type RecordOf<K extends EventKind> =
  Spec<K> extends { many: true }
    ? ProtocolTypes[Spec<K>["record"]][]
    : ProtocolTypes[Spec<K>["record"]];
export type RequestKind = {
  [K in EventKind]: Spec<K> extends { request: object } ? K : never;
}[EventKind];
export type ReportKind = Extract<EventKind, `report.${string}`>;

export type EventExtra = { requested_by?: string; clock_ahead?: true };

export type AtlasEvent<K extends EventKind = EventKind> = K extends EventKind
  ? {
      event_id: number;
      time: number;
      kind: K;
      record: RecordOf<K>;
    } & EventExtra
  : never;

export function assertKindsMatchProtocol(
  protocolNames: readonly string[],
): void {
  for (const spec of Object.values(EVENT_KINDS))
    if (!protocolNames.includes(spec.record))
      throw new Error(`missing Protocol record ${spec.record}`);
  for (const name of protocolNames)
    if (name.startsWith("report.") && !(name in EVENT_KINDS))
      throw new Error(`missing event kind ${name}`);
}

export const TABLES: TableDef[] = [
  {
    owner: "shared",
    name: "events",
    runScoped: true,
    ddl: `
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
-- Observations: latest per (asset_id, observation_id)
CREATE INDEX IF NOT EXISTS events_observation ON events(run_id, asset_id, observation_id, order_time, event_id)
  WHERE kind = 'report.observation' AND clock_ahead = 0;
-- Plugin calls and their answers
CREATE INDEX IF NOT EXISTS events_plugin ON events(run_id, plugin_id, kind, event_id) WHERE plugin_id IS NOT NULL;
-- Track and geo feature history
CREATE INDEX IF NOT EXISTS events_track ON events(run_id, track_id, order_time, event_id) WHERE kind LIKE 'track.%';
CREATE INDEX IF NOT EXISTS events_geofeature ON events(run_id, geofeature_id, event_id) WHERE kind LIKE 'geofeature.%';
`,
  },
];

export function appendEvent<K extends EventKind>(
  tx: Tx,
  kind: K,
  record: RecordOf<K>,
  extra?: EventExtra,
): number {
  const spec: KindSpec = EVENT_KINDS[kind];
  const records = spec.many ? (record as unknown[]) : [record];
  for (const value of records) {
    const checked = tx.env.protocol.check(spec.record, value);
    if (!checked.ok)
      throw new Error(
        `Core built invalid ${kind}: ${JSON.stringify(checked.problems)}`,
      );
  }
  for (const stamp of Object.keys(extra ?? {}))
    if (!spec.stamps?.includes(stamp as "clock_ahead" | "requested_by"))
      throw new Error(`illegal stamp ${stamp}`);
  const first = records[0];
  const asset =
    first &&
    typeof first === "object" &&
    "asset_id" in first &&
    typeof first.asset_id === "string"
      ? first.asset_id
      : null;
  const event_id = tx.get<{ id: number }>(
    "INSERT INTO events(run_id,time,kind,asset_id,record,requested_by,clock_ahead) VALUES (?,?,?,?,?,?,?) RETURNING event_id id",
    tx.runId,
    tx.now,
    kind,
    asset,
    JSON.stringify(record),
    extra?.requested_by ?? null,
    extra?.clock_ahead ? 1 : 0,
  )!.id;
  if (
    kind.endsWith(".contact") ||
    kind.startsWith("track.") ||
    kind.endsWith(".dropped")
  ) {
    const subject =
      kind === "asset.contact"
        ? "Asset"
        : kind === "gateway.contact"
          ? "Gateway"
          : "Plugin";
    const details: Record<string, unknown> = {};
    for (const field of [
      "asset_id",
      "gateway_id",
      "plugin_id",
      "track_id",
      "task_id",
      "request_id",
      "contact",
    ])
      if (field in record) details[field] = Reflect.get(record, field);
    tx.env.log.record({
      ...details,
      ...(kind.endsWith(".contact")
        ? { last_heard: Reflect.get(record, "time") }
        : {}),
      level: "info",
      area: kind.startsWith("track.")
        ? "fusion"
        : kind.endsWith(".contact")
          ? "contact"
          : "requests",
      msg: kind.endsWith(".contact") ? `${subject} contact changed` : kind,
      kind,
      event_id,
    });
  }
  return event_id;
}

export function getEvent(tx: ReadTx, eventId: number): AtlasEvent | undefined {
  const row = tx.get<EventRow>(
    "SELECT * FROM events WHERE run_id=? AND event_id=?",
    tx.runId,
    eventId,
  );
  return row ? event(row) : undefined;
}

export type Recipient = { asset_id: string } | { plugin_id: string };

const answersRequest = Object.entries(EVENT_KINDS)
  .flatMap(([kind, spec]) => {
    if (!("request" in spec)) return [];
    const r = spec.request;
    const kinds = [...r.answers, r.droppedAs].map((k) => `'${k}'`).join(",");
    return [
      `(e.kind='${kind}' AND a.${r.recipient}=e.${r.recipient} AND a.kind IN (${kinds}))`,
    ];
  })
  .join(" OR ");
const settlementMatch = `a.run_id=e.run_id AND a.request_id=e.event_id AND (${answersRequest})`;

export function unsettledRequests(
  tx: ReadTx,
  to: Recipient,
): AtlasEvent<RequestKind>[] {
  const column = "asset_id" in to ? "asset_id" : "plugin_id";
  const id = "asset_id" in to ? to.asset_id : to.plugin_id;
  const kinds = Object.entries(EVENT_KINDS)
    .filter(([, s]) => "request" in s)
    .map(([k]) => k);
  return tx
    .all<EventRow>(
      `SELECT e.* FROM events e WHERE e.run_id=? AND e.${column}=? AND e.kind IN (${kinds.map(() => "?").join(",")}) AND NOT EXISTS (SELECT 1 FROM events a WHERE ${settlementMatch}) ORDER BY event_id`,
      tx.runId,
      id,
      ...kinds,
    )
    .map(event) as AtlasEvent<RequestKind>[];
}

export type Settlement =
  | { state: "unsettled" }
  | { state: "answered"; by: AtlasEvent }
  | { state: "dropped"; by: AtlasEvent };
export function settlement(tx: ReadTx, requestEventId: number): Settlement {
  const row = tx.get<EventRow>(
    `SELECT a.* FROM events e JOIN events a ON ${settlementMatch} WHERE e.run_id=? AND e.event_id=? ORDER BY a.event_id LIMIT 1`,
    tx.runId,
    requestEventId,
  );
  if (!row) return { state: "unsettled" };
  return {
    state:
      row.kind === "request.dropped" || row.kind === "plugin.dropped"
        ? "dropped"
        : "answered",
    by: event(row),
  };
}

export function dropUnsettled(tx: Tx, to: Recipient): number[] {
  return unsettledRequests(tx, to).map((e) => {
    tx.append("asset_id" in to ? "request.dropped" : "plugin.dropped", {
      time: tx.now,
      ...to,
      request_id: e.event_id,
    });
    return e.event_id;
  });
}

export type Audience =
  | { kind: "everything"; asset_id?: string } // accounts; optional ?asset_id= filter
  | { kind: "assets"; assetIds: (tx: ReadTx) => readonly string[] } // an Asset on IP (one id) or a gateway (its carried Assets)
  | { kind: "plugin"; plugin_id: string };

export function pageAfter(
  tx: ReadTx,
  audience: Audience,
  after: number,
  limit: number,
): AtlasEvent[] {
  let filter = "",
    args: (string | number)[] = [];
  if (audience.kind === "everything" && audience.asset_id) {
    filter = " AND e.asset_id=?";
    args = [audience.asset_id];
  }
  if (audience.kind !== "everything") {
    if (audience.kind === "plugin") {
      filter = " AND e.kind='plugin.called' AND e.plugin_id=?";
      args = [audience.plugin_id];
    } else {
      const ids = audience.assetIds(tx);
      if (!ids.length) return [];
      const kinds = Object.entries(EVENT_KINDS)
        .filter(([, s]) => s.audience === "asset")
        .map(([k]) => k);
      filter = ` AND e.asset_id IN (${ids.map(() => "?")}) AND e.kind IN (${kinds.map(() => "?")})`;
      args = [...ids, ...kinds];
    }
    filter +=
      " AND NOT EXISTS (SELECT 1 FROM events d WHERE d.run_id=e.run_id AND d.request_id=e.event_id AND d.kind IN ('request.dropped','plugin.dropped'))";
  }
  return tx
    .all<EventRow>(
      `SELECT e.* FROM events e WHERE e.run_id=? AND e.event_id>?${filter} ORDER BY e.event_id LIMIT ?`,
      tx.runId,
      after,
      ...args,
      Math.min(256, limit),
    )
    .map(event);
}

export type LatestWhere =
  | { asset_id: string; kind: "report.gimbal"; camera_id: string }
  | { asset_id: string; kind: ReportKind; sub_kind?: string }
  | {
      asset_id: string;
      kind: "report.status";
      sub_kind: "subsystem";
      subsystem_id: string;
    }
  | { asset_id: string; kind: "report.settings"; setting: string }; // json_extract(record, '$.settings.<name>') IS NOT NULL
export function latestReport(
  tx: ReadTx,
  where: LatestWhere,
): AtlasEvent<ReportKind> | undefined {
  const args: (number | string)[] = [tx.runId, where.asset_id, where.kind];
  let filter = "";
  if ("sub_kind" in where && where.sub_kind) {
    filter += " AND sub_kind=?";
    args.push(where.sub_kind);
  }
  if ("subsystem_id" in where) {
    filter += " AND subsystem_id=?";
    args.push(where.subsystem_id);
  }
  if ("camera_id" in where) {
    filter += " AND json_extract(record,'$.camera_id')=?";
    args.push(where.camera_id);
  }
  if ("setting" in where) {
    filter += " AND json_extract(record,?) IS NOT NULL";
    args.push("$.settings." + where.setting);
  }
  const row = tx.get<EventRow>(
    `SELECT * FROM events WHERE run_id=? AND asset_id=? AND kind=? AND clock_ahead=0${filter} ORDER BY order_time DESC,event_id DESC LIMIT 1`,
    ...args,
  );
  return row ? (event(row) as AtlasEvent<ReportKind>) : undefined;
}

export type Cursor = string;
export type HistoryPage<T> = {
  as_of: number;
  items: T[];
  next_cursor: Cursor | null;
};

export type HistoryQuery =
  | {
      of: "reports";
      asset_id?: string;
      report?: ReportKind;
      since?: number;
      until?: number;
    }
  | { of: "tracks"; track_id?: string; since?: number; until?: number }
  | {
      of: "geofeatures";
      geofeature_id?: string;
      since?: number;
      until?: number;
    };

export function historyPage(
  tx: ReadTx,
  q: HistoryQuery,
  cursor: Cursor | null,
  limit: number,
): HistoryPage<AtlasEvent> {
  const args: (string | number)[] = [tx.runId];
  let filter =
    q.of === "reports"
      ? "kind LIKE 'report.%'"
      : q.of === "tracks"
        ? "kind LIKE 'track.%'"
        : "kind LIKE 'geofeature.%'";
  for (const key of ["asset_id", "track_id", "geofeature_id"] as const)
    if (key in q) {
      const value = Reflect.get(q, key);
      if (typeof value === "string") {
        filter += ` AND ${key}=?`;
        args.push(value);
      }
    }
  if ("report" in q && q.report) {
    filter += " AND kind=?";
    args.push(q.report);
  }
  if (q.since !== undefined) {
    filter += " AND order_time>=?";
    args.push(q.since);
  }
  if (q.until !== undefined) {
    filter += " AND order_time<=?";
    args.push(q.until);
  }
  const order = q.of === "geofeatures" ? "event_id" : "order_time";
  if (cursor) {
    const [time, id] = JSON.parse(Buffer.from(cursor, "base64url").toString());
    filter += ` AND (${order},event_id)>(?,?)`;
    args.push(time, id);
  }
  const size = Math.min(1000, Math.max(1, limit));
  const rows = tx.all<EventRow & { order_time: number }>(
    `SELECT * FROM events WHERE run_id=? AND ${filter} ORDER BY ${order},event_id LIMIT ?`,
    ...args,
    size + 1,
  );
  const more = rows.length > size;
  const selected = rows.slice(0, size);
  const last = selected.at(-1);
  return {
    as_of: tx.asOf(),
    items: selected.map(event),
    next_cursor:
      more && last
        ? Buffer.from(
            JSON.stringify([
              q.of === "geofeatures" ? last.event_id : last.order_time,
              last.event_id,
            ]),
          ).toString("base64url")
        : null,
  };
}

type EventRow = {
  event_id: number;
  time: number;
  kind: EventKind;
  record: string;
  requested_by: string | null;
  clock_ahead: number;
};
function event(row: EventRow): AtlasEvent {
  return {
    event_id: row.event_id,
    time: row.time,
    kind: row.kind,
    record: JSON.parse(row.record),
    ...(row.requested_by ? { requested_by: row.requested_by } : {}),
    ...(row.clock_ahead ? { clock_ahead: true as const } : {}),
  } as AtlasEvent;
}
