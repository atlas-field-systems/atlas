import assert from "node:assert/strict";

import { writeFile } from "node:fs/promises";

import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

import { value } from "../src/world.ts";

import type { FlightContext } from "./fixture.ts";

export async function armedStartup(ctx: FlightContext) {
  await delay(1000);
  assert.ok(
    ctx.events.some(
      (e) =>
        e.kind === "report.failsafe" &&
        e.record.kind === "autopilot" &&
        e.record.in_control,
    ),
    "armed Loiter before any Atlas command must be watch only",
  );
  const refused = value(
    await ctx.admin.call("sendTasks", {
      params: { asset_id: ctx.app.asset_id },
      body: { tasks: [{ kind: "land" }], now: true },
    }),
  );
  assert.ok("task_ids" in refused);
  await ctx.until(() =>
    ctx.events.some(
      (e) =>
        e.kind === "report.status" &&
        e.record.kind === "task" &&
        e.record.task_id === refused.task_ids[0] &&
        e.record.task_state === "failed" &&
        e.record.explanation === "flight controller is in control",
    ),
  );
  await writeFile(
    join(ctx.root, "events.json"),
    JSON.stringify(ctx.events, null, 2),
  );
  return;
}
