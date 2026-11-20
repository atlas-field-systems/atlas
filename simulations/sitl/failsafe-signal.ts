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

import { writeFile } from "node:fs/promises";

import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

import { value } from "../src/world.ts";

import type { FlightContext } from "./fixture.ts";

export async function failsafeSignal(ctx: FlightContext) {
  const pilot = connect({ host: "127.0.0.1", port: ctx.pilotPort });
  pilot.on("error", () => {});
  ctx.cleanup.push(() => {
    pilot.destroy();
  });
  await once(pilot, "connect");
  const protocol = new MavLinkProtocolV2(255, 190);
  const samples: unknown[] = [];
  let vehicleMode = -1,
    status = -1;
  pilot
    .pipe(new MavLinkPacketSplitter())
    .pipe(new MavLinkPacketParser())
    .on("data", (packet) => {
      if (packet.header.compid !== 1) return;
      if (packet.header.msgid === minimal.Heartbeat.MSG_ID) {
        const m = packet.protocol.data(packet.payload, minimal.Heartbeat);
        vehicleMode = m.customMode;
        status = m.systemStatus;
        samples.push({ time: Date.now(), mode: vehicleMode, status });
      }
      if (packet.header.msgid === common.RcChannels.MSG_ID)
        samples.push(packet.protocol.data(packet.payload, common.RcChannels));
      if (packet.header.msgid === common.SysStatus.MSG_ID)
        samples.push(packet.protocol.data(packet.payload, common.SysStatus));
    });
  const set = async (paramId: string, paramValue: number) => {
    const m = new common.ParamSet();
    Object.assign(m, {
      targetSystem: 1,
      targetComponent: 1,
      paramId,
      paramValue,
      paramType: 9,
    });
    await send(pilot, m, protocol);
  };
  await set("RC_OVERRIDE_TIME", -1);
  await set("FS_THR_ENABLE", 1);
  await set("FLTMODE1", 4);
  await set("FLTMODE4", 5);
  value(
    await ctx.admin.call("sendTasks", {
      params: { asset_id: ctx.app.asset_id },
      body: {
        tasks: [
          {
            kind: "takeoff",
            target_altitude: { altitude_m: 15, altitude_reference: "launch" },
          },
        ],
      },
    }),
  );
  await ctx.until(() =>
    ctx.events.some(
      (e) =>
        e.kind === "report.status" &&
        e.record.kind === "task" &&
        e.record.task_id === 1 &&
        e.record.task_state === "completed",
    ),
  );
  if (ctx.scenario === "failsafe-signal") {
    await set("SIM_RC_FAIL", 1);
    await ctx.until(() => status === 5 && vehicleMode === 6);
    const m = new common.SetMode();
    Object.assign(m, { targetSystem: 1, baseMode: 1, customMode: 4 });
    await send(pilot, m, protocol);
    await delay(1000);
    await writeFile(
      join(ctx.root, "failsafe-signal.json"),
      JSON.stringify(samples, null, 2),
    );
    assert.equal(
      status,
      5,
      "failsafe remains visible after an external mode selection",
    );
    assert.equal(
      vehicleMode,
      6,
      "Atlas restores radio failsafe RTL after Guided",
    );
    await set("SIM_RC_FAIL", 0);
    await ctx.until(() => status === 4);
    await writeFile(
      join(ctx.root, "failsafe-signal.json"),
      JSON.stringify(samples, null, 2),
    );
    assert.equal(
      ctx.events.some(
        (e) =>
          e.kind === "report.failsafe" &&
          e.record.kind === "autopilot" &&
          !e.record.in_control,
      ),
      false,
    );
  } else {
    const rc = new common.RcChannelsOverride();
    Object.assign(rc, { targetSystem: 1, targetComponent: 1, chan5Raw: 1500 });
    await send(pilot, rc, protocol);
    await ctx.until(() => vehicleMode === 5);
    const m = new common.SetMode();
    Object.assign(m, { targetSystem: 1, baseMode: 1, customMode: 4 });
    await send(pilot, m, protocol);
    await delay(1000);
    await writeFile(
      join(ctx.root, "rc-takeover.json"),
      JSON.stringify(samples, null, 2),
    );
    assert.equal(
      vehicleMode,
      5,
      "persistent pilot switch wins over a late Guided selection",
    );
    assert.equal(
      ctx.events.some(
        (e) =>
          e.kind === "report.failsafe" &&
          e.record.kind === "autopilot" &&
          !e.record.in_control,
      ),
      false,
    );
    await writeFile(
      join(ctx.root, "rc-takeover.json"),
      JSON.stringify(samples, null, 2),
    );
  }
  await writeFile(
    join(ctx.root, "events.json"),
    JSON.stringify(ctx.events, null, 2),
  );
  return;
}
