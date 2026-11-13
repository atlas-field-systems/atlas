/**
 * Fusion pillar (core/docs/fusion.md). A replaceable module that turns
 * Observations into Tracks. Two parts:
 *
 *  - FusionModule: the algorithm, a pure function. It reads a view of the
 *    current Tracks and returns the changes. It never touches storage, time,
 *    or IDs, so replacing it (DEMs, real association) changes one file.
 *  - the follower: follows the event log for report.observation like any other
 *    reader (pillars.md#rules), and applies the module's changes through
 *    Entities.putTrack / removeTrack. Its cursor advances in the same
 *    transaction as the Track changes it caused, so after a crash it resumes
 *    exactly where its last commit left off: no Observation is fused twice or skipped.
 *
 * Owns one table, `fusion_cursor` (doc gap G17: storage.md lists none for Fusion).
 */
import type { ProtocolTypes } from "@atlas/protocol/types";
import type { Store, TableDef } from "../store/db.ts";

type Track = ProtocolTypes["track"];
type Observation = ProtocolTypes["report.observation"];

export const TABLES: TableDef[] = [
  {
    owner: "fusion",
    name: "fusion_cursor",
    runScoped: true,
    ddl: `
CREATE TABLE IF NOT EXISTS fusion_cursor (
  run_id         INTEGER PRIMARY KEY,
  after_event_id INTEGER NOT NULL          -- last report.observation event Fusion handled
);`,
  },
];

export type TrackChange =
  | { put: Omit<Track, "track_id"> & { track_id?: string } } // no track_id: a new Track
  | { remove: string };

export interface TrackView {
  withSource(asset_id: string, observation_id: string): readonly Track[];
}

export interface FusionModule {
  readonly name: string;
  /** Called once per stored, not clock_ahead, report.observation, in event_id order. */
  observe(observation: Observation, tracks: TrackView): TrackChange[];
}

/**
 * The temporary first iteration (fusion.md): one Track per (asset_id,
 * observation_id), never removed. A newer report replaces it; an older one
 * (a retained report caught up after a gap) changes nothing, because a
 * Track's time is its newest sighting.
 *
 *   [t] = tracks.withSource(o.asset_id, o.observation_id)
 *   if (t && t.time >= o.time) return []
 *   return [{ put: { track_id: t?.track_id, time: o.time, entity_type: o.entity_type,
 *                    details: o.details,
 *                    ...(o.kind === 'coordinates' && { position: o.position, uncertainty: o.uncertainty }),
 *                    sources: [{ asset_id: o.asset_id, observation_id: o.observation_id }] } }]
 */
export const onePerObservation: FusionModule = {
  name: "one-track-per-observation",
  observe(observation, tracks) {
    throw new Error("not implemented");
  },
};

export interface Follower {
  /** Resolves once the cursor reaches the last event stored (Reset waits on it before the ZIP). */
  drain(): Promise<void>;
  stop(): void;
}

/**
 * Wakes on Store.onCommit. Loop: in one write transaction, read up to 100
 * report.observation events after the cursor (not clock_ahead), call
 * module.observe for each with a view over Entities.tracksWithSource, apply
 * the changes, set the cursor to the last event read. Repeat until a page is
 * empty. A module that throws is logged with the event_id and the cursor
 * passes that event (one bad Observation never stops Fusion); the gap is
 * recorded in diagnostics.
 */
export function startFusion(store: Store, module: FusionModule): Follower {
  throw new Error("not implemented");
}
