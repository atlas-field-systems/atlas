import assert from "node:assert/strict";
import { connect } from "node:net";
import { once } from "node:events";
import {
  send,
  common,
  minimal,
  MavLinkPacketSplitter,
  MavLinkPacketParser,
  MavLinkProtocolV2,
} from "../src/mavlink.ts";

import { readFile, writeFile, readdir } from "node:fs/promises";

import { join } from "node:path";

import { unzipSync, strFromU8 } from "fflate";

import { value } from "../src/world.ts";

import { checkAssetArchive } from "../src/asset-archive.ts";
import type { FlightContext } from "./fixture.ts";

export async function crash(ctx: FlightContext) {
  assert.ok("child" in ctx.app);
  const pilot = connect({ host: "127.0.0.1", port: ctx.pilotPort });
  ctx.cleanup.push(() => {
    pilot.destroy();
  });
  await once(pilot, "connect");
  const samples: Array<{
    time: number;
    mode: number;
    armed: boolean;
  }> = [];
  let position:
    | {
        latitude: number;
        longitude: number;
      }
    | undefined;
  pilot
    .pipe(new MavLinkPacketSplitter())
    .pipe(new MavLinkPacketParser())
    .on("data", (packet) => {
      if (packet.header.msgid === minimal.Heartbeat.MSG_ID) {
        const heartbeat = packet.protocol.data(
          packet.payload,
          minimal.Heartbeat,
        );
        samples.push({
          time: Date.now(),
          mode: heartbeat.customMode,
          armed: !!(heartbeat.baseMode & 128),
        });
      }
      if (packet.header.msgid === common.GlobalPositionInt.MSG_ID) {
        const p = packet.protocol.data(
          packet.payload,
          common.GlobalPositionInt,
        );
        position = { latitude: p.lat / 1e7, longitude: p.lon / 1e7 };
      }
    });
  const streams = new common.RequestDataStream();
  Object.assign(streams, {
    targetSystem: 1,
    targetComponent: 1,
    reqStreamId: 0,
    reqMessageRate: 10,
    startStop: 1,
  });
  await send(pilot, streams, new MavLinkProtocolV2(254, 190));
  value(
    await ctx.admin.call("sendTasks", {
      params: { asset_id: ctx.app.asset_id },
      body: {
        tasks: [
          {
            kind: "takeoff",
            target_altitude: { altitude_m: 10, altitude_reference: "launch" },
          },
          {
            kind: "move_to",
            destination: { latitude: -35.3618, longitude: 149.16523 },
          },
          { kind: "hold" },
        ],
      },
    }),
  );
  await ctx.until(() =>
    ctx.events.some(
      (e) =>
        e.kind === "report.status" &&
        e.record.kind === "task" &&
        e.record.task_id === 2 &&
        e.record.task_state === "active",
    ),
  );
  await ctx.until(() =>
    ctx.events.some(
      (e) =>
        e.kind === "report.status" &&
        e.record.kind === "queue" &&
        e.record.task_ids.includes(3),
    ),
  );
  const killedAt = Date.now();
  ctx.app.child.kill("SIGKILL");
  await ctx.app.closed;
  assert.equal(ctx.app.child.signalCode, "SIGKILL");
  await ctx.until(() =>
    ctx.events.some(
      (e) =>
        e.kind === "asset.contact" &&
        e.record.asset_id === ctx.app.asset_id &&
        e.record.contact === "offline",
    ),
  );
  await ctx.until(() => samples.some((s) => s.time > killedAt && s.mode === 6));
  const rtl = samples.find((s) => s.time > killedAt && s.mode === 6)!;
  assert.ok(
    rtl.time >= killedAt + 600,
    "GCS timeout precedes independent RTL at five times real time",
  );
  assert.equal(
    samples.some((s) => s.time <= killedAt && s.mode === 6),
    false,
  );
  await ctx.until(() => samples.at(-1)?.armed === false);
  assert.ok(position);
  assert.ok(
    Math.hypot(
      (position.latitude + 35.363261) * 111195,
      (position.longitude - 149.16523) * 90700,
    ) < 3,
    "independent RTL lands at the arming home",
  );
  assert.equal(
    ctx.app.child.signalCode,
    "SIGKILL",
    "the app stays down throughout RTL",
  );
  const restartedAt = Date.now();
  const restarted = await ctx.launchProcess();
  assert.equal(restarted.asset_id, ctx.app.asset_id);
  await ctx.until(() =>
    [2, 3].every((id) =>
      ctx.events.some(
        (e) => e.kind === "task.dropped" && e.record.task_id === id,
      ),
    ),
  );
  await ctx.until(() =>
    ctx.events.some(
      (e) => e.kind === "report.telemetry" && e.record.time >= restartedAt,
    ),
  );
  assert.equal(
    ctx.events.some(
      (e) =>
        e.kind === "report.status" &&
        e.record.kind === "task" &&
        [2, 3].includes(e.record.task_id) &&
        e.record.time >= restartedAt,
    ),
    false,
    "restart never resumes or invents outcomes for earlier work",
  );
  assert.equal(
    ctx.events.filter((e) => e.kind === "asset.registered").length,
    1,
  );
  await restarted.stop();
  const archives = await readdir(ctx.config.archive_directory);
  assert.equal(archives.filter((name) => name.endsWith(".zip")).length, 2);
  const checked = await Promise.all(
    archives
      .filter((name) => name.endsWith(".zip"))
      .map(async (name) => {
        const path = join(ctx.config.archive_directory, name);
        const manifest = JSON.parse(
          strFromU8(unzipSync(await readFile(path))["manifest.json"]),
        );
        if (!manifest.normal) return checkAssetArchive(path, false);
      }),
  );
  assert.equal(
    checked.filter(Boolean).length,
    1,
    "the killed operation has a separate verified ZIP",
  );
  await writeFile(
    join(ctx.root, "crash.json"),
    JSON.stringify({ killedAt, restartedAt, samples, position }, null, 2),
  );
  await writeFile(
    join(ctx.root, "events.json"),
    JSON.stringify(ctx.events, null, 2),
  );
  return;
}
