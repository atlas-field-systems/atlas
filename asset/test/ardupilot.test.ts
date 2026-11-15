import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Socket } from "node:net";
import { once } from "node:events";
import { minimal, MavLinkProtocolV2, send } from "node-mavlink";
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
  reader.on("data", packet => {
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
