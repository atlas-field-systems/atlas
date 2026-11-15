import type {
  ComponentsFailsafeResponse,
  ComponentsPosition,
  ComponentsSettings,
  ComponentsAltitude,
} from "@atlas/protocol/types";
import type { Config } from "./config.ts";
import { distance, fresh, type Measurements } from "./vehicle.ts";

type Preparation = {
  action: ComponentsFailsafeResponse;
  settings: ComponentsSettings;
  position: ComponentsPosition;
  config: Config;
};
type Resolved = {
  initialStep?: number;
  destination?: ComponentsPosition;
  transit_altitude?: ComponentsAltitude;
  speed: number;
};
export interface Execution extends Resolved {
  kind: CommandKind;
  action: ComponentsFailsafeResponse;
  started: number;
  step: number;
}
type Context = {
  execution: Execution;
  measurements: Measurements;
  config: Config;
  now: number;
};
const position = (c: Context): ComponentsPosition | undefined =>
  fresh(c.measurements.position, c.now, c.config.measurement_stale_after_s);
const tolerance = (
  c: Context,
): { horizontal_m: number; altitude_m: number; stopped_mps: number } =>
  c.config.completion_tolerances[c.execution.kind]!;
function at(c: Context, target: ComponentsPosition): boolean {
  const p = position(c);
  return Boolean(
    p &&
    distance(p, target) <= tolerance(c).horizontal_m &&
    (target.altitudes ?? []).every((a) => {
      const actual = p.altitudes?.find(
        (b) => b.altitude_reference === a.altitude_reference,
      );
      return (
        actual &&
        Math.abs(actual.altitude_m - a.altitude_m) <= tolerance(c).altitude_m
      );
    }),
  );
}
function atDestination(c: Context) {
  return !!c.execution.destination && at(c, c.execution.destination);
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
function speed(p: Preparation): number {
  return Math.min(
    p.action.kind === "move_to"
      ? (p.action.ground_speed_mps ?? (p.config.default_ground_speed_mps ?? 0))
      : (p.config.default_ground_speed_mps ?? 0),
    (p.config.max_ground_speed_mps ?? Infinity),
  );
}
function transit(p: Preparation, destination: ComponentsPosition): Resolved {
  const altitude =
    "transit_altitude" in p.action ? p.action.transit_altitude : undefined;
  const height =
    altitude ??
    p.position.altitudes?.find((a) => a.altitude_reference === "launch");
  if (!height) throw new Error("current transit altitude unavailable");
  return {
    destination: { ...destination, altitudes: [height] },
    transit_altitude: height,
    speed: speed(p),
  };
}
function move(c: Context) {
  if (!c.execution.destination) throw new Error("destination unavailable");
  return {
    kind: "move_to" as const,
    position: c.execution.destination,
    speed: c.execution.speed,
  };
}
const landing = {
  mode: 9,
  command: (c: Context) => ({
    kind: "land" as const,
    destination: c.execution.destination,
    transit_altitude: c.execution.transit_altitude,
  }),
  complete: landed,
};
const transitSteps = [
  {
    mode: 4,
    command: (c: Context) => {
      const p = position(c);
      if (!p || !c.execution.transit_altitude)
        throw new Error("transit altitude unavailable");
      return {
        kind: "move_to" as const,
        position: { ...p, altitudes: [c.execution.transit_altitude] },
        speed: c.execution.speed,
      };
    },
    complete: (c: Context): boolean => {
      const p = position(c);
      return (
        !!p &&
        !!c.execution.transit_altitude &&
        at(c, { ...p, altitudes: [c.execution.transit_altitude] })
      );
    },
  },
  { mode: 4, command: move, complete: atDestination },
  landing,
] as const;
export const commands = {
  takeoff: {
    prepare: (p: Preparation): Resolved => ({ speed: speed(p) }),
    steps: [
      {
        mode: 4,
        command: (c: Context) => {
          if (c.execution.action.kind !== "takeoff")
            throw new Error("invalid Takeoff execution");
          return {
            kind: "takeoff" as const,
            altitude: c.execution.action.target_altitude,
          };
        },
        complete: (c: Context): boolean => {
          const p = position(c);
          return (
            !!p &&
            fresh(c.measurements.armed, c.now, c.config.measurement_stale_after_s) === true &&
            fresh(c.measurements.airborne, c.now, c.config.measurement_stale_after_s) === true &&
            c.execution.action.kind === "takeoff" &&
            at(c, { ...p, altitudes: [c.execution.action.target_altitude] })
          );
        },
      },
    ],
    response: true,
    override: null,
  },
  move_to: {
    prepare: (p: Preparation): Resolved => {
      if (p.action.kind !== "move_to" || !p.action.destination)
        throw new Error(
          "Move To destination unavailable; a named place must include Core's position copy",
        );
      const destination = p.action.destination;
      const altitudes = destination.altitudes?.length
        ? destination.altitudes
        : p.position.altitudes?.filter(
            (a) => a.altitude_reference === "launch",
          );
      if (!altitudes?.length) throw new Error("current altitude unavailable");
      return { destination: { ...destination, altitudes }, speed: speed(p) };
    },
    steps: [{ mode: 4, command: move, complete: atDestination }],
    response: true,
    override: null,
  },
  land: {
    prepare: (p: Preparation): Resolved => {
      if (p.action.kind !== "land") throw new Error("invalid Land execution");
      if (p.action.geofeature_id && !p.action.landing_position)
        throw new Error("Land place has no position copy");
      if (!p.action.landing_position && !p.action.transit_altitude)
        return { destination: p.position, speed: speed(p), initialStep: 2 };
      return transit(p, p.action.landing_position ?? p.position);
    },
    steps: transitSteps,
    response: true,
    override: "stand",
  },
  return_to_home: {
    prepare: (p: Preparation): Resolved => {
      if (!p.settings.home_position) throw new Error("home unavailable");
      return transit(p, p.settings.home_position);
    },
    steps: [
      {
        mode: 4,
        command: (c: Context) => ({
          ...transitSteps[0]!.command(c),
          kind: "return_to_home" as const,
          destination: c.execution.destination,
          transit_altitude: c.execution.transit_altitude,
        }),
        complete: transitSteps[0]!.complete,
      },
      transitSteps[1]!,
      landing,
    ],
    response: true,
    override: "stand",
  },
  hold: {
    prepare: (p: Preparation): Resolved => ({ speed: speed(p) }),
    steps: [
      {
        mode: 4,
        command: () => ({ kind: "hold" as const }),
        complete: (c: Context): boolean => {
          const v = fresh(
            c.measurements.speed,
            c.now,
            c.config.measurement_stale_after_s,
          );
          return v !== undefined && v <= tolerance(c).stopped_mps;
        },
      },
    ],
    response: true,
    override: "rearm",
  },
} as const;
export type CommandKind = keyof typeof commands;
type StepCommand = ReturnType<
  (typeof commands)[CommandKind]["steps"][number]["command"]
>;
export type VehicleCommand = {
  [K in CommandKind]: Extract<StepCommand, { kind: K }>;
}[CommandKind] & { mode: number };
export type OverrideKind = {
  [K in CommandKind]: (typeof commands)[K]["override"] extends null ? never : K;
}[CommandKind];
export function isOverride(kind: string): kind is OverrideKind {
  return isCommand(kind) && commands[kind].override !== null;
}
export function isCommand(kind: string): kind is CommandKind {
  return Object.hasOwn(commands, kind);
}
export function prepare(
  action: ComponentsFailsafeResponse,
  settings: ComponentsSettings,
  measurements: Measurements,
  now: number,
  config: Config,
): Execution {
  if (!isCommand(action.kind))
    throw new Error(`unsupported command ${action.kind}`);
  const p = fresh(measurements.position, now, config.measurement_stale_after_s);
  if (
    !p ||
    fresh(measurements.armed, now, config.measurement_stale_after_s) ===
      undefined
  )
    throw new Error("current vehicle state unavailable");
  const resolved = commands[action.kind].prepare({
    action,
    settings,
    position: p,
    config,
  });
  return {
    action,
    kind: action.kind,
    started: now,
    ...resolved,
    step: resolved.initialStep ?? 0,
  };
}
export function vehicleStep(c: Context): VehicleCommand {
  const step = commands[c.execution.kind].steps[c.execution.step];
  if (!step) throw new Error("vehicle step unavailable");
  return { ...step.command(c), mode: step.mode };
}
export function progress(c: Context): "running" | "next" | "completed" {
  const steps = commands[c.execution.kind].steps;
  if (!steps[c.execution.step]?.complete(c)) return "running";
  return c.execution.step + 1 < steps.length ? "next" : "completed";
}

export function holdCommand(): VehicleCommand {
  const step = commands.hold.steps[0];
  return { ...step.command(), mode: step.mode };
}
