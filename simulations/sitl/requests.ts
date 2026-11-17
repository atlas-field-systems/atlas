import assert from "node:assert/strict";

import { writeFile } from "node:fs/promises";

import { join } from "node:path";

import { value } from "../src/world.ts";

import type { FlightContext } from "./fixture.ts";

export async function requests(ctx: FlightContext) {
  const invalid = value(
    await ctx.admin.call("changeSettings", {
      params: { asset_id: ctx.app.asset_id },
      body: {
        settings: {
          failsafe_policy: [
            ...ctx.config.initial_settings.failsafe_policy!,
            {
              rule_id: "BAD",
              priority: 99,
              conditions: [{ kind: "airborne" }],
              response: { kind: "land" },
            },
          ],
        },
      },
    }),
  );
  assert.ok("event_id" in invalid);
  await ctx.until(() =>
    ctx.events.some(
      (e) =>
        e.kind === "report.settings" &&
        e.record.request_id === invalid.event_id,
    ),
  );
  const answer = ctx.events.find(
    (e) =>
      e.kind === "report.settings" && e.record.request_id === invalid.event_id,
  );
  assert.ok(answer?.kind === "report.settings");
  assert.deepEqual(
    answer.record.settings.failsafe_policy,
    ctx.config.initial_settings.failsafe_policy,
  );
  value(
    await ctx.admin.call("sendTasks", {
      params: { asset_id: ctx.app.asset_id },
      body: {
        tasks: [
          {
            kind: "takeoff",
            target_altitude: { altitude_m: 10, altitude_reference: "launch" },
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
      body: { tasks: [{ kind: "failsafe" }], now: true },
    }),
  );
  await ctx.until(() =>
    ctx.events.some(
      (e) =>
        e.kind === "report.failsafe" &&
        e.record.kind === "response" &&
        e.record.task_state === "active",
    ),
  );
  let release!: () => void;
  ctx.reportGate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const task = value(
    await ctx.admin.call("sendTasks", {
      params: { asset_id: ctx.app.asset_id },
      body: { tasks: [{ kind: "hold" }] },
    }),
  );
  assert.ok("task_ids" in task);
  const cancel = value(
    await ctx.admin.call("cancel", {
      params: { asset_id: ctx.app.asset_id, task_id: task.task_ids[0] },
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
        e.record.request_id === cancel.event_id &&
        e.record.task_state === "failed",
    ),
  );
  assert.ok("task_ids" in task && "event_id" in task);
  await ctx.until(() =>
    ctx.events.some(
      (e) =>
        e.kind === "report.status" &&
        e.record.kind === "task" &&
        e.record.task_id === task.task_ids[0] &&
        e.record.task_state === "failed" &&
        e.record.request_id === task.event_id,
    ),
  );
  assert.equal(
    ctx.events.some(
      (e) =>
        e.kind === "report.status" &&
        e.record.kind === "queue" &&
        e.record.task_ids.includes(task.task_ids[0]),
    ),
    false,
  );
  await ctx.until(() =>
    ctx.events.some(
      (e) =>
        e.kind === "report.failsafe" &&
        e.record.kind === "response" &&
        e.record.task_state === "completed",
    ),
  );
  await writeFile(
    join(ctx.root, "events.json"),
    JSON.stringify(ctx.events, null, 2),
  );
  return;
}
