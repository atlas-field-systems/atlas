import {
  systemClock,
  type Clock,
  type LinkFailure,
  type Report,
  type Room,
  type AssetFile,
} from "@atlas/sdk";
import { readFile } from "node:fs/promises";
import { initial, reduce, refusal, canPullTask, type Event, type Effect } from "./control.ts";
import { fresh, type Vehicle, type Measurements } from "./vehicle.ts";
import { peripheral } from "./peripheral.ts";
import { ardupilot } from "./ardupilot.ts";
import { createLog } from "./logging.ts";
import { parseConfig, type Config } from "./config.ts";
import { createAssetConnection } from "./connection.ts";
import type { openMeshtasticRadio } from "@atlas/meshtastic-fieldlink/radio";
export async function startApp(
  config: Config,
  options: { clock?: Clock; fetch?: typeof fetch; signal?: AbortSignal; openRadio?: typeof openMeshtasticRadio } = {},
) {
  const clock = options.clock ?? systemClock;
  let state = initial(config, clock.now());
  const log = await createLog(config, clock.now(), clock);
  const cleanup: Array<() => unknown | Promise<unknown>> = [];
  try {
    const connection = await createAssetConnection(config, {
      clock,
      fetch: options.fetch ?? globalThis.fetch,
      openRadio: options.openRadio,
      observer: (e) => log.record(e),
    });
    cleanup.push(() => connection.close());
    type Session = Awaited<ReturnType<typeof connection.register>>;
    let running: Session | undefined;
    let stopped = false;
    let stopping: Promise<string> | undefined;
    const startupStopped = Promise.withResolvers<never>();
    const abort = () => {
      if (running) void stop("operator stopped").catch(error => process.stderr.write(`${error}\n`));
      else startupStopped.reject(new Error("Asset startup stopped"));
    };
    options.signal?.addEventListener("abort", abort, { once: true });
    cleanup.push(() => options.signal?.removeEventListener("abort", abort));
    const current = currentReports(
      config, clock, () => state.measurements, () => running?.asset_id,
    );
    type LocalReport = Report extends infer R ? R extends Report ? Omit<R, "asset_id"> : never : never;
    const pendingReports: LocalReport[] = [];
    function mustKeep(r: LocalReport) {
      return ("request_id" in r && r.request_id !== undefined) ||
        (r.type === "report.status" && r.kind === "task" && r.task_state !== "active") ||
        r.type === "report.failsafe" ||
        (r.type === "report.status" && r.kind === "subsystem" &&
          pendingReports.findLast(value => value.type === "report.status" &&
            value.kind === "subsystem" && value.subsystem_id === r.subsystem_id) === r);
    }
    function report(reports: LocalReport[]) {
      if (!running) {
        for (const value of reports) log.report(value);
        for (const value of reports) {
          pendingReports.push(value);
          if (pendingReports.length > config.log_queue_limit) {
            const discard = pendingReports.findIndex(r => !mustKeep(r));
            if (discard >= 0) pendingReports.splice(discard, 1);
            if (discard >= 0) log.gap(clock.now(), "pre-registration report queue full");
          }
        }
        return;
      }
      const { asset_id } = running;
      const identified = reports.map(r => ({ ...r, asset_id }));
      for (const r of identified) log.record({ kind: "report", report: r });
      void running.outbox.add(identified);
    }
    function dispatch(event: Event) {
      if (stopped) return;
      try {
        log.record({ kind: "input", event });
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
          report([{ type: "report.settings",
            time: clock.now(), request_id: effect.request_id, settings: effect.settings }]);
          break;
        case "diagnostic":
          break;
        case "vehicle":
          void vehicle.command(effect.command).then(() => dispatch({ kind: "command_accepted", execution_id: effect.execution_id, now: clock.now() })).catch((e) =>
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
              time: clock.now(),
              request_id: effect.request_id,
            },
          ]);
          break;
        case "autopilot":
          if (effect.in_control) vehicle.abortCommand();
          report([
            {
              type: "report.failsafe",
              kind: "autopilot",
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
              time: clock.now(),
              rule_id: effect.rule?.rule_id,
              task_state: effect.status,
              response: effect.action,
              explanation: effect.explanation,
            },
          ]);
          break;
        case "shutdown":
          if (!running) {
            startupStopped.reject(new Error("failsafe safely stopped before Core registration"));
            break;
          }
          void stop("failsafe safely stopped").catch((e) =>
            process.stderr.write(`${e}\n`),
          );
          break;
      }
    }
    let uploads = Promise.resolve();
    const pendingFiles: Array<Omit<AssetFile, "bytes"> & { path: string }> = [];
    function uploadFile(file: Omit<AssetFile, "bytes"> & { path: string }) {
      uploads = uploads.then(async () => {
        const bytes = await readFile(file.path);
        const result = await running!.link.storeFile({ ...file, bytes });
        log.record({ kind: "file_result", name: file.name, result });
      }).catch(error => log.record({ kind: "file_failed", name: file.name, explanation: String(error) }));
    }
    const vehicle = config.equipment.kind === "ardupilot"
      ? ardupilot({ ...config.equipment, measurement_stale_after_s: config.measurement_stale_after_s }, clock, log.record)
      : (config.equipment.kind === "peripheral" || config.equipment.kind === "gpsd")
        ? peripheral(config.equipment, clock, {
            diagnostic: log.record,
            observation(value, source) {
              log.record({ kind: "observation", source, observation: value });
              report([value]);
            },
            async file(file) {
              const path = await log.capture(file);
              const stored = { name: file.name, contentType: file.contentType, place: file.place, path };
              if (running) uploadFile(stored);
              else pendingFiles.push(stored);
            },
          })
        : stationary(config, clock);
    cleanup.push(() => vehicle.stop());
    let timer: ReturnType<Clock["after"]> | undefined;
    cleanup.push(() => { stopped = true; timer?.cancel(); });
    vehicle.start((measurements) => {
      for (const [id, sample] of Object.entries(measurements.subsystems ?? {})) {
        const previous = state.measurements.subsystems?.[id];
        if (sample.time === null || !config.description.subsystems?.some(s => s.subsystem_id === id) ||
            (previous?.value.condition === sample.value.condition && previous?.value.explanation === sample.value.explanation)) continue;
        const change = { type: "report.status" as const, kind: "subsystem" as const,
          time: sample.time, subsystem_id: id, ...sample.value };
        report([change]);
      }
      dispatch({ kind: "measurements", measurements });
      running?.outbox.changed();
    });
    function reportBlocked(failure: LinkFailure) {
      log.record({ kind: "outbox_blocked", time: clock.now(), failure });
      process.stderr.write(`Asset outbox blocked: ${failure.error}: ${failure.explanation}\n`);
    }
    const registration = connection.register({
      clock,
      heartbeatMs: config.reporting.heartbeat_s * 1000,
      settings: () => state.settings,
      current,
      onReports: reports => { for (const value of reports) log.report(value); },
      queue: config.description.commands.length || config.description.settings?.length
        ? {
            refuse: request => {
              const reason = refusal(state, request);
              if (reason || request.kind !== "task" || request.task.kind !== "settings") return reason;
              try {
                parseConfig({ ...config, initial_settings: { ...state.settings, ...request.task.settings } });
              } catch (error) {
                return error instanceof Error ? error.message : String(error);
              }
            },
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
    }, {
      onContact: contact => dispatch({ kind: "contact", contact }),
      onRejoin(assetId, outbox) {
        outbox.onBlocked(reportBlocked);
        const task = state.execution?.task;
        if (task) dispatch({ kind: "cancel", id: task.task_id, now: clock.now() });
        log.identify(assetId);
      },
    }).then(session => {
      if (stopped) session.stop();
      return session;
    });
    tick();
    if (options.signal?.aborted) abort();
    running = await Promise.race([registration, startupStopped.promise]);
    log.identify(running.asset_id);
    if (stopped) {
      running.stop();
      await running.done;
      throw new Error("Asset stopped before Core registration completed");
    }
    report(pendingReports.splice(0));
    for (const file of pendingFiles) uploadFile(file);
    pendingFiles.length = 0;
    running.outbox.onBlocked(reportBlocked);
    const session = running;
    const sessionFinished = session.done.then(
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
    function tick() {
      if (stopped) return;
      try {
        vehicle.tick(clock.now());
      } catch (error) {
        log.record({ kind: "control_failed", time: clock.now(), explanation: String(error) });
      }
      try {
        dispatch({ kind: "tick", now: clock.now(), hasWork: running?.queue?.peek() !== undefined });
        if (canPullTask(state)) {
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
      options.signal?.removeEventListener("abort", abort);
      timer?.cancel();
      const equipmentStopped = vehicle.stop();
      stopping = (async () => {
        let deadline: ReturnType<Clock["after"]> | undefined;
        try {
          await Promise.race([
            session.outbox.flush(),
            new Promise<void>((resolve) => {
              deadline = clock.after(config.final_report_wait_s * 1000, resolve);
            }),
          ]);
        } finally {
          deadline?.cancel();
        }
        session.stop();
        try { await connection.close(); }
        catch (failure) { log.record({ kind: "cleanup_failed", explanation: String(failure) }); }
        await sessionFinished;
        await equipmentStopped;
        await uploads;
        return log.close(session.asset_id, reason);
      })();
      return stopping;
    }
    if (config.asset_key === undefined) {
      void sessionFinished.then(() => {
        if (!stopped) void stop("Fieldlink ended").catch(error => process.stderr.write(`${error}\n`));
      });
    }
    return { get asset_id() { return session.asset_id; }, stop, done: session.done };
  } catch (error) {
    for (const close of cleanup.reverse()) {
      try { await close(); }
      catch (failure) { log.record({ kind: "cleanup_failed", explanation: String(failure) }); }
    }
    const explanation = error instanceof Error ? error.message : String(error);
    log.record({ kind: "startup_failed", time: clock.now(), explanation });
    try { await log.close("unregistered", `startup failed: ${explanation}`); }
    catch (failure) { process.stderr.write(`Asset startup archive failed: ${failure}\n`); }
    throw error;
  }
}
function stationary(config: Config, clock: Clock): Vehicle {
  let observe: (measurements: Measurements) => void = () => {};
  function sample() {
      if (config.equipment.kind === "simulated")
        observe({
          position: {
            value: config.equipment.position,
            source: "configuration",
            time: clock.now(),
          },
        });
  }
  return {
    start(callback) { observe = callback; sample(); },
    tick() { sample(); },
    async command() {
      throw new Error("stationary equipment does not move");
    },
    abortCommand() {},
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
