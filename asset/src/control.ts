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
  task: Task | null;
  rule: ComponentsFailsafeRule | null;
};
type Mode =
  | { kind: "ready" }
  | { kind: "running"; work: Work }
  | { kind: "paused"; work: Work | null }
  | {
      kind: "failsafe";
      work: Work | null;
      override: "hold" | "protected" | null;
    }
  | { kind: "watching" }
  | { kind: "shutting_down" };
export interface State {
  mode: Mode;
  measurements: Measurements;
  settings: ComponentsSettings;
  locked: boolean;
  contact: { open: boolean; last_heard: number | null };
  lastHeard: number;
  matching: string[];
  idleSince: number;
}
export type Event =
  | { kind: "tick"; now: number; hasWork: boolean }
  | { kind: "measurements"; measurements: Measurements }
  | { kind: "task"; task: Task; now: number }
  | { kind: "update"; task: Task; now: number }
  | { kind: "cancel"; id: number; now: number }
  | { kind: "settings"; settings: ComponentsSettings; now: number }
  | { kind: "command_failed"; explanation: string; now: number }
  | { kind: "contact"; contact: State["contact"] };
export type Effect =
  | { kind: "vehicle"; command: VehicleCommand }
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
  | { kind: "autopilot"; in_control: boolean }
  | { kind: "clear" }
  | { kind: "shutdown" };
export function initial(config: Config, now: number): State {
  return {
    mode: { kind: "ready" },
    measurements: {},
    settings: config.initial_settings,
    locked: false,
    contact: { open: false, last_heard: now },
    lastHeard: now,
    matching: [],
    idleSince: now,
  };
}
function work(s: State) {
  return "work" in s.mode ? s.mode.work : null;
}
export function reduce(
  previous: State,
  event: Event,
  config: Config,
): { state: State; effects: Effect[] } {
  let state: State = { ...previous };
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
  ) {
    try {
      const execution = prepare(
        action,
        state.settings,
        state.measurements,
        now,
        config,
      );
      const w = { execution, task, rule };
      state.mode = state.locked
        ? {
            kind: "failsafe",
            work: w,
            override: task
              ? action.kind === "hold"
                ? "hold"
                : "protected"
              : null,
          }
        : { kind: "running", work: w };
      if (task) effects.push({ kind: "task", task, status: "active" });
      else effects.push({ kind: "response", rule, action, status: "active" });
      effects.push({
        kind: "vehicle",
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
      state.mode = state.locked
        ? { kind: "failsafe", work: null, override: null }
        : { kind: "ready" };
    }
  }
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
      if (!w?.task || w.task.task_id !== event.task.task_id || state.locked ||
          event.task.kind === "settings" || event.task.kind === "failsafe") break;
      const execution = prepare(event.task, state.settings, state.measurements, event.now, config);
      execution.started = w.execution.started;
      const updated = { ...w, task: event.task, execution };
      if (state.mode.kind === "paused") state.mode = { kind: "paused", work: updated };
      else {
        state.mode = { kind: "running", work: updated };
        effects.push({ kind: "vehicle", command: commands[execution.action.kind].start({ execution, measurements: state.measurements, config, now: event.now }) });
      }
      break;
    }
    case "cancel": {
      const w = work(state);
      if (w?.task?.task_id === event.id && !state.locked) {
        finish(w, "cancelled");
        effects.push({ kind: "vehicle", command: { kind: "hold" } });
        state.mode = { kind: "ready" };
      }
      break;
    }
    case "task": {
      const task = event.task;
      if (
        state.mode.kind === "watching" ||
        (state.locked &&
          !(task.now && ["land", "hold", "return_to_home"].includes(task.kind)))
      ) {
        effects.push({
          kind: "task",
          task,
          status: "failed",
          explanation: "failsafe locks ordinary work",
        });
        break;
      }
      const w = work(state);
      if (w) finish(w, "cancelled");
      if (task.kind === "settings") {
        state.settings = { ...state.settings, ...task.settings };
        effects.push({ kind: "task", task, status: "completed" });
      } else if (task.kind === "failsafe") {
        state.locked = true;
        effects.push(
          { kind: "clear" },
          { kind: "task", task, status: "completed" },
        );
        start(config.safe_action, null, null, event.now);
      } else {
        start(task, task, null, event.now);
      }
      break;
    }
    case "settings": {
      if (state.mode.kind === "watching") break;
      if (
        state.locked &&
        Object.keys(event.settings).some((k) => k !== "run_state")
      )
        break;
      state.settings = { ...state.settings, ...event.settings };
      const w = work(state);
      if (event.settings.run_state === "paused") {
        effects.push({ kind: "vehicle", command: { kind: "hold" } });
        state.mode = state.locked
          ? { kind: "failsafe", work: w, override: "hold" }
          : { kind: "paused", work: w };
      } else if (event.settings.run_state === "running" && w) {
        effects.push({
          kind: "vehicle",
          command: commands[w.execution.action.kind].start({
            execution: w.execution,
            measurements: state.measurements,
            config,
            now: event.now,
          }),
        });
        state.mode = state.locked
          ? { kind: "failsafe", work: w, override: null }
          : { kind: "running", work: w };
      } else if (event.settings.run_state === "running" && !state.locked)
        state.mode = { kind: "ready" };
      break;
    }
    case "command_failed": {
      const w = work(state);
      if (w) finish(w, "failed", event.explanation);
      effects.push({ kind: "clear" });
      state.mode = state.locked
        ? { kind: "failsafe", work: null, override: null }
        : { kind: "ready" };
      const battery = fresh(
        state.measurements.battery,
        event.now,
        config.measurement_stale_after_s,
      );
      if (
        w?.rule &&
        w.execution.action.kind !== "return_to_home" &&
        w.rule.conditions.some(
          (c) =>
            c.kind === "battery_below" &&
            c.critical &&
            battery !== undefined &&
            battery < c.battery_percent,
        )
      )
        start({ kind: "return_to_home" }, null, null, event.now);
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
        state.mode.kind !== "watching"
      ) {
        const interrupted = work(state);
        if (interrupted) finish(interrupted, "cancelled");
        state.locked = true;
        state.mode = { kind: "watching" };
        effects.push(
          { kind: "clear" },
          { kind: "autopilot", in_control: true },
        );
      }
      if (state.mode.kind === "watching") {
        if (controlled === true) {
          state.mode = { kind: "failsafe", work: null, override: "hold" };
          effects.push(
            { kind: "autopilot", in_control: false },
            { kind: "vehicle", command: { kind: "hold" } },
          );
        } else {
          if (
            get(state.measurements.armed) === false &&
            get(state.measurements.airborne) === false
          ) {
            state.mode = { kind: "shutting_down" };
            effects.push({ kind: "shutdown" });
          }
          break;
        }
      }
      const w = work(state);
      const paused =
        state.mode.kind === "paused" ||
        (state.mode.kind === "failsafe" &&
          state.settings.run_state === "paused");
      if (w && !paused) {
        const ctx = {
          execution: w.execution,
          measurements: state.measurements,
          config,
          now,
        };
        if (commands[w.execution.action.kind].complete(ctx)) {
          finish(w, "completed");
          state.mode = state.locked
            ? { kind: "failsafe", work: null, override: null }
            : { kind: "ready" };
        } else if (
          now - w.execution.started >
          config.command_timeouts[w.execution.action.kind] * 1000
        ) {
          finish(w, "failed", "command timeout");
          effects.push({ kind: "clear" });
          state.mode = state.locked
            ? { kind: "failsafe", work: null, override: null }
            : { kind: "ready" };
        }
      }
      if (event.hasWork || work(state)) state.idleSince = now;
      const matching = (state.settings.failsafe_policy ?? [])
        .filter((r) =>
          r.conditions.every((c) => {
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
                return (
                  !event.hasWork &&
                  !work(state) &&
                  now - state.idleSince >= c.for_s * 1000
                );
              case "commanded":
              case "outside_area":
              case "subsystem":
                return false;
            }
          }),
        )
        .sort((a, b) => b.priority - a.priority);
      const critical = matching.find((r) =>
        r.conditions.some((c) => c.kind === "battery_below" && c.critical),
      );
      const holdOverride =
        state.mode.kind === "failsafe" && state.mode.override === "hold";
      const protectedOverride =
        state.mode.kind === "failsafe" && state.mode.override === "protected";
      const candidate =
        critical && holdOverride
          ? critical
          : matching.find((r) => !state.matching.includes(r.rule_id));
      state.matching = matching.map((r) => r.rule_id);
      if (candidate) {
        const current = work(state);
        if (
          !protectedOverride &&
          (!current?.rule ||
            candidate.priority > current.rule.priority ||
            (critical === candidate && holdOverride))
        ) {
          if (current) finish(current, "cancelled");
          state.locked = true;
          state.settings = { ...state.settings, run_state: "running" };
          effects.push({ kind: "clear" });
          start(candidate.response, null, candidate, now);
        }
      }
      if (
        state.locked &&
        !work(state) &&
        get(state.measurements.armed) === false &&
        get(state.measurements.airborne) === false
      ) {
        state.mode = { kind: "shutting_down" };
        effects.push({ kind: "shutdown" });
      }
      break;
    }
  }
  return { state, effects };
}
