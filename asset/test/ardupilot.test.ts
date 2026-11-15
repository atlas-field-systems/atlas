import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Socket } from "node:net";
import { once } from "node:events";
import { minimal, common, MavLinkPacketParser, MavLinkPacketSplitter, MavLinkProtocolV2, send } from "node-mavlink";
import { systemClock } from "@atlas/sdk";
import { ardupilot } from "../src/ardupilot.ts";
import type { Measurements, VehicleCommand } from "../src/vehicle.ts";

test("docs/failsafes.md: flight-controller takeover remains visible while Land confirmation is pending", { timeout: 5000 }, async (t) => {
  const server = createServer();
  let peer: Socket | undefined;
  t.after(() => { peer?.destroy(); server.close(); });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const connected = once(server, "connection");
  const vehicle = ardupilot({ kind: "ardupilot", host: "127.0.0.1", port: address.port, system_id: 255, heartbeat_s: 1 }, systemClock);
  t.after(() => vehicle.stop());
  let receive: (measurements: Measurements) => void = () => {};
  vehicle.start(m => receive(m));
  [peer] = await connected;
  assert.ok(peer);
  const heartbeat = async (mode: number) => {
    const message = new minimal.Heartbeat();
    Object.assign(message, { type: 2, autopilot: 3, baseMode: 129, customMode: mode, systemStatus: 4, mavlinkVersion: 3 });
    const observed = new Promise<Measurements>(resolve => { receive = resolve; });
    await send(peer!, message, new MavLinkProtocolV2(1, 1));
    return observed;
  };
  await heartbeat(4);
  const pending = vehicle.command({ kind: "land", mode: 9, destination: undefined, transit_altitude: undefined }).catch(() => {});
  assert.equal((await heartbeat(4)).in_control?.value, true, "the previous Atlas mode remains valid until Land is observed");
  const observed = await heartbeat(6);
  assert.equal(observed.in_control?.value, false);
  vehicle.stop();
  await pending;
});

for (const staleResult of [0, 2]) test(`docs/runtime.md: stale ACK result ${staleResult} before write completion cannot settle a replacement command`, { timeout: 5000 }, async (t) => {
  const { Socket } = await import("node:net");
  const { common, MavLinkPacketSplitter, MavLinkPacketParser } = await import("node-mavlink");
  const server = createServer();
  let peer: Socket | undefined;
  t.after(() => { peer?.destroy(); server.close(); });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const connected = once(server, "connection");
  let ackSeen = () => {};
  const vehicle = ardupilot({ kind: "ardupilot", host: "127.0.0.1", port: address.port, system_id: 255, heartbeat_s: 1 }, systemClock, value => {
    if (value instanceof common.CommandAck && value.command === 178) ackSeen();
  });
  t.after(() => vehicle.stop());
  vehicle.start(() => {});
  [peer] = await connected;
  assert.ok(peer);
  const protocol = new MavLinkProtocolV2(1, 1);
  const heartbeat = new minimal.Heartbeat();
  Object.assign(heartbeat, { type: 2, autopilot: 3, baseMode: 129, customMode: 4, systemStatus: 4, mavlinkVersion: 3 });
  const reader = peer.pipe(new MavLinkPacketSplitter()).pipe(new MavLinkPacketParser());
  const firstSpeed = Promise.withResolvers<void>();
  reader.on("data", (packet: import("node-mavlink").MavLinkPacket) => {
    if (packet.header.msgid === common.SetMode.MSG_ID) void send(peer!, heartbeat, protocol);
    if (packet.header.msgid === common.CommandLong.MSG_ID) {
      const message = packet.protocol.data(packet.payload, common.CommandLong);
      if (message.command === 178) firstSpeed.resolve();
    }
  });
  const move = { kind: "move_to", mode: 4, speed: 2, position: { latitude: 1, longitude: 1, altitudes: [{ altitude_m: 5, altitude_reference: "launch" }] } } satisfies VehicleCommand;
  const previous = vehicle.command(move).catch(error => error);
  await firstSpeed.promise;
  const written = Promise.withResolvers<void>();
  let release = () => {};
  const original = Socket.prototype._write;
  t.mock.method(Socket.prototype, "_write", function (this: Socket, chunk: Buffer, encoding: BufferEncoding, callback: (error?: Error | null) => void) {
    if (this.remotePort === address.port && chunk[7] === 76 && chunk[8] === 0 && chunk[9] === 0 && chunk.readUInt16LE(38) === 178) {
      original.call(this, chunk, encoding, error => {
        release = () => callback(error);
        written.resolve();
      });
    } else original.call(this, chunk, encoding, callback);
  });
  let outcome = "pending";
  const next = vehicle.command(move).then(() => { outcome = "accepted"; }, () => { outcome = "refused"; });
  await written.promise;
  assert.match(String(await previous), /superseded/);
  const ack = new common.CommandAck();
  Object.assign(ack, { command: 178, result: staleResult });
  const stale = Promise.withResolvers<void>();
  ackSeen = () => stale.resolve();
  await send(peer, ack, protocol);
  await stale.promise;
  release();
  await new Promise<void>(resolve => setImmediate(resolve));
  assert.equal(outcome, "pending");
  Object.assign(ack, { result: 0 });
  await send(peer, ack, protocol);
  await next;
  assert.equal(outcome, "accepted");
});

test("docs/README.md: equipment TCP loss rejects a pending command and reconnects without restarting the app", { timeout: 5000 }, async t => {
  const server = createServer();
  const peers = new Set<Socket>();
  server.on("connection", peer => { peers.add(peer); peer.on("error", () => {}); peer.on("close", () => peers.delete(peer)); });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const vehicle = ardupilot({ kind: "ardupilot", host: "127.0.0.1", port: address.port, system_id: 255, heartbeat_s: 0.01 }, systemClock);
  t.after(() => { vehicle.stop(); for (const peer of peers) peer.destroy(); server.close(); });
  const connection = once(server, "connection");
  vehicle.start(() => {});
  const [peer] = await connection;
  const reader = peer.pipe(new MavLinkPacketSplitter()).pipe(new MavLinkPacketParser());
  const written = new Promise<void>(resolve => reader.on("data", (packet: import("node-mavlink").MavLinkPacket) => {
    if (packet.header.msgid === common.SetMode.MSG_ID) resolve();
  }));
  const pending = vehicle.command({ kind: "land", mode: 9, destination: undefined, transit_altitude: undefined });
  const rejected = assert.rejects(pending, /equipment connection lost/);
  await written;
  peer.destroy();
  await rejected;
  const reconnected = once(server, "connection");
  vehicle.tick(Date.now() + 1000);
  await reconnected;
});

test("docs/failsafes.md: armed RTL before the first Atlas command is watch only", { timeout: 5000 }, async t => {
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const connection = once(server, "connection");
  const vehicle = ardupilot({ kind: "ardupilot", host: "127.0.0.1", port: address.port, system_id: 255, heartbeat_s: 1 }, systemClock);
  const observed = Promise.withResolvers<Measurements>();
  vehicle.start(m => { if (m.in_control) observed.resolve(m); });
  const [peer] = await connection;
  t.after(() => { vehicle.stop(); peer.destroy(); server.close(); });
  const heartbeat = new minimal.Heartbeat();
  Object.assign(heartbeat, { type: 2, autopilot: 3, baseMode: 129, customMode: 6, systemStatus: 4, mavlinkVersion: 3 });
  await send(peer, heartbeat, new MavLinkProtocolV2(1, 1));
  assert.equal((await observed.promise).in_control?.value, false);
  await assert.rejects(vehicle.command({ kind: "land", mode: 9, destination: undefined, transit_altitude: undefined }), /flight controller is in control/);
});

for (const modes of [[4, 6], [0]] as const) test(`docs/failsafes.md: takeover during Guided selection (${modes}) aborts Takeoff before arm`, { timeout: 5000 }, async t => {
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const connection = once(server, "connection");
  const vehicle = ardupilot({ kind: "ardupilot", host: "127.0.0.1", port: address.port, system_id: 255, heartbeat_s: 1 }, systemClock);
  const first = Promise.withResolvers<void>();
  vehicle.start(m => { if (m.armed?.value === false) first.resolve(); });
  const [peer] = await connection;
  t.after(() => { vehicle.stop(); peer.destroy(); server.close(); });
  const disarmed = new minimal.Heartbeat();
  Object.assign(disarmed, { type: 2, autopilot: 3, baseMode: 1, customMode: 0, systemStatus: 4, mavlinkVersion: 3 });
  await send(peer, disarmed, new MavLinkProtocolV2(1, 1));
  await first.promise;
  const writes: number[] = [];
  const protocol = new MavLinkProtocolV2(1, 1);
  const reader = peer.pipe(new MavLinkPacketSplitter()).pipe(new MavLinkPacketParser());
  reader.on("data", (packet: import("node-mavlink").MavLinkPacket) => {
    if (packet.header.msgid === common.CommandLong.MSG_ID) writes.push(packet.protocol.data(packet.payload, common.CommandLong).command);
    if (packet.header.msgid === common.SetMode.MSG_ID) {
      peer.cork();
      for (const customMode of modes) {
        const m = new minimal.Heartbeat();
        Object.assign(m, { type: 2, autopilot: 3, baseMode: 129, customMode, systemStatus: 4, mavlinkVersion: 3 });
        void send(peer, m, protocol);
      }
      peer.uncork();
    }
  });
  const pending = vehicle.command({ kind: "takeoff", mode: 4, altitude: { altitude_m: 5, altitude_reference: "launch" } });
  await assert.rejects(pending, /flight controller/);
  assert.equal(writes.includes(400), false);
  assert.equal(writes.includes(22), false);
});

test("docs/failsafes.md: observed Land survives delayed critical battery evidence", { timeout: 5000 }, async (t) => {
  const server = createServer();
  let peer: Socket | undefined;
  t.after(() => { peer?.destroy(); server.close(); });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const connected = once(server, "connection");
  const vehicle = ardupilot({ kind: "ardupilot", host: "127.0.0.1", port: address.port, system_id: 255, heartbeat_s: 1 }, systemClock);
  t.after(() => vehicle.stop());
  vehicle.start(() => {});
  [peer] = await connected;
  peer.on("error", () => {});
  const protocol = new MavLinkProtocolV2(1, 1);
  const reader = peer.pipe(new MavLinkPacketSplitter()).pipe(new MavLinkPacketParser());
  const correction = Promise.withResolvers<number>();
  reader.on("data", (packet: import("node-mavlink").MavLinkPacket) => {
    if (packet.header.msgid === common.SetMode.MSG_ID)
      correction.resolve(packet.protocol.data(packet.payload, common.SetMode).customMode);
  });
  for (const [paramId, paramValue] of [["BATT_FS_LOW_ACT", 2], ["BATT_FS_CRT_ACT", 1]] as const) {
    const m = new common.ParamValue();
    Object.assign(m, { paramId, paramValue, paramType: 9, paramCount: 2, paramIndex: 0 });
    await send(peer, m, protocol);
  }
  const battery = new common.BatteryStatus();
  Object.assign(battery, { id: 0, chargeState: common.MavBatteryChargeState.LOW });
  await send(peer, battery, protocol);
  for (const customMode of [6, 9, 4]) {
    const m = new minimal.Heartbeat();
    Object.assign(m, { type: 2, autopilot: 3, baseMode: 129, customMode, systemStatus: 5, mavlinkVersion: 3 });
    await send(peer, m, protocol);
  }
  assert.equal(await correction.promise, 9);
});
