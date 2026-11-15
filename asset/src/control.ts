import type { Task } from "@atlas/sdk";
import type {
  ComponentsSettings,
  ComponentsFailsafeRule,
  ComponentsFailsafeResponse,
} from "@atlas/protocol/types";
import type { Config } from "./config.ts";
import { commands, prepare, type Execution } from "./commands.ts";
import { fresh, type Measurements, type VehicleCommand } from "./vehicle.ts";
type Work = {
  execution: Execution;
  operationId: number;
  pausedAt: number | null;
  pausedMs: number;
  task: Task | null;
  rule: ComponentsFailsafeRule | null;
  fallback: boolean;
};
type Override = {
  kind: "hold" | "pause" | "land" | "return_to_home";
  request_id?: number;
};
export interface State {
  phase: "ordinary" | "failsafe" | "flight_controller" | "stopping";
  execution: Work | null;
  override: Override | null;
  rules: Record<
    string,
    { holds: boolean; armed: boolean; since: number | null }
  >;
  measurements: Measurements;
  settings: ComponentsSettings;
  contact: { open: boolean; last_heard: number | null };
  commandId: number;
  lastHeard: number;
  idleSince: number;
}
export type Event =
  | { kind: "tick"; now: number; hasWork: boolean }
  | { kind: "measurements"; measurements: Measurements }
  | { kind: "task"; task: Task; now: number; request_id?: number }
  | { kind: "update"; task: Task; now: number }
  | { kind: "cancel"; id: number; now: number }
  | {
      kind: "settings";
      settings: ComponentsSettings;
      now: number;
      request_id?: number;
    }
  | {
      kind: "command_failed";
      explanation: string;
      now: number;
      execution_id: number;
    }
  | { kind: "contact"; contact: State["contact"] };
export type Effect =
  | { kind: "vehicle"; execution_id: number; command: VehicleCommand }
  | {
      kind: "task";
      task: Task;
      status: "active" | "completed" | "failed" | "cancelled";
      explanation?: string;
    }
  | {
      kind: "response";
      rule: ComponentsFailsafeRule | null;
      action: ComponentsFailsafeResponse;
      status: "active" | "completed" | "failed" | "cancelled";
      explanation?: string;
    }
  | { kind: "override"; request_id: number }
  | { kind: "autopilot"; in_control: boolean }
  | { kind: "clear" }
  | { kind: "shutdown" };
export function initial(config: Config, now: number): State {
  return {
    phase: "ordinary",
    execution: null,
    override: null,
    rules: {},
    measurements: {},
    settings: config.initial_settings,
    contact: { open: false, last_heard: now },
    commandId: 0,
    lastHeard: now,
    idleSince: now,
  };
}
function work(s: State) {
  return s.execution;
}
export function reduce(
  previous: State,
  event: Event,
  config: Config,
): { state: State; effects: Effect[] } {
  let state: State = {
    ...previous,
    rules: Object.fromEntries(
      Object.entries(previous.rules).map(([id, r]) => [id, { ...r }]),
    ),
  };
  const effects: Effect[] = [];
  function finish(
    w: Work,
    status: "completed" | "failed" | "cancelled",
    explanation?: string,
  ) {
    if (w.task)
      effects.push({ kind: "task", task: w.task, status, explanation });
    else
      effects.push({
        kind: "response",
        rule: w.rule,
        action: w.execution.action,
        status,
        explanation,
      });
  }
  function start(
    action: ComponentsFailsafeResponse,
    task: Task | null,
    rule: ComponentsFailsafeRule | null,
    now: number,
    fallback = false,
  ) {
    try {
      const execution = prepare(
        action,
        state.settings,
        state.measurements,
        now,
        config,
      );
      state.execution = {
        execution,
        task,
        rule,
        operationId: state.commandId + 1,
        pausedAt: null,
        pausedMs: 0,
        fallback,
      };
      if (task) effects.push({ kind: "task", task, status: "active" });
      else effects.push({ kind: "response", rule, action, status: "active" });
      effects.push({
        kind: "vehicle",
        execution_id: ++state.commandId,
        command: commands[execution.action.kind].start({
          execution,
          measurements: state.measurements,
          config,
          now,
        }),
      });
    } catch (error) {
      const explanation =
        error instanceof Error ? error.message : "command failed";
      if (task)
        effects.push({ kind: "task", task, status: "failed", explanation });
      else
        effects.push({
          kind: "response",
          rule,
          action,
          status: "failed",
          explanation,
        });
      effects.push({ kind: "clear" });
      state.execution = null;
      if (criticalFallback(rule, action, now, fallback))
        activate({ kind: "return_to_home" }, rule, now, true);
      else
        effects.push({
          kind: "vehicle",
          execution_id: ++state.commandId,
          command: { kind: "hold" },
        });
    }
  }
  function criticalFallback(
    rule: ComponentsFailsafeRule | null,
    action: ComponentsFailsafeResponse,
    now: number,
    fallback: boolean,
  ) {
    const battery = fresh(
      state.measurements.battery,
      now,
      config.measurement_stale_after_s,
    );
    return (
      !fallback &&
      action.kind !== "return_to_home" &&
      rule?.conditions.some(
        (c) =>
          c.kind === "battery_below" &&
          c.critical &&
          battery !== undefined &&
          battery < c.battery_percent,
      )
    );
  }
  function activate(
    action: ComponentsFailsafeResponse,
    rule: ComponentsFailsafeRule | null,
    now: number,
    fallback = false,
  ) {
    const current = work(state);
    if (current) finish(current, "cancelled");
    state.phase = "failsafe";
    state.override = null;
    state.settings = { ...state.settings, run_state: "running" };
    state.execution = null;
    effects.push({ kind: "clear" });
    start(action, null, rule, now, fallback);
  }
  function matches(
    rule: ComponentsFailsafeRule,
    now: number,
    commanded = false,
  ): boolean {
    const get = <T>(m: Parameters<typeof fresh<T>>[0]) =>
      fresh(m, now, config.measurement_stale_after_s);
    return rule.conditions.every((c) => {
      switch (c.kind) {
        case "battery_below": {
          const b = get(state.measurements.battery);
          return b !== undefined && b < c.battery_percent;
        }
        case "airborne":
          return get(state.measurements.airborne) === true;
        case "contact_lost":
          return (
            now - state.lastHeard >=
            (state.settings.link_loss_after_s ?? Infinity) * 1000
          );
        case "idle":
          return !work(state) && now - state.idleSince >= c.for_s * 1000;
        case "commanded":
          return commanded;
        case "outside_area":
        case "subsystem":
          return false;
      }
    });
  }
  function rearm() {
    for (const r of Object.values(state.rules)) r.armed = true;
  }
  function issue(w: Work, now: number) {
    state.commandId++;
    state.execution = { ...w, operationId: state.commandId };
    effects.push({
      kind: "vehicle",
      execution_id: state.commandId,
      command: commands[w.execution.action.kind].start({
        execution: w.execution,
        measurements: state.measurements,
        config,
        now,
      }),
    });
  }
  if (state.phase === "stopping") return { state, effects };
  switch (event.kind) {
    case "measurements":
      state.measurements = { ...state.measurements, ...event.measurements };
      return { state, effects };
    case "contact":
      state.contact = event.contact;
      if (event.contact.last_heard !== null)
        state.lastHeard = Math.max(state.lastHeard, event.contact.last_heard);
      return { state, effects };
    case "update": {
      const w = work(state);
      if (
        !w?.task ||
        w.task.task_id !== event.task.task_id ||
        state.phase !== "ordinary" ||
        event.task.kind === "settings" ||
        event.task.kind === "failsafe"
      )
        break;
      const execution = prepare(
        event.task,
        state.settings,
        state.measurements,
        event.now,
        config,
      );
      execution.started = w.execution.started;
      const updated = { ...w, task: event.task, execution };
      state.execution = updated;
      if (updated.pausedAt === null) issue(updated, event.now);
      break;
    }
    case "cancel": {
      const w = work(state);
      if (w?.task?.task_id === event.id && state.phase === "ordinary") {
        finish(w, "cancelled");
        effects.push({
          kind: "vehicle",
          execution_id: ++state.commandId,
          command: { kind: "hold" },
        });
        state.execution = null;
      }
      break;
    }
    case "task": {
      const task = event.task;
      if (
        state.phase === "flight_controller" ||
        (state.phase !== "ordinary" &&
          !(task.now && ["land", "hold", "return_to_home"].includes(task.kind)))
      ) {
        effects.push({
          kind: "task",
          task,
          status: "failed",
          explanation:
            state.phase === "flight_controller"
              ? "flight controller is in control"
              : "failsafe locks ordinary work",
        });
        break;
      }
      if (task.kind === "settings") {
        const changed = reduce(
          state,
          {
            kind: "settings",
            settings: task.settings,
            now: event.now,
            request_id: event.request_id,
          },
          config,
        );
        state = changed.state;
        effects.push(...changed.effects, {
          kind: "task",
          task,
          status: "completed",
        });
      } else if (task.kind === "failsafe") {
        const rule =
          (state.settings.failsafe_policy ?? [])
            .filter(
              (r) =>
                r.conditions.some((c) => c.kind === "commanded") &&
                matches(r, event.now, true),
            )
            .sort((a, b) => b.priority - a.priority)[0] ?? null;
        effects.push({ kind: "task", task, status: "completed" });
        activate(rule?.response ?? config.safe_action, rule, event.now);
      } else {
        const current = work(state);
        if (current) finish(current, "cancelled");
        if (state.phase === "failsafe") {
          if (event.request_id !== undefined)
            effects.push({ kind: "override", request_id: event.request_id });
          if (
            task.kind === "hold" ||
            task.kind === "land" ||
            task.kind === "return_to_home"
          )
            state.override = { kind: task.kind, request_id: event.request_id };
          if (task.kind === "hold") rearm();
        }
        start(task, task, null, event.now);
      }
      break;
    }
    case "settings": {
      if (state.phase === "flight_controller") break;
      if (
        state.phase !== "ordinary" &&
        Object.keys(event.settings).some((k) => k !== "run_state")
      )
        break;
      if (state.phase === "failsafe" && event.request_id !== undefined)
        effects.push({ kind: "override", request_id: event.request_id });
      const wasPaused = state.settings.run_state === "paused";
      state.settings = { ...state.settings, ...event.settings };
      const paused = state.settings.run_state === "paused";
      const w = work(state);
      if (paused && !wasPaused) {
        if (w) state.execution = { ...w, pausedAt: event.now };
        effects.push({
          kind: "vehicle",
          execution_id: ++state.commandId,
          command: { kind: "hold" },
        });
        if (state.phase === "failsafe") {
          state.override = { kind: "pause", request_id: event.request_id };
          rearm();
        }
      } else if (!paused && wasPaused) {
        if (state.override?.kind === "pause") state.override = null;
        if (w && w.pausedAt !== null)
          issue(
            {
              ...w,
              pausedAt: null,
              pausedMs: w.pausedMs + event.now - w.pausedAt,
            },
            event.now,
          );
      }
      break;
    }
    case "command_failed": {
      if (
        event.execution_id !== state.commandId ||
        state.phase === "flight_controller"
      )
        break;
      const w = work(state);
      if (!w) break;
      finish(w, "failed", event.explanation);
      effects.push({ kind: "clear" });
      state.execution = null;
      if (criticalFallback(w.rule, w.execution.action, event.now, w.fallback))
        activate({ kind: "return_to_home" }, w.rule, event.now, true);
      if (!state.execution)
        effects.push({
          kind: "vehicle",
          execution_id: ++state.commandId,
          command: { kind: "hold" },
        });
      break;
    }
    case "tick": {
      const now = event.now;
      const get = <T>(m: Parameters<typeof fresh<T>>[0]) =>
        fresh(m, now, config.measurement_stale_after_s);
      if (!state.settings.home_position) {
        const p = get(state.measurements.position);
        if (p) state.settings = { ...state.settings, home_position: p };
      }
      const controlled = get(state.measurements.guided);
      if (
        controlled === false &&
        get(state.measurements.armed) === true &&
        state.phase !== "flight_controller"
      ) {
        const interrupted = work(state);
        if (interrupted) finish(interrupted, "cancelled");
        state.phase = "flight_controller";
        state.execution = null;
        state.override = null;
        effects.push(
          { kind: "clear" },
          { kind: "autopilot", in_control: true },
        );
      }
      if (state.phase === "flight_controller") {
        if (controlled === true) {
          state.phase = "failsafe";
          state.override = { kind: "hold" };
          rearm();
          effects.push(
            { kind: "autopilot", in_control: false },
            {
              kind: "vehicle",
              execution_id: ++state.commandId,
              command: { kind: "hold" },
            },
          );
        } else {
          if (
            get(state.measurements.armed) === false &&
            get(state.measurements.airborne) === false
          ) {
            state.phase = "stopping";
            effects.push({ kind: "shutdown" });
          }
          break;
        }
      }
      const w = work(state);
      if (w && w.pausedAt === null) {
        const ctx = {
          execution: w.execution,
          measurements: state.measurements,
          config,
          now,
        };
        if (commands[w.execution.action.kind].complete(ctx)) {
          finish(w, "completed");
          state.execution = null;
        } else if (
          now - w.execution.started - w.pausedMs >
          config.command_timeouts[w.execution.action.kind] * 1000
        ) {
          const failed = reduce(
            state,
            {
              kind: "command_failed",
              execution_id: state.commandId,
              explanation: "command timeout",
              now,
            },
            config,
          );
          state = failed.state;
          effects.push(...failed.effects);
        }
      }
      if (event.hasWork || work(state)) state.idleSince = now;
      const matching = (state.settings.failsafe_policy ?? [])
        .filter((r) => {
          const holds =
            matches(r, now) &&
            !(event.hasWork && r.conditions.some((c) => c.kind === "idle"));
          const prior = state.rules[r.rule_id] ?? {
            holds: false,
            armed: true,
            since: null,
          };
          state.rules[r.rule_id] = {
            holds,
            armed: holds ? prior.armed : true,
            since: holds ? (prior.since ?? now) : null,
          };
          return holds;
        })
        .sort((a, b) => b.priority - a.priority);
      const held =
        state.override?.kind === "hold" || state.override?.kind === "pause";
      const critical = held
        ? matching.find((r) =>
            r.conditions.some((c) => c.kind === "battery_below" && c.critical),
          )
        : undefined;
      const candidate =
        critical ??
        matching.find(
          (r) =>
            state.rules[r.rule_id]!.armed && !previous.rules[r.rule_id]?.holds,
        );
      for (const r of matching) state.rules[r.rule_id]!.armed = false;
      const current = work(state);
      const protectedOverride =
        state.override?.kind === "land" ||
        state.override?.kind === "return_to_home";
      if (
        candidate &&
        !protectedOverride &&
        (held || !current?.rule || candidate.priority > current.rule.priority)
      ) {
        activate(candidate.response, candidate, now);
      }
      if (
        state.phase !== "ordinary" &&
        !work(state) &&
        get(state.measurements.armed) === false &&
        get(state.measurements.airborne) === false
      ) {
        state.phase = "stopping";
        effects.push({ kind: "shutdown" });
      }
      break;
    }
  }
  return { state, effects };
}
