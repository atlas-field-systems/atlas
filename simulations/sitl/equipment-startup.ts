import assert from "node:assert/strict";

import { writeFile } from "node:fs/promises";

import { join } from "node:path";

import { value } from "../src/world.ts";

import type { FlightContext } from "./fixture.ts";

export async function equipmentStartup(ctx: FlightContext) {
  await ctx.until(() => ctx.events.some((e) => e.kind === "report.settings"));
  value(
    await ctx.admin.call("sendTasks", {
      params: { asset_id: ctx.app.asset_id },
      body: {
        tasks: [
          {
            kind: "takeoff",
            target_altitude: { altitude_m: 5, altitude_reference: "launch" },
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
        e.record.task_id === 1 &&
        e.record.task_state === "failed" &&
        e.record.explanation === "current vehicle state unavailable",
    ),
  );
  await ctx.until(() =>
    ctx.events.some(
      (e) =>
        e.kind === "report.status" &&
        e.record.kind === "task" &&
        e.record.task_id === 2 &&
        e.record.task_state === "cancelled",
    ),
  );
  assert.equal(
    ctx.events.some((e) => e.kind === "report.telemetry"),
    false,
  );
  ctx.blocked = false;
  await ctx.until(() => ctx.events.some((e) => e.kind === "report.telemetry"));
  await writeFile(
    join(ctx.root, "events.json"),
    JSON.stringify(ctx.events, null, 2),
  );
  return;
}
