import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Socket } from "node:net";
import { once } from "node:events";
import { minimal, MavLinkProtocolV2, send } from "node-mavlink";
import { systemClock } from "@atlas/sdk";
import { ardupilot } from "../src/ardupilot.ts";
import type { Measurements } from "../src/vehicle.ts";

test("docs/failsafes.md: raw mode remains visible while Land confirmation is pending", { timeout: 5000 }, async (t) => {
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
  assert.equal(observed.mode?.value, 6);
  vehicle.stop();
  await pending;
});
