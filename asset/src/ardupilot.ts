import { connect, type Socket } from "node:net";
import {
  MavLinkPacketParser,
  MavLinkPacketSplitter,
  MavLinkProtocolV2,
  send,
  minimal,
  common,
  type MavLinkPacket,
} from "node-mavlink";
import type { Clock } from "@atlas/sdk";
import type { Config } from "./config.ts";
import type { Vehicle, Measurements, VehicleCommand } from "./vehicle.ts";

export function ardupilot(
  config: Extract<Config["equipment"], { kind: "ardupilot" }>,
  clock: Clock,
  diagnostic: (value: unknown) => void = () => {},
): Vehicle {
  let socket: Socket | undefined;
  let observe: (m: Measurements) => void = () => {};
  let targetSystem = 1,
    targetComponent = 1;
  let altitude = 0;
  let expectedMode: number | null = null;
  let awaitingMode = false;
  let stage: "idle" | "guided" | "arming" | "climbing" = "idle";
  let takeoffAltitude = 0;
  let failure: Error | undefined;
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
    expectedMode = customMode;
    awaitingMode = true;
    const m = new common.SetMode();
    Object.assign(m, { targetSystem, baseMode: 1, customMode });
    return write(m);
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
      if (m.customMode === expectedMode) awaitingMode = false;
      if (!awaitingMode && m.customMode === 4) expectedMode = 4;
      observe({
        armed: stamp(Boolean(m.baseMode & 128)),
        ...(!awaitingMode && expectedMode !== null
          ? { guided: stamp(m.customMode === expectedMode) }
          : {}),
      });
      if (stage === "guided" && m.customMode === 4) {
        stage = "arming";
        void command(400, [1]).catch((e) => {
          failure = e;
        });
      }
      if (stage === "arming" && m.baseMode & 128) {
        stage = "climbing";
        void command(22, [0, 0, 0, 0, 0, 0, takeoffAltitude]).catch((e) => {
          failure = e;
        });
      }
    } else if (id === common.GlobalPositionInt.MSG_ID) {
      const m = packet.protocol.data(packet.payload, common.GlobalPositionInt);
      altitude = m.relativeAlt / 1000;
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
    } else if (id === common.SysStatus.MSG_ID) {
      const m = packet.protocol.data(packet.payload, common.SysStatus);
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
      if (m.result !== 0 && m.result !== 5)
        failure = new Error(
          `ArduPilot command ${m.command} refused (${m.result})`,
        );
    }
  }
  return {
    start(cb) {
      observe = cb;
      socket = connect({ host: config.host, port: config.port });
      socket.on("error", (e) => {
        failure = e;
      });
      const reader = socket
        .pipe(new MavLinkPacketSplitter())
        .pipe(new MavLinkPacketParser());
      reader.on("data", packet);
      socket.once("connect", () => {
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
            failure = e;
          });
      });
    },
    heartbeat() {
      if (!socket?.writable) return;
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
        failure = e;
      });
    },
    async command(c: VehicleCommand) {
      if (failure) {
        const e = failure;
        failure = undefined;
        throw e;
      }
      stage = "idle";
      switch (c.kind) {
        case "takeoff":
          if (c.altitude.altitude_reference !== "launch")
            throw new Error("ArduPilot Takeoff requires launch altitude");
          takeoffAltitude = c.altitude.altitude_m;
          stage = "guided";
          await mode(4);
          return;
        case "move_to": {
          const m = new common.SetPositionTargetGlobalInt();
          const height = c.position.altitudes?.find(
            (a) => a.altitude_reference === "launch",
          );
          if (c.position.altitudes?.length && !height)
            throw new Error("ArduPilot Move To requires launch altitude");
          await command(178, [1, c.speed, -1]);
          Object.assign(m, {
            targetSystem,
            targetComponent,
            coordinateFrame: 6,
            typeMask: 3576,
            latInt: Math.round(c.position.latitude * 1e7),
            lonInt: Math.round(c.position.longitude * 1e7),
            alt: height?.altitude_m ?? altitude,
          });
          await write(m);
          return;
        }
        case "hold":
          await mode(4);
          await command(17);
          return;
        case "land":
          await mode(9);
          return;
        case "return_to_home":
          await mode(6);
          return;
      }
    },
    stop() {
      socket?.destroy();
    },
  };
}
