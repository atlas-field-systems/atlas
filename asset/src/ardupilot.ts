import { connect, type Socket } from "node:net";
import {
  MavLinkPacketParser,
  MavLinkPacketSplitter,
  MavLinkProtocolV2,
  send,
  minimal,
  common,
  ardupilotmega,
  type MavLinkPacket,
} from "node-mavlink";
import type { Clock } from "@atlas/sdk";
import type { Config } from "./config.ts";
import type { Vehicle, Measurements, VehicleCommand, Subsystem } from "./vehicle.ts";

export function ardupilot(
  config: Extract<Config["equipment"], { kind: "ardupilot" }>,
  clock: Clock,
  diagnostic: (value: unknown) => void = () => {},
): Vehicle {
  let socket: Socket | undefined;
  let stopped = false;
  let lastAttempt = -Infinity;
  let observe: (m: Measurements) => void = () => {};
  let targetSystem = 1,
    targetComponent = 1;
  let location: { latitude: number; longitude: number } | undefined;
  let altitude = 0;
  let gpsFixed = false;
  let positionEstimated = false;
  let operation: AbortController | undefined;
  let expectedMode: number | null = null;
  let observedMode: number | null = null;
  let transitionFrom: number | null = null;
  let observedArmed = false;
  let inControl = true;
  let pendingGuided = false;
  let handback: { mode: number | null; phase: "late_guided" | "restoring" | "await_other_mode" } | undefined;
  let lastHeartbeat = -Infinity;
  const parameters = new Map<string, number>();
  const modeParameters = ["FLTMODE_CH", "FLTMODE1", "FLTMODE2", "FLTMODE3", "FLTMODE4", "FLTMODE5", "FLTMODE6", "FS_THR_ENABLE", "FS_OPTIONS", "BATT_FS_LOW_ACT", "BATT_FS_CRT_ACT"];
  let switchPosition: number | undefined;
  let protectionActive = false;
  let radioFailed = false;
  let batteryAction: "BATT_FS_LOW_ACT" | "BATT_FS_CRT_ACT" | undefined;
  const listeners = new Set<(id: number, value: unknown) => void>();
  function wait<T>(
    signal: AbortSignal,
    accept: (id: number, value: unknown) => T | undefined,
  ) {
    return new Promise<T>((resolve, reject) => {
      const close = () => {
        listeners.delete(receive);
        signal.removeEventListener("abort", abort);
      };
      const abort = () => {
        close();
        reject(signal.reason);
      };
      const receive = (id: number, value: unknown) => {
        try {
          const result = accept(id, value);
          if (result !== undefined) {
            close();
            resolve(result);
          }
        } catch (error) {
          close();
          reject(error);
        }
      };
      listeners.add(receive);
      signal.addEventListener("abort", abort, { once: true });
      if (signal.aborted) abort();
    });
  }
  const protocol = new MavLinkProtocolV2(config.system_id, 190);
  function write(message: Parameters<typeof send>[1]) {
    if (!socket || !socket.writable)
      return Promise.reject(new Error("flight controller unavailable"));
    return send(socket, message, protocol).then(() => {});
  }
  function command(id: number, params: number[] = []) {
    const m = new common.CommandLong();
    Object.assign(m, {
      targetSystem,
      targetComponent,
      command: id,
      confirmation: 0,
      _param1: params[0] ?? 0,
      _param2: params[1] ?? 0,
      _param3: params[2] ?? 0,
      _param4: params[3] ?? 0,
      _param5: params[4] ?? 0,
      _param6: params[5] ?? 0,
      _param7: params[6] ?? 0,
    } satisfies Partial<common.CommandLong>);
    return write(m);
  }
  function mode(customMode: number) {
    const m = new common.SetMode();
    Object.assign(m, { targetSystem, baseMode: 1, customMode });
    return write(m);
  }
  function restoreMode() {
    if (observedMode !== 4 || !handback || handback.mode === null || handback.phase === "restoring") return;
    handback.phase = "restoring";
    void mode(handback.mode).catch(diagnostic);
  }
  function subsystem(key: "gps" | "flight_controller", value: Subsystem) {
    const id = config.subsystems?.[key];
    if (id) observe({ subsystems: { [id]: { value, time: clock.now(), source: "ardupilot" } } });
  }
  function packet(packet: MavLinkPacket) {
    if (packet.header.compid !== 1) return;
    targetSystem = packet.header.sysid;
    targetComponent = packet.header.compid;
    const stamp = <T>(value: T) => ({
      value,
      time: clock.now(),
      source: "ardupilot",
    });
    const id = packet.header.msgid;
    if (id === minimal.Heartbeat.MSG_ID) {
      const m = packet.protocol.data(packet.payload, minimal.Heartbeat);
      subsystem("flight_controller", { condition: "healthy" });
      const armed = Boolean(m.baseMode & 128);
      if (armed && !observedArmed) transitionFrom = null;
      observedArmed = armed;
      observedMode = m.customMode;
      if (observedMode === expectedMode) transitionFrom = null;
      protectionActive = armed && m.systemStatus === 5;
      if (protectionActive) {
        inControl = false;
        const action = parameters.get("FS_THR_ENABLE");
        const options = parameters.get("FS_OPTIONS");
        const batteryMode = batteryAction === undefined ? undefined : parameters.get(batteryAction) === 1 ? 9 : parameters.get(batteryAction) === 2 ? 6 : undefined;
        const radioMode = radioFailed && options !== undefined && !(options & 4)
          ? action === 1 ? 6 : action === 3 ? 9 : undefined
          : undefined;
        if (m.customMode !== 4) handback = { mode: m.customMode, phase: "late_guided" };
        else if (batteryMode !== undefined) handback = { mode: batteryMode, phase: "late_guided" };
        else if (radioMode !== undefined && (!handback || handback.mode === null)) handback = { mode: radioMode, phase: "late_guided" };
        handback ??= { mode: null, phase: "await_other_mode" };
        restoreMode();
      }
      if (!inControl) {
        if (handback) {
          if (m.customMode === 4 && handback.phase !== "restoring") {
            restoreMode();
          } else if (m.customMode === handback.mode && handback.phase === "restoring") {
            handback.phase = "await_other_mode";
          } else if (m.customMode !== 4 && m.customMode !== handback.mode) handback = undefined;
        }
        inControl = !protectionActive && !handback && m.customMode === 4;
      }
      else if (armed) inControl = m.customMode === (expectedMode ?? 4) || (expectedMode !== null && m.customMode === transitionFrom);
      if (!inControl && pendingGuided) {
        if (m.customMode !== 4) handback = { mode: m.customMode, phase: "late_guided" };
        pendingGuided = false;
      }
      if (observedMode === expectedMode) pendingGuided = false;
      if (!inControl) operation?.abort(new Error("flight controller is in control"));
      observe({ armed: stamp(armed), in_control: stamp(inControl), connected: stamp(true) });
      for (const cb of listeners) cb(id, m);
    } else if (id === common.ParamValue.MSG_ID) {
      const m = packet.protocol.data(packet.payload, common.ParamValue);
      if (modeParameters.includes(m.paramId) && Number.isInteger(m.paramValue)) parameters.set(m.paramId, m.paramValue);
    } else if (id === common.RcChannels.MSG_ID) {
      const m = packet.protocol.data(packet.payload, common.RcChannels);
      const channel = parameters.get("FLTMODE_CH");
      if (!channel || channel > m.chancount || !modeParameters.slice(0, 7).every(name => parameters.has(name))) return;
      const channels = [m.chan1Raw, m.chan2Raw, m.chan3Raw, m.chan4Raw, m.chan5Raw, m.chan6Raw, m.chan7Raw, m.chan8Raw, m.chan9Raw, m.chan10Raw, m.chan11Raw, m.chan12Raw, m.chan13Raw, m.chan14Raw, m.chan15Raw, m.chan16Raw, m.chan17Raw, m.chan18Raw];
      const pwm = channels[channel - 1];
      if (pwm === undefined || pwm === 0 || pwm === 65535) return;
      const position = [1230, 1360, 1490, 1620, 1750].filter(limit => pwm > limit).length + 1;
      const selected = parameters.get(`FLTMODE${position}`);
      if (switchPosition !== undefined && position !== switchPosition && observedArmed && selected !== undefined && selected !== 4) {
        inControl = false;
        handback = { mode: selected, phase: "late_guided" };
        operation?.abort(new Error("flight controller is in control"));
        restoreMode();
        observe({ in_control: stamp(false) });
      }
      switchPosition = position;
    } else if (id === ardupilotmega.EkfStatusReport.MSG_ID) {
      const m = packet.protocol.data(
        packet.payload,
        ardupilotmega.EkfStatusReport,
      );
      positionEstimated = Boolean(m.flags & 16);
    } else if (id === common.GpsRawInt.MSG_ID) {
      const m = packet.protocol.data(packet.payload, common.GpsRawInt);
      gpsFixed = m.fixType >= 3;
      subsystem("gps", gpsFixed ? { condition: "healthy" } : { condition: "faulted", explanation: "GPS has no 3D fix" });
    } else if (id === common.GlobalPositionInt.MSG_ID) {
      if (!gpsFixed || !positionEstimated) return;
      const m = packet.protocol.data(packet.payload, common.GlobalPositionInt);
      altitude = m.relativeAlt / 1000;
      location = { latitude: m.lat / 1e7, longitude: m.lon / 1e7 };
      observe({
        position: stamp({
          latitude: m.lat / 1e7,
          longitude: m.lon / 1e7,
          altitudes: [
            { altitude_m: altitude, altitude_reference: "launch" },
            { altitude_m: m.alt / 1000, altitude_reference: "msl" },
          ],
        }),
        speed: stamp(Math.hypot(m.vx, m.vy) / 100),
      });
    } else if (id === common.BatteryStatus.MSG_ID) {
      const m = packet.protocol.data(packet.payload, common.BatteryStatus);
      if (m.id === 0) {
        if (m.chargeState === common.MavBatteryChargeState.CRITICAL) batteryAction = "BATT_FS_CRT_ACT";
        else if (m.chargeState === common.MavBatteryChargeState.LOW && batteryAction !== "BATT_FS_CRT_ACT") batteryAction = "BATT_FS_LOW_ACT";
        else if (m.chargeState === common.MavBatteryChargeState.OK) batteryAction = undefined;
      }
    } else if (id === common.SysStatus.MSG_ID) {
      const m = packet.protocol.data(packet.payload, common.SysStatus);
      radioFailed = Boolean(m.onboardControlSensorsEnabled & 65536) && !(m.onboardControlSensorsHealth & 65536);
      if (protectionActive && radioFailed && observedMode === 4 && (!handback || handback.mode === null)) {
        const action = parameters.get("FS_THR_ENABLE");
        const options = parameters.get("FS_OPTIONS");
        if (options !== undefined && !(options & 4) && (action === 1 || action === 3)) {
          handback = { mode: action === 1 ? 6 : 9, phase: "late_guided" };
          restoreMode();
        }
      }
      if (m.batteryRemaining >= 0)
        observe({ battery: stamp(m.batteryRemaining) });
    } else if (id === common.ExtendedSysState.MSG_ID) {
      const m = packet.protocol.data(packet.payload, common.ExtendedSysState);
      if (m.landedState !== 0)
        observe({ airborne: stamp(m.landedState !== 1) });
    } else if (id === common.StatusText.MSG_ID) {
      diagnostic(packet.protocol.data(packet.payload, common.StatusText));
    } else if (id === common.CommandAck.MSG_ID) {
      const m = packet.protocol.data(packet.payload, common.CommandAck);
      diagnostic(m);
      for (const cb of listeners) cb(id, m);
    }
  }
  function open() {
    lastAttempt = clock.now();
    socket = connect({ host: config.host, port: config.port });
    socket.on("error", (cause) => {
      diagnostic({ kind: "equipment_error", time: clock.now(), explanation: cause.message });
      operation?.abort(new Error("equipment connection lost", { cause }));
    });
    socket.once("close", () => {
      socket = undefined;
      location = undefined;
      gpsFixed = false;
      positionEstimated = false;
      operation?.abort(new Error("equipment connection lost"));
      observe({ connected: { value: false, time: clock.now(), source: "ardupilot" } });
      subsystem("gps", { condition: "unknown", explanation: "equipment connection lost" });
      subsystem("flight_controller", { condition: "unknown", explanation: "equipment connection lost" });
    });
    const reader = socket
      .pipe(new MavLinkPacketSplitter())
      .pipe(new MavLinkPacketParser());
    reader.on("data", packet);
    socket.once("connect", () => {
      parameters.clear();
      switchPosition = undefined;
      const rates = new common.RequestDataStream();
      Object.assign(rates, {
        targetSystem,
        targetComponent,
        reqStreamId: 0,
        reqMessageRate: 5,
        startStop: 1,
      });
      void write(rates)
        .then(() => command(511, [245, 200000]))
        .catch((e) => {
          operation?.abort(e);
        });
    });
  }
  return {
    start(cb) {
      observe = cb;
      open();
    },
    tick(now) {
      if (stopped) return;
      if (!socket && now - lastAttempt >= config.heartbeat_s * 1000) open();
      if (!socket?.writable || now - lastHeartbeat < config.heartbeat_s * 1000) return;
      lastHeartbeat = now;
      for (const name of modeParameters) {
        if (parameters.has(name)) continue;
        const request = new common.ParamRequestRead();
        Object.assign(request, { targetSystem, targetComponent, paramId: name, paramIndex: -1 });
        void write(request).catch(diagnostic);
      }
      const m = new minimal.Heartbeat();
      Object.assign(m, {
        type: 6,
        autopilot: 8,
        baseMode: 0,
        customMode: 0,
        systemStatus: 4,
        mavlinkVersion: 3,
      });
      void write(m).catch((e) => {
        operation?.abort(e);
      });
    },
    async command(c: VehicleCommand) {
      if (!inControl) throw new Error("flight controller is in control");
      if (!socket?.writable) throw new Error("flight controller unavailable");
      transitionFrom = inControl ? observedMode : null;
      expectedMode = c.mode;
      operation?.abort(new Error("superseded"));
      pendingGuided = false;
      const current = new AbortController();
      operation = current;
      const signal = current.signal;
      const acknowledged = async (id: number, params: number[] = []) => {
        let written = false;
        const ack = wait(signal, (messageId, value) => {
          if (
            !written ||
            messageId !== common.CommandAck.MSG_ID ||
            !(value instanceof common.CommandAck) ||
            value.command !== id
          )
            return;
          if (value.result === 5) return;
          if (value.result !== 0)
            throw new Error(
              `ArduPilot command ${id} refused (${value.result})`,
            );
          return true;
        });
        try {
          signal.throwIfAborted();
          await command(id, params);
          signal.throwIfAborted();
          written = true;
          await ack;
          signal.throwIfAborted();
        } catch (error) {
          current.abort(error);
          await ack.catch(() => {});
          throw error;
        }
      };
      const selectMode = async (number: number) => {
        const confirmed = wait(signal, (id, value) =>
          id === minimal.Heartbeat.MSG_ID &&
          value instanceof minimal.Heartbeat &&
          value.customMode === number
            ? true
            : undefined,
        );
        try {
          signal.throwIfAborted();
          pendingGuided = number === 4;
          await mode(number);
          await confirmed;
          signal.throwIfAborted();
        } catch (error) {
          current.abort(error);
          await confirmed.catch(() => {});
          throw error;
        }
      };
      switch (c.kind) {
        case "takeoff":
          if (c.altitude.altitude_reference !== "launch")
            throw new Error("ArduPilot Takeoff requires launch altitude");
          await selectMode(c.mode);
          await acknowledged(400, [1]);
          signal.throwIfAborted();
          await acknowledged(22, [0, 0, 0, 0, 0, 0, c.altitude.altitude_m]);
          return;
        case "return_to_home":
        case "move_to": {
          await selectMode(c.mode);
          const m = new common.SetPositionTargetGlobalInt();
          const height = c.position.altitudes?.find(
            (a) => a.altitude_reference === "launch",
          );
          if (c.position.altitudes?.length && !height)
            throw new Error("ArduPilot Move To requires launch altitude");
          await acknowledged(178, [1, c.speed, -1]);
          Object.assign(m, {
            targetSystem,
            targetComponent,
            coordinateFrame: 6,
            typeMask: 3576,
            latInt: Math.round(c.position.latitude * 1e7),
            lonInt: Math.round(c.position.longitude * 1e7),
            alt: height?.altitude_m ?? altitude,
          });
          signal.throwIfAborted();
          await write(m);
          return;
        }
        case "hold": {
          if (!location)
            throw new Error("current position unavailable for Hold");
          await selectMode(c.mode);
          const m = new common.SetPositionTargetGlobalInt();
          Object.assign(m, {
            targetSystem,
            targetComponent,
            coordinateFrame: 6,
            typeMask: 3520,
            latInt: Math.round(location.latitude * 1e7),
            lonInt: Math.round(location.longitude * 1e7),
            alt: altitude,
            vx: 0,
            vy: 0,
            vz: 0,
          });
          signal.throwIfAborted();
          await write(m);
          return;
        }
        case "land":
          await selectMode(c.mode);
          return;
      }
    },
    abortCommand() {
      operation?.abort(new Error("flight controller is in control"));
    },
    stop() {
      stopped = true;
      operation?.abort(new Error("stopped"));
      socket?.destroy();
    },
  };
}
