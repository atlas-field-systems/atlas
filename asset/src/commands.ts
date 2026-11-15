import type {
  ComponentsFailsafeResponse,
  ComponentsPosition,
  ComponentsSettings,
} from "@atlas/protocol/types";
import type { Config } from "./config.ts";
import {
  distance,
  fresh,
  type Measurements,
  type VehicleCommand,
} from "./vehicle.ts";
export type Action = Extract<
  ComponentsFailsafeResponse,
  { kind: "takeoff" | "move_to" | "land" | "hold" | "return_to_home" }
>;
export interface Execution {
  action: Action;
  started: number;
  destination?: ComponentsPosition;
}
export function prepare(
  action: ComponentsFailsafeResponse,
  settings: ComponentsSettings,
  measurements: Measurements,
  now: number,
  config: Config,
): Execution {
  if (
    !["takeoff", "move_to", "land", "hold", "return_to_home"].includes(
      action.kind,
    )
  )
    throw new Error(`unsupported command ${action.kind}`);
  const position = fresh(
    measurements.position,
    now,
    config.measurement_stale_after_s,
  );
  if (
    !position ||
    fresh(measurements.armed, now, config.measurement_stale_after_s) ===
      undefined
  )
    throw new Error("current vehicle state unavailable");
  switch (action.kind) {
    case "takeoff":
      return { action, started: now };
    case "move_to":
      if (!action.destination) throw new Error("Move To has no destination");
      return { action, started: now, destination: action.destination };
    case "return_to_home":
      if (!settings.home_position) throw new Error("home unavailable");
      return { action, started: now, destination: settings.home_position };
    case "land":
      return { action, started: now, destination: action.landing_position };
    case "hold":
      return { action, started: now };
    default:
      throw new Error(`unsupported command ${action.kind}`);
  }
}
type Context = {
  execution: Execution;
  measurements: Measurements;
  config: Config;
  now: number;
};
const position = (c: Context) =>
  fresh(c.measurements.position, c.now, c.config.measurement_stale_after_s);
function atDestination(c: Context) {
  const p = position(c),
    target = c.execution.destination;
  return Boolean(
    p &&
    target &&
    distance(p, target) <= c.config.completion_tolerances.horizontal_m &&
    (target.altitudes ?? []).every((a) => {
      const actual = p.altitudes?.find(
        (b) => b.altitude_reference === a.altitude_reference,
      );
      return (
        actual &&
        Math.abs(actual.altitude_m - a.altitude_m) <=
          c.config.completion_tolerances.altitude_m
      );
    }),
  );
}
function landed(c: Context) {
  return (
    fresh(c.measurements.armed, c.now, c.config.measurement_stale_after_s) ===
      false &&
    fresh(
      c.measurements.airborne,
      c.now,
      c.config.measurement_stale_after_s,
    ) === false
  );
}
export const commands: Record<
  Action["kind"],
  { start(c: Context): VehicleCommand; complete(c: Context): boolean }
> = {
  takeoff: {
    start: (c) => {
      if (c.execution.action.kind !== "takeoff")
        throw new Error("wrong execution");
      return { kind: "takeoff", altitude: c.execution.action.target_altitude };
    },
    complete: (c) => {
      if (c.execution.action.kind !== "takeoff") return false;
      const target = c.execution.action.target_altitude;
      const actual = position(c)?.altitudes?.find(
        (a) => a.altitude_reference === target.altitude_reference,
      );
      return Boolean(
        actual &&
        Math.abs(actual.altitude_m - target.altitude_m) <=
          c.config.completion_tolerances.altitude_m,
      );
    },
  },
  move_to: {
    start: (c) => {
      if (!c.execution.destination || c.execution.action.kind !== "move_to")
        throw new Error("destination unavailable");
      return {
        kind: "move_to",
        position: c.execution.destination,
        speed: Math.min(
          c.execution.action.ground_speed_mps ??
            c.config.default_ground_speed_mps,
          c.config.max_ground_speed_mps,
        ),
      };
    },
    complete: atDestination,
  },
  land: { start: () => ({ kind: "land" }), complete: landed },
  return_to_home: {
    start: () => ({ kind: "return_to_home" }),
    complete: landed,
  },
  hold: {
    start: () => ({ kind: "hold" }),
    complete: (c) => {
      const speed = fresh(
        c.measurements.speed,
        c.now,
        c.config.measurement_stale_after_s,
      );
      return (
        speed !== undefined &&
        speed <= c.config.completion_tolerances.stopped_mps
      );
    },
  },
};
