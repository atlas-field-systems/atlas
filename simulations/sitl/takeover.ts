import assert from "node:assert/strict";
import { connect } from "node:net";
import { once } from "node:events";
import { send, common, MavLinkProtocolV2 } from "../src/mavlink.ts";

import { writeFile } from "node:fs/promises";

import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

import { value } from "../src/world.ts";

import type { FlightContext } from "./fixture.ts";

export async function takeover(ctx: FlightContext) {
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
  const policy = value(
    await ctx.admin.call("changeSettings", {
      params: { asset_id: ctx.app.asset_id },
      body: {
        settings: {
          failsafe_policy: [
            ...ctx.config.initial_settings.failsafe_policy!,
            {
              rule_id: "GPS",
              priority: 50,
              conditions: [
                {
                  kind: "subsystem",
                  subsystem_id: "GPS",
                  trigger_condition: "degraded",
                },
              ],
              response: { kind: "land" },
            },
            {
              rule_id: "CMD",
              priority: 80,
              conditions: [{ kind: "commanded" }],
              response: {
                kind: "land",
                landing_position: { latitude: -35.362, longitude: 149.16523 },
              },
            },
          ],
        },
      },
    }),
  );
  assert.ok("event_id" in policy);
  await ctx.until(() =>
    ctx.events.some(
      (e) =>
        e.kind === "report.settings" && e.record.request_id === policy.event_id,
    ),
  );
  value(
    await ctx.admin.call("sendTasks", {
      params: { asset_id: ctx.app.asset_id },
      body: {
        tasks:
          ctx.scenario === "takeover-response"
            ? [{ kind: "failsafe" }]
            : [
                {
                  kind: "move_to",
                  destination: { latitude: -35.362, longitude: 149.16523 },
                },
                { kind: "hold" },
              ],
        now: ctx.scenario === "takeover-response",
      },
    }),
  );
  await ctx.until(() =>
    ctx.events.some((e) =>
      ctx.scenario === "takeover-response"
        ? e.kind === "report.failsafe" &&
          e.record.kind === "response" &&
          e.record.rule_id === "CMD" &&
          e.record.task_state === "active"
        : e.kind === "report.status" &&
          e.record.kind === "task" &&
          e.record.task_id === 2 &&
          e.record.task_state === "active",
    ),
  );
  await ctx.until(() =>
    ctx.events.some(
      (e) =>
        e.kind === "report.telemetry" && e.record.position.latitude > -35.3632,
    ),
  );
  const pilot = connect({ host: "127.0.0.1", port: ctx.pilotPort });
  ctx.cleanup.push(() => {
    pilot.destroy();
  });
  await once(pilot, "connect");
  const mode = async (customMode: number) => {
    const message = new common.SetMode();
    Object.assign(message, { targetSystem: 1, baseMode: 1, customMode });
    await send(pilot, message, new MavLinkProtocolV2(254, 190));
  };
  const gps = async (enabled: number) => {
    const message = new common.ParamSet();
    Object.assign(message, {
      targetSystem: 1,
      targetComponent: 1,
      paramId: "SIM_GPS1_ENABLE",
      paramValue: enabled,
      paramType: 9,
    });
    await send(pilot, message, new MavLinkProtocolV2(254, 190));
  };
  await mode(5);
  await ctx.until(() =>
    ctx.events.some(
      (e) =>
        e.kind === "report.failsafe" &&
        e.record.kind === "autopilot" &&
        e.record.in_control,
    ),
  );
  await ctx.until(() =>
    ctx.events.some((e) =>
      ctx.scenario === "takeover-response"
        ? e.kind === "report.failsafe" &&
          e.record.kind === "response" &&
          e.record.rule_id === "CMD" &&
          e.record.task_state === "cancelled"
        : e.kind === "report.status" &&
          e.record.kind === "task" &&
          e.record.task_id === 2 &&
          e.record.task_state === "cancelled",
    ),
  );
  if (ctx.scenario === "takeover")
    await ctx.until(() =>
      ctx.events.some(
        (e) =>
          e.kind === "report.status" &&
          e.record.kind === "task" &&
          e.record.task_id === 3 &&
          e.record.task_state === "cancelled",
      ),
    );
  const responseCount = ctx.events.filter(
    (e) =>
      e.kind === "report.failsafe" &&
      e.record.kind === "response" &&
      e.record.rule_id &&
      e.record.task_state === "active",
  ).length;
  let release!: () => void;
  ctx.reportGate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const refused = value(
    await ctx.admin.call("sendTasks", {
      params: { asset_id: ctx.app.asset_id },
      body: { tasks: [{ kind: "land" }], now: true },
    }),
  );
  assert.ok("task_ids" in refused && "event_id" in refused);
  const cancel = value(
    await ctx.admin.call("cancel", {
      params: { asset_id: ctx.app.asset_id, task_id: refused.task_ids[0] },
    }),
  );
  assert.ok("event_id" in cancel);
  release();
  ctx.reportGate = undefined;
  await ctx.until(() =>
    ctx.events.some(
      (e) =>
        e.kind === "report.status" &&
        e.record.kind === "task" &&
        e.record.task_id === refused.task_ids[0] &&
        e.record.task_state === "failed" &&
        e.record.explanation === "flight controller is in control" &&
        e.record.request_id === refused.event_id,
    ),
  );
  await ctx.until(() =>
    ctx.events.some(
      (e) =>
        e.kind === "report.status" &&
        e.record.kind === "task" &&
        e.record.task_id === refused.task_ids[0] &&
        e.record.request_id === cancel.event_id &&
        e.record.task_state === "failed",
    ),
  );
  const setting = value(
    await ctx.admin.call("changeSettings", {
      params: { asset_id: ctx.app.asset_id },
      body: { settings: { run_state: "paused" } },
    }),
  );
  assert.ok("event_id" in setting);
  await ctx.until(() =>
    ctx.events.some(
      (e) =>
        e.kind === "report.settings" &&
        e.record.request_id === setting.event_id &&
        e.record.settings.run_state === "running",
    ),
  );
  const disabledAt = Date.now();
  await gps(0);
  await ctx.until(() =>
    ctx.events.some(
      (e) =>
        e.kind === "report.status" &&
        e.record.kind === "subsystem" &&
        e.record.condition === "faulted" &&
        e.record.time >= disabledAt,
    ),
  );
  await delay(500);
  assert.equal(
    ctx.events.filter(
      (e) =>
        e.kind === "report.failsafe" &&
        e.record.kind === "response" &&
        e.record.rule_id &&
        e.record.task_state === "active",
    ).length,
    responseCount,
    "no Atlas rule fires under flight-controller control",
  );
  const restoredAt = Date.now();
  await gps(1);
  await ctx.until(() =>
    ctx.events.some(
      (e) =>
        e.kind === "report.status" &&
        e.record.kind === "subsystem" &&
        e.record.condition === "healthy" &&
        e.record.time >= restoredAt,
    ),
  );
  await mode(4);
  await ctx.until(() =>
    ctx.events.some(
      (e) =>
        e.kind === "report.failsafe" &&
        e.record.kind === "autopilot" &&
        !e.record.in_control,
    ),
  );
  await ctx.until(() =>
    ctx.events.some(
      (e) =>
        e.kind === "report.failsafe" &&
        e.record.kind === "response" &&
        e.record.response?.kind === "hold" &&
        e.record.task_state === "completed",
    ),
  );
  assert.equal(
    ctx.events.filter(
      (e) =>
        e.kind === "report.failsafe" &&
        e.record.kind === "response" &&
        e.record.rule_id &&
        e.record.task_state === "active",
    ).length,
    responseCount,
    "handback holds with rules re-armed",
  );
  await gps(0);
  await ctx.until(() =>
    ctx.events.some(
      (e) =>
        e.kind === "report.failsafe" &&
        e.record.kind === "response" &&
        e.record.rule_id === "GPS" &&
        e.record.task_state === "completed",
    ),
  );
  await writeFile(
    join(ctx.root, "events.json"),
    JSON.stringify(ctx.events, null, 2),
  );
  return;
}
