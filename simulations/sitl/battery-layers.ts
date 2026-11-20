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

export async function batteryLayers(ctx: FlightContext) {
  const pilot = connect({ host: "127.0.0.1", port: ctx.pilotPort });
  pilot.on("error", () => {});
  ctx.cleanup.push(() => {
    pilot.destroy();
  });
  await once(pilot, "connect");
  const protocol = new MavLinkProtocolV2(254, 190);
  const samples: Array<{
    time: number;
    mode: number;
    armed: boolean;
    status: number;
    battery: number;
  }> = [];
  const parameters = new Map<string, number>();
  ctx.t.after(async () => {
    await writeFile(
      join(ctx.root, "battery-layers.json"),
      JSON.stringify(
        { parameters: Object.fromEntries(parameters), samples },
        null,
        2,
      ),
    );
    await writeFile(
      join(ctx.root, "events.json"),
      JSON.stringify(ctx.events, null, 2),
    );
  });
  let vehicleMode = -1,
    armed = false,
    battery = 100;
  pilot
    .pipe(new MavLinkPacketSplitter())
    .pipe(new MavLinkPacketParser())
    .on("data", (packet) => {
      if (packet.header.compid !== 1) return;
      if (packet.header.msgid === minimal.Heartbeat.MSG_ID) {
        const m = packet.protocol.data(packet.payload, minimal.Heartbeat);
        vehicleMode = m.customMode;
        armed = Boolean(m.baseMode & 128);
        samples.push({
          time: Date.now(),
          mode: vehicleMode,
          armed,
          status: m.systemStatus,
          battery,
        });
      }
      if (packet.header.msgid === common.SysStatus.MSG_ID)
        battery = packet.protocol.data(
          packet.payload,
          common.SysStatus,
        ).batteryRemaining;
      if (packet.header.msgid === common.ParamValue.MSG_ID) {
        const m = packet.protocol.data(packet.payload, common.ParamValue);
        parameters.set(m.paramId, m.paramValue);
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
  await send(pilot, streams, protocol);
  const expected = {
    FS_GCS_ENABLE: 1,
    FS_GCS_TIMEOUT: 5,
    MAV_GCS_SYSID: 255,
    FS_OPTIONS: 0,
    BATT_CAPACITY: 1000,
    BATT_LOW_MAH: 150,
    BATT_CRT_MAH: 100,
    BATT_LOW_VOLT: 0,
    BATT_CRT_VOLT: 0,
    BATT_FS_LOW_ACT: 2,
    BATT_FS_CRT_ACT: 1,
  };
  for (const paramId of Object.keys(expected)) {
    const request = new common.ParamRequestRead();
    Object.assign(request, {
      targetSystem: 1,
      targetComponent: 1,
      paramId,
      paramIndex: -1,
    });
    await send(pilot, request, protocol);
    await delay(100);
  }
  await delay(1000);
  assert.deepEqual(
    Object.keys(expected).filter((name) => !parameters.has(name)),
    [],
    "parameters accepted by Copter 4.7.2",
  );
  for (const [name, expectedValue] of Object.entries(expected))
    assert.equal(parameters.get(name), expectedValue, name);
  value(
    await ctx.admin.call("sendTasks", {
      params: { asset_id: ctx.app.asset_id },
      body: {
        tasks: [
          {
            kind: "takeoff",
            target_altitude: { altitude_m: 30, altitude_reference: "launch" },
          },
          {
            kind: "move_to",
            destination: { latitude: -35.35, longitude: 149.16523 },
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
        e.record.task_id === 2 &&
        e.record.task_state === "active",
    ),
  );
  await ctx.until(() =>
    ctx.events.some(
      (e) =>
        e.kind === "report.failsafe" &&
        e.record.kind === "response" &&
        e.record.rule_id === "LB" &&
        e.record.task_state === "active",
    ),
  );
  const response = ctx.events.find(
    (e) =>
      e.kind === "report.failsafe" &&
      e.record.kind === "response" &&
      e.record.rule_id === "LB" &&
      e.record.task_state === "active",
  );
  assert.ok(
    response?.kind === "report.failsafe" &&
      response.record.kind === "response" &&
      response.record.response?.kind === "return_to_home",
  );
  assert.ok(
    ctx.events.some(
      (e) => e.kind === "report.battery" && e.record.battery_percent < 35,
    ),
  );
  await ctx.until(() => vehicleMode === 6);
  assert.ok(battery <= 15, "independent RTL starts at low capacity");
  const lateGuided = async (selected: number) => {
    await ctx.until(
      () =>
        ctx.receivedChargeState ===
        (selected === 9
          ? common.MavBatteryChargeState.CRITICAL
          : common.MavBatteryChargeState.LOW),
    );
    const m = new common.SetMode();
    Object.assign(m, { targetSystem: 1, baseMode: 1, customMode: 4 });
    const start = samples.length;
    await send(pilot, m, protocol);
    await ctx.until(() => samples.slice(start).some((s) => s.mode === 4));
    await delay(500);
    assert.equal(
      vehicleMode,
      selected,
      "battery protection restores its mode after Guided",
    );
  };
  await lateGuided(6);
  await ctx.until(() =>
    ctx.events.some(
      (e) =>
        e.kind === "report.failsafe" &&
        e.record.kind === "autopilot" &&
        e.record.in_control,
    ),
  );
  const takeover = ctx.events.find(
    (e) =>
      e.kind === "report.failsafe" &&
      e.record.kind === "autopilot" &&
      e.record.in_control,
  )!;
  const returnLatitudes = ctx.events.flatMap((e) =>
    e.kind === "report.telemetry" &&
    e.record.time > response.record.time &&
    e.record.time < takeover.time
      ? [e.record.position.latitude]
      : [],
  );
  assert.ok(returnLatitudes.length > 1);
  assert.ok(
    (Math.max(...returnLatitudes) - returnLatitudes.at(-1)!) * 111195 > 5,
    "Atlas travels toward home before controller takeover",
  );
  ctx.hiddenBatteryMode = 9;
  await ctx.until(() => vehicleMode === 9);
  assert.ok(battery <= 10, "independent Land starts at critical capacity");
  await lateGuided(9);
  ctx.hiddenBatteryMode = -1;
  await ctx.until(() => !armed);
  assert.ok(
    ctx.events.some(
      (e) => e.kind === "report.battery" && e.record.battery_percent < 15,
    ),
  );
  assert.ok(
    ctx.events.some(
      (e) => e.kind === "report.battery" && e.record.battery_percent < 10,
    ),
  );
  assert.equal(
    ctx.events.some(
      (e) =>
        e.kind === "report.failsafe" &&
        e.record.kind === "response" &&
        e.time > takeover.time &&
        e.record.task_state === "active",
    ),
    false,
    "Atlas only watches after takeover",
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
  const position = ctx.events.findLast((e) => e.kind === "report.telemetry");
  assert.ok(position?.kind === "report.telemetry");
  assert.ok(
    Math.abs(position.record.position.latitude + 35.363261) * 111195 > 10,
    "critical protection lands before reaching home",
  );
  console.log(
    JSON.stringify({
      scenario: ctx.scenario,
      takeover: takeover.time,
      finalPosition: position.record.position,
    }),
  );
  return;
}
