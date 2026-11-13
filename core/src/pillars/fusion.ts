import type { ProtocolTypes } from "@atlas/protocol/types";
import * as entities from "./entities.ts";
import { getEvent } from "../store/events.ts";
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
  observe(observation: Observation, tracks: TrackView): TrackChange[];
}

export const onePerObservation: FusionModule = {
  name: "one-track-per-observation",
  observe(observation, tracks) {
    const old = tracks.withSource(
      observation.asset_id,
      observation.observation_id,
    )[0];
    if (old && old.time >= observation.time) return [];
    return [
      {
        put: {
          ...(old ? { track_id: old.track_id } : {}),
          time: observation.time,
          ...(observation.entity_type
            ? { entity_type: observation.entity_type }
            : {}),
          ...(observation.details ? { details: observation.details } : {}),
          ...(observation.kind === "coordinates"
            ? {
                position: observation.position,
                ...(observation.uncertainty
                  ? { uncertainty: observation.uncertainty }
                  : {}),
              }
            : {}),
          sources: [
            {
              asset_id: observation.asset_id,
              observation_id: observation.observation_id,
            },
          ],
        },
      },
    ];
  },
};

export interface Follower {
  drain(): Promise<void>;
  stop(): void;
}

export function startFusion(store: Store, module: FusionModule): Follower {
  let stopped = false;
  function follow(): void {
    if (stopped) return;
    while (true) {
      const count = store.write((tx) => {
        const cursor =
          tx.get<{ after_event_id: number }>(
            "SELECT after_event_id FROM fusion_cursor WHERE run_id=?",
            tx.runId,
          )?.after_event_id ?? 0;
        const ids = tx.all<{ event_id: number }>(
          "SELECT event_id FROM events WHERE run_id=? AND kind='report.observation' AND event_id>? AND clock_ahead=0 ORDER BY event_id LIMIT 100",
          tx.runId,
          cursor,
        );
        for (const { event_id } of ids) {
          const e = getEvent(tx, event_id);
          if (e?.kind !== "report.observation") continue;
          let changes: TrackChange[];
          try {
            changes = module.observe(e.record, {
              withSource: (a, o) => entities.tracksWithSource(tx, a, o),
            });
          } catch (error) {
            tx.env.log.record({
              level: "error",
              area: "fusion",
              msg: "Observation skipped",
              event_id,
              error: String(error),
            });
            continue;
          }
          for (const change of changes)
            if ("put" in change) entities.putTrack(tx, change.put);
            else entities.removeTrack(tx, change.remove);
        }
        const last = ids.at(-1);
        if (last)
          tx.run(
            "INSERT INTO fusion_cursor VALUES (?,?) ON CONFLICT(run_id) DO UPDATE SET after_event_id=excluded.after_event_id",
            tx.runId,
            last.event_id,
          );
        return ids.length;
      });
      if (count < 100) break;
    }
  }
  // Empty writes emit commit notifications too; only new observations wake the follower.
  const unsubscribe = store.onCommit(() => {
    if (stopped) return;
    const pending = store.read(
      (tx) =>
        !!tx.get(
          "SELECT 1 FROM events WHERE run_id=? AND kind='report.observation' AND clock_ahead=0 AND event_id>COALESCE((SELECT after_event_id FROM fusion_cursor WHERE run_id=?),0) LIMIT 1",
          tx.runId,
          tx.runId,
        ),
    );
    if (pending) {
      try {
        follow();
      } catch (error) {
        store.read((tx) =>
          tx.env.log.record({
            level: "error",
            area: "fusion",
            msg: "Follower transaction failed; cursor retained",
            error: String(error),
          }),
        );
      }
    }
  });
  follow();
  return {
    async drain() {
      follow();
    },
    stop() {
      stopped = true;
      unsubscribe();
    },
  };
}
