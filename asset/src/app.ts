import {
  createClient,
  startAsset,
  systemClock,
  type Clock,
  type Report,
  type Room,
} from "@atlas/sdk";
import { loadPackagedProtocol } from "@atlas/protocol";
import { initial, reduce, type Event, type Effect } from "./control.ts";
import { fresh, type Vehicle } from "./vehicle.ts";
import { ardupilot } from "./ardupilot.ts";
import { createLog } from "./logging.ts";
import type { Config } from "./config.ts";
export async function startApp(
  config: Config,
  options: { clock?: Clock; fetch?: typeof fetch; vehicle?: Vehicle } = {},
) {
  const clock = options.clock ?? systemClock;
  let state = initial(config, clock.now());
  const log = await createLog(config, clock.now());
  const client = createClient({
    baseUrl: config.link.core_url,
    credential: { kind: "asset", key: config.asset_key },
    protocol: await loadPackagedProtocol(),
    clock,
    fetch: options.fetch ?? globalThis.fetch,
    observer: (e) => log.record(e),
  });
  const vehicle =
    options.vehicle ??
    (config.equipment.kind === "ardupilot"
      ? ardupilot(config.equipment, clock, log.record)
      : stationary(config, clock));
  type Session = Extract<
    Awaited<ReturnType<typeof startAsset>>,
    { ok: true }
  >["value"];
  let running: Session | undefined;
  let stopped = false,
    lastHeartbeat = -Infinity;
  let stopping: Promise<string> | undefined;
  let sentPosition: number | null | undefined,
    sentBattery: number | null | undefined;
  function report(reports: Report[]) {
    for (const r of reports) log.record({ kind: "report", report: r });
    void running?.outbox.add(reports);
  }
  function dispatch(event: Event) {
    if (stopped) return;
    log.record({ kind: "input", event });
    const result = reduce(state, event, config);
    state = result.state;
    for (const effect of result.effects) apply(effect);
  }
  function apply(effect: Effect) {
    log.record({ kind: "effect", effect });
    switch (effect.kind) {
      case "vehicle":
        void vehicle.command(effect.command).catch((e) =>
          dispatch({
            kind: "command_failed",
            now: clock.now(),
            explanation: e instanceof Error ? e.message : "vehicle failed",
          }),
        );
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
        if (effect.status === "active")
          report([
            {
              type: "report.status",
              kind: "task",
              asset_id: running!.asset_id,
              time: clock.now(),
              task_id: effect.task.task_id,
              task_state: "active",
            },
          ]);
        else
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
  function current(room: Room) {
    if (!running) return [];
    const reports: Report[] = [];
    const { battery, position } = state.measurements;
    if (
      fresh(battery, clock.now(), config.measurement_stale_after_s) !==
        undefined &&
      battery &&
      battery.time !== null &&
      battery.time !== sentBattery
    )
      reports.push({
        type: "report.battery",
        asset_id: running.asset_id,
        time: battery.time,
        battery_percent: battery.value,
      });
    if (
      fresh(position, clock.now(), config.measurement_stale_after_s) !==
        undefined &&
      position &&
      position.time !== null &&
      position.time !== sentPosition
    )
      reports.push({
        type: "report.telemetry",
        asset_id: running.asset_id,
        time: position.time,
        position: position.value,
      });
    const fits: Report[] = [];
    for (const r of reports)
      if (room.size([...fits, r]) <= room.bytes) {
        fits.push(r);
        if (r.type === "report.battery") sentBattery = r.time;
        else sentPosition = r.time;
      }
    return fits;
  }
  vehicle.start((measurements) => {
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
          runNow: (task) => dispatch({ kind: "task", task, now: clock.now() }),
          stop: (id) => dispatch({ kind: "cancel", id, now: clock.now() }),
          update: (task) => {
            if (
              state.mode.kind === "running" &&
              state.mode.work.task?.task_id === task.task_id
            )
              dispatch({ kind: "update", task, now: clock.now() });
          },
        }
      : undefined,
    onSettings: (request, request_id) => {
      dispatch({
        kind: "settings",
        settings: request.settings,
        now: clock.now(),
      });
      if (running)
        report([
          {
            type: "report.settings",
            asset_id: running.asset_id,
            time: clock.now(),
            request_id,
            settings: state.settings,
          },
        ]);
    },
  });
  if (!result.ok) {
    vehicle.stop();
    client.close();
    throw new Error(result.explanation);
  }
  running = result.value;
  running.link.onContact((contact) => dispatch({ kind: "contact", contact }));
  let timer: ReturnType<Clock["after"]>;
  function tick() {
    if (stopped) return;
    if (
      config.equipment.kind === "ardupilot" &&
      clock.now() - lastHeartbeat >= config.equipment.heartbeat_s * 1000
    ) {
      vehicle.heartbeat();
      lastHeartbeat = clock.now();
    }
    try {
      const before = state.settings;
      dispatch({
        kind: "tick",
        now: clock.now(),
        hasWork: Boolean(running?.queue?.held().length),
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
        (state.mode.kind === "ready" && state.settings.run_state !== "paused") ||
        (state.locked && state.mode.kind === "failsafe")
      ) {
        const task = running?.queue?.next();
        if (task) dispatch({ kind: "task", task, now: clock.now() });
      }
    } catch (error) {
      log.record({ kind: "control_failed", time: clock.now(), explanation: error instanceof Error ? error.message : String(error) });
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
      return log.close(running!.asset_id, reason);
    })();
    return stopping;
  }
  tick();
  return {
    asset_id: running.asset_id,
    stop,
    get state() {
      return state;
    },
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
    heartbeat() {},
    async command() {
      throw new Error("stationary equipment does not move");
    },
    stop() {},
  };
}
