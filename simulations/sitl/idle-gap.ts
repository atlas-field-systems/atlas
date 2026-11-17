import assert from "node:assert/strict";

import { setTimeout as delay } from "node:timers/promises";

import { value } from "../src/world.ts";

import type { FlightContext } from "./fixture.ts";

export async function idleGap(ctx: FlightContext) {
  value(
    await ctx.admin.call("sendTasks", {
      params: { asset_id: ctx.app.asset_id },
      body: {
        tasks: [
          {
            kind: "takeoff",
            target_altitude: {
              altitude_m: 5,
              altitude_reference: "launch",
            },
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
  value(
    await ctx.admin.call("sendTasks", {
      params: { asset_id: ctx.app.asset_id },
      body: { tasks: [{ kind: "hold" }, { kind: "hold" }] },
    }),
  );
  await ctx.until(() =>
    ctx.events.some(
      (e) =>
        e.kind === "report.status" &&
        e.record.kind === "queue" &&
        e.record.task_ids.includes(3),
    ),
  );
  await delay(2000);
  assert.ok(
    ctx.events.some(
      (e) =>
        e.kind === "report.failsafe" &&
        e.record.kind === "response" &&
        e.record.rule_id === "IDLE" &&
        e.record.task_state === "active",
    ),
    "a held Task waiting for a missing predecessor must not suppress idle",
  );
  await ctx.until(() =>
    ctx.events.some(
      (e) =>
        e.kind === "report.failsafe" &&
        e.record.kind === "response" &&
        e.record.rule_id === "IDLE" &&
        e.record.task_state === "completed",
    ),
  );
  return;
}
