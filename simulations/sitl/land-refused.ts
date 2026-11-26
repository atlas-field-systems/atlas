import assert from "node:assert/strict";
import { once } from "node:events";
import { writeFile } from "node:fs/promises";
import { connect } from "node:net";
import { join } from "node:path";
import {
  common,
  MavLinkPacketParser,
  MavLinkPacketSplitter,
  MavLinkProtocolV2,
  send,
} from "node-mavlink";
import { value } from "../src/world.ts";
import type { FlightContext } from "./fixture.ts";

export async function landRefused(ctx: FlightContext) {
  const observer = connect({ host: "127.0.0.1", port: ctx.pilotPort });
  ctx.cleanup.push(() => observer.destroy());
  await once(observer, "connect");
  const samples: Array<{
    time: number;
    latitude: number;
    altitude: number;
    speed: number;
    northSpeed: number;
  }> = [];
  ctx.t.after(() => writeFile(join(ctx.root, "land-refused.json"), JSON.stringify({ samples, events: ctx.events })));
  observer.pipe(new MavLinkPacketSplitter()).pipe(new MavLinkPacketParser()).on("data", packet => {
    if (packet.header.compid !== 1 || packet.header.msgid !== common.GlobalPositionInt.MSG_ID) return;
    const p = packet.protocol.data(packet.payload, common.GlobalPositionInt);
    samples.push({
      time: p.timeBootMs,
      latitude: p.lat / 1e7,
      altitude: p.relativeAlt / 1000,
      speed: Math.hypot(p.vx, p.vy, p.vz) / 100,
      northSpeed: p.vx / 100,
    });
  });
  const streams = new common.RequestDataStream();
  Object.assign(streams, { targetSystem: 1, targetComponent: 1, reqStreamId: 0, reqMessageRate: 10, startStop: 1 });
  await send(observer, streams, new MavLinkProtocolV2(254, 190));

  const altitude = 5;
  const destination = { latitude: -35.36, longitude: 149.16523 };
  const params = { asset_id: ctx.app.asset_id };
  value(await ctx.admin.call("sendTasks", {
    params,
    body: {
      tasks: [
        { kind: "takeoff", target_altitude: { altitude_m: altitude, altitude_reference: "launch" } },
        { kind: "move_to", destination },
      ],
    },
  }));
  await ctx.until(() => (samples.at(-1)?.northSpeed ?? 0) > 1);
  const moving = samples.at(-1);
  assert.ok(moving);
  ctx.failEquipment = true;
  const land = value(await ctx.admin.call("sendTasks", {
    params,
    body: { now: true, tasks: [{ kind: "land" }] },
  }));
  await ctx.until(() => ctx.events.some(event =>
    event.kind === "report.status" &&
    event.record.kind === "task" &&
    event.record.task_id === land.task_ids[0] &&
    event.record.task_state === "failed",
  ));
  assert.equal(ctx.failEquipment, false, "the proxy denied the Land mode request");

  // A copter still following Move To would eventually hover at its destination.
  // Check that it stops well short and stays aloft across fresh SITL measurements.
  const halfway = (moving.latitude + destination.latitude) / 2;
  const tolerance = ctx.config.completion_tolerances.hold;
  assert.ok(tolerance);
  let cursor = samples.length;
  let hoverSince: number | undefined;
  await ctx.until(() => {
    for (; cursor < samples.length; cursor++) {
      const sample = samples[cursor];
      assert.ok(sample.latitude < halfway, "copter continued toward the old target after Land failed");
      if (sample.speed <= tolerance.stopped_mps && Math.abs(sample.altitude - altitude) <= tolerance.altitude_m) {
        hoverSince ??= sample.time;
        if (sample.time - hoverSince >= 3000) return true;
      } else hoverSince = undefined;
    }
    return false;
  });
}
