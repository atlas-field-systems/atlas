import assert from "node:assert/strict";

import { writeFile } from "node:fs/promises";

import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

import { value } from "../src/world.ts";

import type { FlightContext } from "./fixture.ts";

export async function equipmentDrop(ctx: FlightContext) {
  value(
    await ctx.admin.call("sendTasks", {
      params: { asset_id: ctx.app.asset_id },
      body: {
        tasks: [
          {
            kind: "takeoff",
            target_altitude: { altitude_m: 5, altitude_reference: "launch" },
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
  ctx.failEquipment = true;
  value(
    await ctx.admin.call("sendTasks", {
      params: { asset_id: ctx.app.asset_id },
      body: {
        tasks: [
          {
            kind: "move_to",
            destination: { latitude: -35.362, longitude: 149.16523 },
          },
          { kind: "hold" },
        ],
      },
    }),
  );
  const explanation =
    ctx.scenario === "equipment-drop"
      ? "equipment connection lost"
      : ctx.scenario === "equipment-timeout"
        ? "command timeout"
        : "ArduPilot command 178 refused (2)";
  await ctx.until(() =>
    ctx.events.some(
      (e) =>
        e.kind === "report.status" &&
        e.record.kind === "task" &&
        e.record.task_id === 2 &&
        e.record.task_state === "failed" &&
        e.record.explanation === explanation,
    ),
  );
  await ctx.until(() =>
    ctx.events.some(
      (e) =>
        e.kind === "report.status" &&
        e.record.kind === "task" &&
        e.record.task_id === 3 &&
        e.record.task_state === "cancelled",
    ),
  );
  ctx.failEquipment = false;
  if (ctx.scenario === "equipment-drop") {
    await delay((ctx.config.measurement_stale_after_s + 0.5) * 1000);
    const telemetryTimes = ctx.events.flatMap((e) =>
      e.kind === "report.telemetry" ? [e.record.time] : [],
    );
    await writeFile(
      join(ctx.root, "equipment-cut.json"),
      JSON.stringify(
        {
          droppedAt: ctx.droppedAt,
          receivedAt: ctx.receivedAt,
          telemetryTimes,
        },
        null,
        2,
      ),
    );
    assert.ok(
      ctx.receivedAt > ctx.droppedAt,
      "buffered equipment bytes arrive after the proxy destroys its connections",
    );
    assert.ok(
      telemetryTimes.some((time) => time > ctx.droppedAt),
      "the controlled race delivers a final measurement after proxy destruction",
    );
    assert.equal(
      telemetryTimes.some((time) => time > ctx.receivedAt),
      false,
      "telemetry never claims acquisition after the Asset last received equipment bytes",
    );
    assert.equal(
      ctx.events.some(
        (e) => e.kind === "report.failsafe" && e.record.kind === "response",
      ),
      false,
    );
    const restoredAt = Date.now();
    ctx.blocked = false;
    await ctx.until(() =>
      ctx.events.some(
        (e) => e.kind === "report.telemetry" && e.record.time > restoredAt,
      ),
    );
  } else {
    value(
      await ctx.admin.call("sendTasks", {
        params: { asset_id: ctx.app.asset_id },
        body: { tasks: [{ kind: "land" }], now: true },
      }),
    );
    await ctx.until(() =>
      ctx.events.some(
        (e) =>
          e.kind === "report.status" &&
          e.record.kind === "task" &&
          e.record.task_id === 4 &&
          e.record.task_state === "completed",
      ),
    );
  }
  await writeFile(
    join(ctx.root, "events.json"),
    JSON.stringify(ctx.events, null, 2),
  );
  return;
}
