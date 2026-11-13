/**
 * Entities pillar (pillars.md): the shared picture. Assets with their
 * descriptions, contact, reports, and settings; Observations; Tracks; geo
 * features. Owns `assets`, `tracks`, `geofeatures`.
 *
 * Reports, Observations, settings values, and subsystem conditions have no
 * table: they are events, and "latest" is store/events.ts latestReport
 * (storage.md: "no report is kept twice").
 */
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

// --- who an Asset is ---------------------------------------------------------

/** The Asset a key registered in this run and that was not removed. */
export function assetForKey(tx: ReadTx, key_id: string): string | null {
  return (
    tx.get<{ asset_id: string }>(
      "SELECT asset_id FROM assets WHERE run_id=? AND key_id=? AND removed=0",
      tx.runId,
      key_id,
    )?.asset_id ?? null
  );
}
/** The gateway carrying a radio Asset, or null for an Asset on IP. */
export function carrierOf(tx: ReadTx, asset_id: string): string | null {
  return (
    tx.get<{ gateway_id: string | null }>(
      "SELECT gateway_id FROM assets WHERE run_id=? AND asset_id=? AND removed=0",
      tx.runId,
      asset_id,
    )?.gateway_id ?? null
  );
}
/** Assets a gateway registered in this run (its stream audience; api.md#radio-assets). Removed ones too: their drops still reach it. */
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

// --- registration (api.md#asset-and-gateway-calls, #radio-assets) -------------

/**
 * POST /entities/assets, an Asset key, body requests.asset.
 * - The key has a live Asset this run → it is the same Asset, started again
 *   (runs-and-identity.md#keys-and-registration): store the new description,
 *   add asset.described, then Tasks.dropUnfinished (task.dropped for every Task
 *   with no final report). Same asset_id.
 * - Otherwise nextGlobalId; none left → refuse asset_ids_exhausted and print
 *   it (runs-and-identity.md#ids). Insert the row online, add
 *   asset.registered {time, asset_id} and asset.described.
 * Answer 201 {asset_id, last_task_id} (Tasks.lastTaskId, 0 for a new Asset).
 * Unsettled settings and cancel requests of a restarted app: doc gap G8.
 */
export function registerAsset(
  tx: Tx,
  key_id: string,
  body: ProtocolTypes["requests.asset"],
): { asset_id: string; last_task_id: number } {
  throw new Error("not implemented");
}

/**
 * POST /entities/assets/radios, a gateway, body requests.radio.
 * A different definitions hash is refused, but the refusal is itself a change:
 * it adds definitions.refused {time, gateway_id, radio: true, definitions_hash}
 * and commits. So this returns the refusal instead of throwing it.
 * Otherwise: new asset_id, row with gateway_id, description NULL, contact
 * offline until the gateway sends one; asset.registered with requested_by =
 * gateway_id. 201 {asset_id}.
 */
export function registerRadio(
  tx: Tx,
  gateway_id: string,
  body: ProtocolTypes["requests.radio"],
):
  | { registered: true; asset_id: string }
  | { registered: false; refusal_event_id: number } {
  throw new Error("not implemented");
}

/**
 * PUT /entities/assets/{asset_id}/description, the carrying gateway, body the
 * description record. A radio Asset signs up: the first time after
 * registration, and again each time its app starts. Every time after the
 * first is a restarted app (api.md#radio-assets): Tasks.dropUnfinished.
 * Adds asset.described. The record's asset_id must equal the path's (400).
 */
export function signUpRadio(
  tx: Tx,
  asset_id: string,
  description: Description,
): { event_id: number } {
  throw new Error("not implemented");
}

/** DELETE /administration/assets/{asset_id}, an admin. Marks it removed; adds asset.removed. Unfinished work: doc gap G14. */
export function removeAsset(
  tx: Tx,
  asset_id: string,
  by: string,
): { event_id: number } {
  throw new Error("not implemented");
}

// --- reports (api.md#asset-and-gateway-calls) ---------------------------------

/**
 * POST /entities/assets/{asset_id}/reports {"reports": [...]}, the Asset or its gateway.
 * The whole batch is stored or none of it (one transaction), then 200.
 * For each report, in batch order:
 *  1. `type` must name a report kind, then protocol.check(type, report) (400 invalid, path prefixed /reports/<i>).
 *  2. report.asset_id must equal the path's asset_id (403).
 *  3. clock_ahead = report.time > tx.now + clock_ahead_s*1000.
 *  4. append `report.<name>` with {clock_ahead} when set.
 *  5. report.status kind 'task'  → Tasks.applyTaskReport (moves state forward only; see tasks.ts).
 *     report.status kind 'queue' → Tasks.applyQueueReport, unless clock_ahead (it is a latest value).
 * Observations need nothing more: Fusion follows the log.
 * An empty batch stores nothing and still answers 200: the call itself is the
 * contact (api.md#contact); the API pipeline already told contact.ts.
 */
export function storeReports(
  tx: Tx,
  asset_id: string,
  reports: unknown[],
): { stored: number } {
  throw new Error("not implemented");
}

// --- contact (api.md#contact) ------------------------------------------------

/**
 * The one place an Asset's contact changes. Called by:
 *  - PUT /entities/assets/{asset_id}/contact (its gateway, a contact record);
 *  - contact.ts, for an Asset on IP heard again or gone quiet, and for every
 *    Asset of a gateway that went quiet or was removed.
 * Stores the record and adds asset.contact only when online/offline changes.
 * Going offline, in this same transaction (api.md#operator-requests):
 *  dropUnsettled({asset_id}) → request.dropped for each unanswered request,
 *  then Tasks.dropUnconfirmed(asset_id) → task.dropped for each Task the Asset
 *  never reported holding.
 */
export function applyContact(
  tx: Tx,
  asset_id: string,
  record: Contact,
): { changed: boolean } {
  throw new Error("not implemented");
}
/** For contact.resume() and the contact sweep: Assets on IP this run shows online. */
export function onlineAssetsOnIp(tx: ReadTx): string[] {
  throw new Error("not implemented");
}

// --- what admission needs to know about an Asset ---------------------------

/**
 * Everything Tasks and settings admission check against, read once
 * (api.md#operator-requests). online is Core's view: for a radio Asset, its
 * gateway's latest contact record for it, and offline whenever the gateway is.
 */
export type AdmissionView = {
  asset_id: string;
  description: Description; // a radio Asset not yet signed up has none → refused not_supported
  online: boolean;
  flying: boolean; // description lists takeoff
  hasCriticalBatteryRule: boolean; // latest reported failsafe_policy has a battery_below rule with critical: true
};
/** 404 for an unknown or removed Asset. */
export function admissionView(tx: ReadTx, asset_id: string): AdmissionView {
  throw new Error("not implemented");
}
/** Pure: does this policy keep a critical battery rule? Used for the current policy and for a requested one. */
export function policyHasCriticalBatteryRule(
  policy: Settings["failsafe_policy"],
): boolean {
  throw new Error("not implemented");
}

// --- settings (api.md#operator-requests) ---------------------------------------

/**
 * PATCH /entities/assets/{asset_id}/settings, an account, body requests.settings.
 * Refuse: asset_offline; not_supported for a setting the description does
 * not list; no_critical_battery_rule when a flying Asset's new
 * failsafe_policy has none. Then settings.requested with a settings_change
 * record {time, asset_id, requested_by, settings}. 202 {event_id}.
 */
export function requestSettings(
  tx: Tx,
  asset_id: string,
  body: ProtocolTypes["requests.settings"],
  by: string,
): { event_id: number } {
  throw new Error("not implemented");
}

// --- reads (api.md#reads, #entities) -------------------------------------------

/** One Asset as GET /entities/assets shows it. The shape is Core's; api.md should state it (see core/docs/api.md). */
export type AssetEntry = {
  asset_id: string;
  gateway_id: string | null;
  description: Description | null;
  contact: Contact;
  /** Latest report of each kind except report.observation, by report time, never clock_ahead. */
  reports: Partial<Record<Exclude<ReportKind, "report.observation">, Report>>;
  /** Each setting's latest value, from the newest report.settings that carries it. */
  settings: Partial<{
    [K in keyof Settings]: { value: Settings[K]; time: number };
  }>;
  /** Each declared subsystem's latest condition. */
  subsystems: Record<string, ProtocolTypes["report.status"]>;
};

export function listAssets(tx: ReadTx): {
  as_of: number;
  items: AssetEntry[];
  gateways: Contact[];
} {
  throw new Error("not implemented");
}
export function getAsset(
  tx: ReadTx,
  asset_id: string,
): { as_of: number; item: AssetEntry } {
  throw new Error("not implemented");
}
/** Latest report.observation per (asset_id, observation_id); one window query on events_observation. */
export function listObservations(tx: ReadTx): {
  as_of: number;
  items: Observation[];
} {
  throw new Error("not implemented");
}
export function listTracks(tx: ReadTx): { as_of: number; items: Track[] } {
  throw new Error("not implemented");
}
export function getTrack(
  tx: ReadTx,
  track_id: string,
): { as_of: number; item: Track } {
  throw new Error("not implemented");
}
export function listGeofeatures(tx: ReadTx): {
  as_of: number;
  items: Geofeature[];
} {
  throw new Error("not implemented");
}
export function getGeofeature(
  tx: ReadTx,
  geofeature_id: string,
): { as_of: number; item: Geofeature } {
  throw new Error("not implemented");
}
/** GET /entities: the four lists from one ReadTx, so one as_of covers them all. */
export function picture(tx: ReadTx): {
  as_of: number;
  assets: AssetEntry[];
  observations: Observation[];
  tracks: Track[];
  geofeatures: Geofeature[];
} {
  throw new Error("not implemented");
}

/** GET /history, /history/tracks, /history/geofeatures: store/events.ts historyPage with limit ≤ 1000. */
export function history(
  tx: ReadTx,
  of: "reports" | "tracks" | "geofeatures",
  query: URLSearchParams,
  cursor: Cursor | null,
): HistoryPage<AtlasEvent> {
  throw new Error("not implemented");
}

// --- geo features (api.md#geo-features) ------------------------------------

/**
 * POST /entities/geofeatures. An account, a Plugin, an Asset on IP, or a
 * gateway acting for an Asset it carries. Imagery: the Object must exist
 * (Objects.objectForImagery: 404) and be a GeoTIFF (409 not_geotiff).
 * Assigns geofeature_id, adds geofeature.created with requested_by. 200 {geofeature, event_id}.
 */
export function createGeofeature(
  tx: Tx,
  body: ProtocolTypes["requests.geofeature"],
  by: string,
): { geofeature: Geofeature; event_id: number } {
  throw new Error("not implemented");
}

/**
 * PUT /entities/geofeatures/{id}?update_tasks=, an account. Replaces whole
 * (a name left out is cleared). Imagery may change only its name, and no
 * other kind becomes imagery (409 imagery_fixed). Adds geofeature.replaced.
 * With update_tasks=true, Tasks.updatePlace(tx, geofeature, by) in this same
 * transaction makes a new copy for each unfinished Task naming it, one
 * tasks.updated per online Asset, and reports the offline ones.
 * Never refused because Tasks name the place, and never cancels a Task.
 */
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
  throw new Error("not implemented");
}

/** DELETE, an account. Adds geofeature.deleted with the record as it last stood. Leaves Tasks, Objects, and imagery's Object. */
export function deleteGeofeature(
  tx: Tx,
  geofeature_id: string,
  by: string,
): { event_id: number } {
  throw new Error("not implemented");
}

/**
 * For Tasks admission: a move_to or land naming a place gets a copy of its
 * position. 404 when the place does not exist in the run or was deleted;
 * 409 not_a_point otherwise.
 */
export function pointOf(tx: ReadTx, geofeature_id: string): Position {
  throw new Error("not implemented");
}
/** For Objects: does an existing geo feature have this ID? (attach, upload with geofeature_id) */
export function geofeatureExists(tx: ReadTx, geofeature_id: string): boolean {
  throw new Error("not implemented");
}
/** For Objects: is an imagery geo feature still showing this Object? (api.md#objects: 409 on delete) */
export function imageryShows(tx: ReadTx, object_id: string): boolean {
  throw new Error("not implemented");
}

// --- Tracks: written only by Fusion, through these two (api.md#tracks) -----

/** Creates (no track_id: assigns the next) or replaces a Track; adds track.updated. Returns the track_id. */
export function putTrack(
  tx: Tx,
  track: Omit<Track, "track_id"> & { track_id?: string },
): string {
  throw new Error("not implemented");
}
/** Deletes the row; adds track.removed with the Track as it last stood. */
export function removeTrack(tx: Tx, track_id: string): void {
  throw new Error("not implemented");
}
/** Fusion's view: current Tracks that list this source. */
export function tracksWithSource(
  tx: ReadTx,
  asset_id: string,
  observation_id: string,
): Track[] {
  throw new Error("not implemented");
}

/** Reset ZIP state/: assets, tracks, geofeatures. */
export function exportRows(tx: ReadTx): {
  assets: unknown[];
  tracks: unknown[];
  geofeatures: unknown[];
} {
  throw new Error("not implemented");
}

export function assetIdInUse(tx: ReadTx, id: string): boolean {
  return !!tx.get(
    "SELECT 1 FROM assets WHERE run_id=? AND asset_id=?",
    tx.runId,
    id,
  );
}
