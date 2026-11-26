import type { Task, QueueRequest } from "@atlas/sdk";
import type {
  ComponentsSettings,
  ComponentsFailsafeRule,
  ComponentsFailsafeResponse,
} from "@atlas/protocol/types";
import { parseConfig, type Config } from "./config.ts";
import { outsideBoundary } from "./boundary.ts";
import {
  commands,
  descending,
  nextStage,
  updateExecution,
  isOverride,
  prepare,
  vehicleStep,
  progress,
  holdCommand,
  type Execution,
} from "./commands.ts";
import { fresh, type Measurements, type VehicleCommand } from "./vehicle.ts";
// Protocol's documented default for the link_loss_after_s setting.
const LINK_LOSS_AFTER_S_DEFAULT = 30;
type Work = {
  execution: Execution;
  pausedAt: number | null;
  pausedMs: number;
  task: Task | null;
  rule: ComponentsFailsafeRule | null;
  fallback: boolean;
  override: "rearm" | "stand" | null;
};
export interface State {
  phase: "ordinary" | "failsafe" | "flight_controller" | "stopping";
  execution: Work | null;
  override: "rearm" | "stand" | "pause" | null;
  idle: { since: number | null };
  rules: Record<
    string,
    { holds: boolean; conditions: Record<string, { since: number | null }> }
  >;
  measurements: Measurements;
  settings: ComponentsSettings;
  safeStop: { issuedAt: number | null; acceptedAt: number | null } | null;
  commandId: number;
  lastHeard: number;
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
  | { kind: "command_accepted"; execution_id: number; now: number }
  | { kind: "contact"; contact: { open: boolean; last_heard: number | null } };
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
  | { kind: "settings"; settings: ComponentsSettings; request_id?: number }
  | { kind: "override"; request_id: number }
  | { kind: "autopilot"; in_control: boolean }
  | { kind: "clear" }
  | { kind: "shutdown" }
  | { kind: "diagnostic"; explanation: string };
export function refusal(state: State, request: QueueRequest): string | undefined {
  if (state.phase === "flight_controller") return "flight controller is in control";
  if (state.safeStop && request.kind === "task" && !(request.task.now && isOverride(request.task.kind))) return "equipment stop is pending";
  if (state.phase === "ordinary") return;
  if (request.kind === "task" && request.task.now && isOverride(request.task.kind)) return;
  return "failsafe locks ordinary work";
}
export function canPullTask(state: State): boolean {
  return !state.safeStop && !state.execution && state.phase === "ordinary" && state.settings.run_state !== "paused";
}
export function initial(config: Config, now: number): State {
  const idle: { since: number | null } = { since: now };
  return {
    phase: "ordinary",
    execution: null,
    override: null,
    idle,
    rules: Object.fromEntries((config.initial_settings.failsafe_policy ?? []).map(rule => [rule.rule_id, {
      holds: false,
      conditions: Object.fromEntries(rule.conditions.filter(c => c.kind === "idle").map(c => [c.kind, idle])),
    }])),
    measurements: {},
    settings: config.initial_settings,
    safeStop: null,
    commandId: 0,
    lastHeard: now,
  };
}
export function reduce(
  previous: State,
  event: Event,
  config: Config,
): { state: State; effects: Effect[] } {
  const timing = structuredClone({ rules: previous.rules, idle: previous.idle });
  let state: State = { ...previous, ...timing };
  const effects: Effect[] = [];
  function finish(
    w: Work,
    status: "completed" | "failed" | "cancelled",
    explanation?: string,
  ) {
    if (state.override === "stand") state.override = null;
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
      state.safeStop = null;
      const execution = prepare(
        action,
        state.settings,
        state.measurements,
        now,
        config,
      );
      state.idle.since = null;
      state.execution = {
        execution,
        task,
        rule,
        pausedAt: null,
        pausedMs: 0,
        fallback,
        override: state.override === "pause" ? null : state.override,
      };
      if (task) effects.push({ kind: "task", task, status: "active" });
      else effects.push({ kind: "response", rule, action, status: "active" });
      effects.push({
        kind: "vehicle",
        execution_id: ++state.commandId,
        command: vehicleStep({
          execution,
          measurements: state.measurements,
          config,
          now,
        }),
      });
    } catch (error) {
      failed(action, task, rule, now, fallback, error);
    }
  }
  function stop(now: number) {
    state.safeStop = { issuedAt: now, acceptedAt: null };
    effects.push({ kind: "vehicle", execution_id: ++state.commandId, command: holdCommand() });
  }
  function failed(
    action: ComponentsFailsafeResponse,
    task: Task | null,
    rule: ComponentsFailsafeRule | null,
    now: number,
    fallback: boolean,
    error: unknown,
  ) {
    const explanation = error instanceof Error ? error.message : "command failed";
    if (task) effects.push({ kind: "task", task, status: "failed", explanation });
    else effects.push({ kind: "response", rule, action, status: "failed", explanation });
    effects.push({ kind: "clear" });
    const failedStandingOverride = state.override === "stand" || state.execution?.override === "stand";
    const inDescent = descending(state.execution?.execution);
    state.execution = null;
    if (failedStandingOverride) {
      state.override = "rearm";
      rearm(now);
    }
    if (criticalFallback(rule, action, now, fallback))
      activate({ kind: "return_to_home" }, rule, now, true);
    else if (!inDescent) stop(now);
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
    const current = state.execution;
    if (current) finish(current, "cancelled");
    state.phase = "failsafe";
    state.override = null;
    if (state.settings.run_state !== "running") {
      state.settings = { ...state.settings, run_state: "running" };
    }
    state.execution = null;
    effects.push({ kind: "clear" });
    start(action, null, rule, now, fallback);
  }
  function matches(
    rule: ComponentsFailsafeRule,
    now: number,
    commanded = false,
    hasWork = false,
  ): boolean {
    const get = <T>(m: Parameters<typeof fresh<T>>[0]) =>
      fresh(m, now, config.measurement_stale_after_s);
    const record = state.rules[rule.rule_id] ??= { holds: false, conditions: {} };
    return rule.conditions.map((c) => {
      const key = c.kind === "idle" ? c.kind : JSON.stringify(c);
      let holds: boolean;
      switch (c.kind) {
        case "battery_below": {
          const b = get(state.measurements.battery);
          holds = b !== undefined && b < c.battery_percent;
          break;
        }
        case "airborne":
          holds = get(state.measurements.airborne) === true;
          break;
        case "contact_lost":
          holds = (
            now - state.lastHeard >=
            (state.settings.link_loss_after_s ?? LINK_LOSS_AFTER_S_DEFAULT) * 1000
          );
          break;
        case "idle":
          holds = !state.execution && !hasWork;
          break;
        case "commanded":
          holds = commanded;
          break;
        case "outside_area": {
          const position = get(state.measurements.position);
          holds = position !== undefined && outsideBoundary(position, c);
          break;
        }
        case "subsystem": {
          const condition = get(state.measurements.subsystems?.[c.subsystem_id])?.condition;
          holds = condition === "faulted" || (c.trigger_condition === "degraded" && condition === "degraded");
          break;
        }
      }
      const timer = record.conditions[key] ??= c.kind === "idle" ? state.idle : { since: null };
      if (c.kind !== "idle") timer.since = holds ? (timer.since ?? now) : null;
      const since = holds ? timer.since : null;
      return since !== null && (!("for_s" in c) || now - since >= (c.for_s ?? 0) * 1000);
    }).every(Boolean);
  }
  function rearm(now: number) {
    for (const rule of state.settings.failsafe_policy ?? []) {
      const holds = matches(rule, now);
      state.rules[rule.rule_id]!.holds = holds;
    }
  }
  function issue(w: Work, now: number) {
    try {
      const command = vehicleStep({ execution: w.execution, measurements: state.measurements, config, now });
      state.execution = w;
      effects.push({ kind: "vehicle", execution_id: ++state.commandId, command });
    } catch (error) {
      failed(w.execution.action, w.task, w.rule, now, w.fallback, error);
    }
  }
  if (state.phase === "stopping") return { state, effects };
  switch (event.kind) {
    case "measurements":
      state.measurements = { ...state.measurements, ...event.measurements, subsystems: { ...state.measurements.subsystems, ...event.measurements.subsystems } };
      if (
        event.measurements.in_control?.value === false &&
        state.measurements.armed?.value === true &&
        state.phase !== "flight_controller"
      ) {
        const interrupted = state.execution;
        if (interrupted) finish(interrupted, "cancelled");
        state.safeStop = null;
        state.phase = "flight_controller";
        state.execution = null;
        state.override = null;
        effects.push(
          { kind: "clear" },
          { kind: "autopilot", in_control: true },
        );
      }
      return { state, effects };
    case "contact":
      if (event.contact.last_heard !== null)
        state.lastHeard = Math.max(state.lastHeard, event.contact.last_heard);
      return { state, effects };
    case "update": {
      const w = state.execution;
      if (
        !w?.task ||
        w.task.task_id !== event.task.task_id ||
        state.phase !== "ordinary" ||
        event.task.kind === "settings" ||
        event.task.kind === "failsafe"
      )
        break;
      try {
        const execution = updateExecution(w.execution, event.task, state.settings, state.measurements, event.now, config);
        const updated = { ...w, task: event.task, execution };
        if (updated.pausedAt === null) {
          const command = vehicleStep({ execution, measurements: state.measurements, config, now: event.now });
          effects.push({ kind: "vehicle", execution_id: ++state.commandId, command });
        }
        state.execution = updated;
      } catch (error) {
        effects.push({ kind: "diagnostic", explanation: error instanceof Error ? error.message : String(error) });
      }
      break;
    }
    case "cancel": {
      const w = state.execution;
      if (w?.task?.task_id === event.id && state.phase === "ordinary") {
        finish(w, "cancelled");
        stop(event.now);
        state.execution = null;
      }
      break;
    }
    case "task": {
      const task = event.task;
      const explanation = refusal(state, { kind: "task", task });
      if (explanation !== undefined) {
        effects.push({ kind: "task", task, status: "failed", explanation });
        break;
      }
      if (task.kind === "settings") {
        if (task.settings.failsafe_policy !== undefined) {
          try {
            parseConfig({ ...config, initial_settings: { ...state.settings, ...task.settings } });
          } catch (error) {
            effects.push({ kind: "task", task, status: "failed", explanation: error instanceof Error ? error.message : String(error) }, { kind: "clear" });
            break;
          }
        }
        const current = state.execution;
        if (current) {
          finish(current, "cancelled");
          state.execution = null;
          stop(event.now);
        }
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
        const current = state.execution;
        if (current) finish(current, "cancelled");
        if (state.phase === "failsafe") {
          if (event.request_id !== undefined)
            effects.push({ kind: "override", request_id: event.request_id });
          if (isOverride(task.kind))
            state.override = commands[task.kind].override;
          if (isOverride(task.kind) && commands[task.kind].override === "rearm") rearm(event.now);
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
      if (state.phase === "failsafe" && event.request_id !== undefined &&
        event.settings.run_state !== undefined && event.settings.run_state !== state.settings.run_state)
        effects.push({ kind: "override", request_id: event.request_id });
      if (event.settings.failsafe_policy !== undefined) {
        try {
          parseConfig({ ...config, initial_settings: { ...state.settings, ...event.settings } });
        } catch (error) {
          effects.push({ kind: "diagnostic", explanation: error instanceof Error ? error.message : String(error) });
          break;
        }
      }
      const wasPaused = state.settings.run_state === "paused";
      if (Object.entries(event.settings).some(([key, value]) => Reflect.get(state.settings, key) !== value))
        state.settings = { ...state.settings, ...event.settings };
      const paused = state.settings.run_state === "paused";
      const w = state.execution;
      if (paused && !wasPaused) {
        if (w) state.execution = { ...w, pausedAt: event.now };
        effects.push({
          kind: "vehicle",
          execution_id: ++state.commandId,
          command: holdCommand(),
        });
        if (state.phase === "failsafe") {
          state.override = "pause";
          rearm(event.now);
        }
      } else if (!paused && wasPaused) {
        if (state.override === "pause") state.override = w?.override ?? null;
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
    case "command_accepted":
      if (event.execution_id === state.commandId && state.safeStop)
        state.safeStop = { ...state.safeStop, acceptedAt: event.now };
      break;
    case "command_failed": {
      if (
        event.execution_id !== state.commandId ||
        state.phase === "flight_controller"
      )
        break;
      const w = state.execution;
      if (!w) {
        if (state.safeStop) state.safeStop = { issuedAt: null, acceptedAt: null };
        break;
      }
      failed(w.execution.action, w.task, w.rule, event.now, w.fallback, new Error(event.explanation));
      break;
    }
    case "tick": {
      const now = event.now;
      const get = <T>(m: Parameters<typeof fresh<T>>[0]) =>
        fresh(m, now, config.measurement_stale_after_s);
      if (config.description.settings?.includes("home_position") && !state.settings.home_position) {
        const p = get(state.measurements.position);
        if (p) state.settings = { ...state.settings, home_position: p };
      }
      const controlled = get(state.measurements.in_control);
      if (state.phase === "flight_controller") {
        if (controlled === true) {
          state.phase = "failsafe";
          state.override = "rearm";
          rearm(event.now);
          effects.push({ kind: "autopilot", in_control: false });
          start({ kind: "hold" }, null, null, now);
          break;
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
      if (state.safeStop) {
        const stopIntent = state.safeStop;
        if (stopIntent.issuedAt === null) {
          if (get(state.measurements.connected) === true && get(state.measurements.position) && get(state.measurements.armed) !== undefined) stop(now);
        } else if (stopIntent.acceptedAt !== null && state.measurements.speed?.time != null && state.measurements.speed.time > stopIntent.acceptedAt && get(state.measurements.connected) === true && (get(state.measurements.speed) ?? Infinity) <= config.completion_tolerances.hold!.stopped_mps) {
          state.safeStop = null;
        } else if (now - stopIntent.issuedAt > config.command_timeouts.hold! * 1000) {
          state.safeStop = { issuedAt: null, acceptedAt: null };
        }
      }
      const w = state.execution;
      if (w && get(state.measurements.connected) === false) {
        failed(w.execution.action, w.task, w.rule, now, w.fallback, new Error("equipment connection lost"));
      } else if (w && w.pausedAt === null) {
        const ctx = {
          execution: w.execution,
          measurements: state.measurements,
          config,
          now,
        };
        const result = progress(ctx);
        if (result === "next") {
          issue(
            { ...w, execution: nextStage(w.execution) },
            now,
          );
        } else if (result === "completed") {
          finish(w, "completed");
          state.execution = null;
        } else if (
          now - w.execution.started - w.pausedMs >
          config.command_timeouts[w.execution.kind]! * 1000
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
      state.idle.since = event.hasWork || state.execution ? null : (state.idle.since ?? now);
      const started = new Set<string>();
      const matching = (state.settings.failsafe_policy ?? [])
        .filter((r) => {
          const prior = state.rules[r.rule_id]?.holds ?? false;
          const holds = matches(r, now, false, event.hasWork);
          if (holds && !prior) started.add(r.rule_id);
          state.rules[r.rule_id]!.holds = holds;
          return holds;
        })
        .sort((a, b) => b.priority - a.priority);
      const held =
        state.override === "rearm" || state.override === "pause";
      const critical = held
        ? matching.find((r) =>
            r.conditions.some((c) => c.kind === "battery_below" && c.critical),
          )
        : undefined;
      const candidate =
        critical ??
        matching.find(
          (r) =>
            started.has(r.rule_id),
        );
      const current = state.execution;
      const protectedOverride =
        state.override === "stand";
      if (
        candidate &&
        !protectedOverride &&
        (held || !current?.rule || candidate.priority > current.rule.priority)
      ) {
        activate(candidate.response, candidate, now);
      }
      if (
        state.phase !== "ordinary" &&
        !state.execution &&
        get(state.measurements.armed) === false &&
        get(state.measurements.airborne) === false
      ) {
        state.phase = "stopping";
        effects.push({ kind: "shutdown" });
      }
      break;
    }
  }
  if (state.settings !== previous.settings || (event.kind === "settings" && event.request_id !== undefined)) {
    const existing = effects.find(e => e.kind === "settings");
    if (!existing) effects.push({ kind: "settings", settings: state.settings,
      request_id: event.kind === "settings" ? event.request_id : undefined });
  }
  return { state, effects };
}
