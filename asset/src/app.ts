import {
  createClient,
  startAsset,
  systemClock,
  type Clock,
  type Report,
  type Room,
} from "@atlas/sdk";
import { loadPackagedProtocol } from "@atlas/protocol";
import { initial, reduce, refusal, type Event, type Effect } from "./control.ts";
import { fresh, type Vehicle, type Measurements } from "./vehicle.ts";
import { ardupilot } from "./ardupilot.ts";
import { createLog } from "./logging.ts";
import type { Config } from "./config.ts";
export async function startApp(
  config: Config,
  options: { clock?: Clock; fetch?: typeof fetch } = {},
) {
  const clock = options.clock ?? systemClock;
  let state = initial(config, clock.now());
  const log = await createLog(config, clock.now(), clock);
  const client = createClient({
    baseUrl: config.link.core_url,
    credential: { kind: "asset", key: config.asset_key },
    protocol: await loadPackagedProtocol(),
    clock,
    fetch: options.fetch ?? globalThis.fetch,
    observer: (e) => log.record(e),
  });
  const vehicle =
    config.equipment.kind === "ardupilot"
      ? ardupilot(config.equipment, clock, log.record)
      : stationary(config, clock);
  type Session = Extract<
    Awaited<ReturnType<typeof startAsset>>,
    { ok: true }
  >["value"];
  let running: Session | undefined;
  let stopped = false;
  let stopping: Promise<string> | undefined;
  const current = currentReports(
    config, clock, () => state.measurements, () => running?.asset_id,
  );
  function report(reports: Report[]) {
    for (const r of reports) log.record({ kind: "report", report: r });
    void running?.outbox.add(reports);
  }
  function dispatch(event: Event) {
    if (stopped) return;
    log.record({ kind: "input", event });
    try {
      const result = reduce(state, event, config);
      state = result.state;
      for (const effect of result.effects) apply(effect);
    } catch (error) {
      log.record({ kind: "control_failed", time: clock.now(), explanation: error instanceof Error ? error.message : String(error) });
    }
  }
  function apply(effect: Effect) {
    log.record({ kind: "effect", effect });
    switch (effect.kind) {
      case "settings":
        report([{ type: "report.settings", asset_id: running!.asset_id,
          time: clock.now(), request_id: effect.request_id, settings: effect.settings }]);
        break;
      case "diagnostic":
        break;
      case "vehicle":
        void vehicle.command(effect.command).catch((e) =>
          dispatch({
            kind: "command_failed",
            execution_id: effect.execution_id,
            now: clock.now(),
            explanation: e instanceof Error ? e.message : "vehicle failed",
          }),
        );
        break;
      case "override":
        report([
          {
            type: "report.failsafe",
            kind: "override",
            asset_id: running!.asset_id,
            time: clock.now(),
            request_id: effect.request_id,
          },
        ]);
        break;
      case "autopilot":
        report([
          {
            type: "report.failsafe",
            kind: "autopilot",
            asset_id: running!.asset_id,
            time: clock.now(),
            in_control: effect.in_control,
          },
        ]);
        break;
      case "clear":
        running?.queue?.clear();
        break;
      case "task":
        if (effect.status !== "active")
          running?.queue?.finish(effect.task.task_id, effect.status, {
            explanation: effect.explanation,
          });
        break;
      case "response":
        report([
          {
            type: "report.failsafe",
            kind: "response",
            asset_id: running!.asset_id,
            time: clock.now(),
            rule_id: effect.rule?.rule_id,
            task_state: effect.status,
            response: effect.action,
            explanation: effect.explanation,
          },
        ]);
        break;
      case "shutdown":
        void stop("failsafe safely stopped").catch((e) =>
          process.stderr.write(`${e}\n`),
        );
        break;
    }
  }
  const pendingSubsystems: Array<Omit<Extract<Report, { type: "report.status" }> & { kind: "subsystem" }, "asset_id">> = [];
  vehicle.start((measurements) => {
    for (const [id, sample] of Object.entries(measurements.subsystems ?? {})) {
      const previous = state.measurements.subsystems?.[id];
      if (sample.time === null || !config.description.subsystems?.some(s => s.subsystem_id === id) ||
          (previous?.value.condition === sample.value.condition && previous?.value.explanation === sample.value.explanation)) continue;
      const change = { type: "report.status" as const, kind: "subsystem" as const,
        time: sample.time, subsystem_id: id, ...sample.value };
      if (running) report([{ ...change, asset_id: running.asset_id }]);
      else pendingSubsystems.push(change);
    }
    dispatch({ kind: "measurements", measurements });
    running?.outbox.changed();
  });
  const result = await startAsset(client, {
    clock,
    description: config.description,
    heartbeatMs: config.reporting.heartbeat_s * 1000,
    settings: () => state.settings,
    current,
    queue: config.description.commands.length
      ? {
          refuse: request => refusal(state, request),
          runNow: (task, request_id) =>
            dispatch({ kind: "task", task, request_id, now: clock.now() }),
          stop: (id, because) => {
            if (because !== "now")
              dispatch({ kind: "cancel", id, now: clock.now() });
          },
          update: (task) => {
            if (state.execution?.task?.task_id === task.task_id)
              dispatch({ kind: "update", task, now: clock.now() });
          },
        }
      : undefined,
    onSettings: (request, request_id) => {
      dispatch({
        kind: "settings",
        settings: request.settings,
        request_id,
        now: clock.now(),
      });
    },
  });
  if (!result.ok) {
    vehicle.stop();
    client.close();
    throw new Error(result.explanation);
  }
  running = result.value;
  report(pendingSubsystems.map(r => ({ ...r, asset_id: running!.asset_id })));
  running.outbox.onBlocked((failure) => {
    log.record({ kind: "outbox_blocked", time: clock.now(), failure });
    process.stderr.write(`Asset outbox blocked: ${failure.error}: ${failure.explanation}\n`);
  });
  void running.done.then(
    end => {
      log.record({ kind: "session_ended", time: clock.now(), end });
      if (!stopped) process.stderr.write(`Asset session ended: ${end.reason}\n`);
    },
    error => {
      const explanation = error instanceof Error ? error.message : String(error);
      log.record({ kind: "session_failed", time: clock.now(), explanation });
      process.stderr.write(`Asset session failed: ${explanation}\n`);
    },
  );
  running.link.onContact((contact) => dispatch({ kind: "contact", contact }));
  let timer: ReturnType<Clock["after"]>;
  function tick() {
    if (stopped) return;
    vehicle.tick(clock.now());
    try {
      const before = state.settings;
      dispatch({
        kind: "tick",
        now: clock.now(),
        hasWork: running?.queue?.peek() !== undefined,
      });
      if (before !== state.settings)
        report([
          {
            type: "report.settings",
            asset_id: running!.asset_id,
            time: clock.now(),
            settings: state.settings,
          },
        ]);
      if (
        !state.execution &&
        state.phase !== "stopping" &&
        (state.phase !== "ordinary" || state.settings.run_state !== "paused")
      ) {
        const task = running?.queue?.next();
        if (task) dispatch({ kind: "task", task, now: clock.now() });
      }
    } catch (error) {
      log.record({
        kind: "control_failed",
        time: clock.now(),
        explanation: error instanceof Error ? error.message : String(error),
      });
    } finally {
      if (!stopped) timer = clock.after(config.control_tick_s * 1000, tick);
    }
  }
  function stop(reason = "operator stopped") {
    if (stopping) return stopping;
    stopped = true;
    timer?.cancel();
    vehicle.stop();
    stopping = (async () => {
      let deadline: ReturnType<Clock["after"]> | undefined;
      try {
        await Promise.race([
          running?.outbox.flush(),
          new Promise<void>((resolve) => {
            deadline = clock.after(config.final_report_wait_s * 1000, resolve);
          }),
        ]);
      } finally {
        deadline?.cancel();
      }
      running?.stop();
      client.close();
      await running?.done.catch(() => {});
      return log.close(running!.asset_id, reason);
    })();
    return stopping;
  }
  tick();
  return {
    asset_id: running.asset_id,
    stop,
    done: running.done,
  };
}
function stationary(config: Config, clock: Clock): Vehicle {
  return {
    start(observe) {
      if (config.equipment.kind === "simulated")
        observe({
          position: {
            value: config.equipment.position,
            source: "configuration",
            time: clock.now(),
          },
        });
    },
    tick() {},
    async command() {
      throw new Error("stationary equipment does not move");
    },
    stop() {},
  };
}

export function currentReports(
  config: Config,
  clock: Clock,
  measurements: () => Measurements,
  assetId: () => string | undefined,
) {
  return function current(room: Room) {
    const asset_id = assetId();
    if (!asset_id) return [];
    const reports: Report[] = [];
    const { battery, position } = measurements();
    if (
      fresh(battery, clock.now(), config.measurement_stale_after_s) !==
        undefined &&
      battery &&
      battery.time !== null
    )
      reports.push({
        type: "report.battery",
        asset_id,
        time: battery.time,
        battery_percent: battery.value,
      });
    if (
      fresh(position, clock.now(), config.measurement_stale_after_s) !==
        undefined &&
      position &&
      position.time !== null
    )
      reports.push({
        type: "report.telemetry",
        asset_id,
        time: position.time,
        position: position.value,
      });
    const fits: Report[] = [];
    for (const r of reports)
      if (room.size([...fits, r]) <= room.bytes) {
        fits.push(r);
      }
    return fits;
  };
}
