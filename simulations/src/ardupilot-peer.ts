import { once } from "node:events";
import { createServer, type Socket } from "node:net";
import { minimal, common, ardupilotmega, MavLinkPacketParser, MavLinkPacketSplitter, MavLinkProtocolV2, send, type MavLinkPacket } from "node-mavlink";
import type { parseConfig } from "@atlas/asset";
import type { World } from "./world.ts";

/** Simulated equipment, speaking the production driver's MAVLink TCP interface. */
export async function ardupilotPeer(w: World) {
  const sockets = new Set<Socket>();
  const protocol = new MavLinkProtocolV2(1, 1);
  let mode = 4, armed = false, altitude = 0;
  let latitude = 1e7, longitude = 2e7;
  const commands: { time: number; command: number }[] = [];
  const targets: { time: number; latitude: number; longitude: number }[] = [];
  function out(socket: Socket, message: Parameters<typeof send>[1]) {
    if (!socket.destroyed) void send(socket, message, protocol).catch(() => {});
  }
  function telemetry(socket: Socket) {
    const heartbeat = new minimal.Heartbeat();
    Object.assign(heartbeat, { type: 2, autopilot: 3, baseMode: armed ? 129 : 1, customMode: mode, systemStatus: 4, mavlinkVersion: 3 });
    out(socket, heartbeat);
    const gps = new common.GpsRawInt();
    Object.assign(gps, { timeUsec: 0n, fixType: 3, lat: latitude, lon: longitude, alt: Math.round((100 + altitude) * 1000), eph: 100, epv: 100, vel: 0, cog: 0, satellitesVisible: 10 });
    out(socket, gps);
    const ekf = new ardupilotmega.EkfStatusReport();
    Object.assign(ekf, { flags: 0x3ff, velocityVariance: 0, posHorizVariance: 0, posVertVariance: 0, compassVariance: 0, terrainAltVariance: 0 });
    out(socket, ekf);
    const position = new common.GlobalPositionInt();
    Object.assign(position, { timeBootMs: 0, lat: latitude, lon: longitude, alt: Math.round((100 + altitude) * 1000), relativeAlt: Math.round(altitude * 1000), vx: 0, vy: 0, vz: 0, hdg: 0 });
    out(socket, position);
    const battery = new common.SysStatus();
    Object.assign(battery, { batteryRemaining: 80 });
    out(socket, battery);
    const state = new common.ExtendedSysState();
    Object.assign(state, { vtolState: 0, landedState: armed && altitude > 0 ? 2 : 1 });
    out(socket, state);
  }
  const server = createServer(socket => {
    sockets.add(socket);
    socket.on("error", () => {});
    socket.on("close", () => sockets.delete(socket));
    socket.pipe(new MavLinkPacketSplitter()).pipe(new MavLinkPacketParser()).on("data", (packet: MavLinkPacket) => {
      const id = packet.header.msgid;
      if (id === minimal.Heartbeat.MSG_ID) telemetry(socket);
      if (id === common.SetMode.MSG_ID) {
        mode = packet.protocol.data(packet.payload, common.SetMode).customMode;
        if (mode === 9) { altitude = 0; armed = false; }
        telemetry(socket);
      }
      if (id === common.CommandLong.MSG_ID) {
        const message = packet.protocol.data(packet.payload, common.CommandLong);
        commands.push({ time: w.clock.now(), command: message.command });
        if (message.command === 400) armed = message._param1 === 1;
        if (message.command === 22) altitude = message._param7;
        const ack = new common.CommandAck();
        Object.assign(ack, { command: message.command, result: 0, progress: 0, resultParam2: 0, targetSystem: packet.header.sysid, targetComponent: packet.header.compid });
        out(socket, ack);
        telemetry(socket);
      }
      if (id === common.SetPositionTargetGlobalInt.MSG_ID) {
        const target = packet.protocol.data(packet.payload, common.SetPositionTargetGlobalInt);
        latitude = target.latInt; longitude = target.lonInt; altitude = target.alt;
        targets.push({ time: w.clock.now(), latitude: latitude / 1e7, longitude: longitude / 1e7 });
        telemetry(socket);
      }
    });
    telemetry(socket);
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Equipment TCP address unavailable");
  let stopped = false;
  function tick() {
    if (stopped) return;
    for (const socket of sockets) telemetry(socket);
    timer = w.clock.after(200, tick);
  }
  let timer = w.clock.after(200, tick);
  w.onClose(() => {
    stopped = true;
    timer.cancel();
    for (const socket of sockets) socket.destroy();
    return new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  });
  return {
    config: { kind: "ardupilot", host: "127.0.0.1", port: address.port, system_id: 255, heartbeat_s: 1, stream_rate_hz: 5, extended_state_interval_us: 200000 } satisfies Extract<ReturnType<typeof parseConfig>["equipment"], { kind: "ardupilot" }>,
    commands,
    targets,
  };
}
