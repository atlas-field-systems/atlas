import assert from "node:assert/strict";

import { readFile, writeFile } from "node:fs/promises";

import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

import { unzipSync, strFromU8 } from "fflate";

import { value } from "../src/world.ts";

import { checkAssetArchive } from "../src/asset-archive.ts";
import type { FlightContext } from "./fixture.ts";

export async function flight(ctx: FlightContext) {
  const tasks = value(
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
          { kind: "hold" },
          {
            kind: "move_to",
            destination: {
              latitude: -35.3628,
              longitude: 149.16523,
              altitudes: [{ altitude_m: 5, altitude_reference: "launch" }],
            },
          },
          ...(ctx.scenario === "land-now" ? [] : [{ kind: "land" as const }]),
        ],
      },
    }),
  );
  await ctx.until(() =>
    ctx.events.some(
      (e) =>
        e.kind === "report.status" &&
        e.record.kind === "task" &&
        e.record.task_id === 3 &&
        e.record.task_state === "active",
    ),
  );
  if (ctx.scenario === "land-now") {
    value(
      await ctx.admin.call("sendTasks", {
        params: { asset_id: ctx.app.asset_id },
        body: { tasks: [{ kind: "land" }], now: true },
      }),
    );
  } else {
    value(
      await ctx.admin.call("changeSettings", {
        params: { asset_id: ctx.app.asset_id },
        body: { settings: { run_state: "paused" } },
      }),
    );
    await ctx.until(() =>
      ctx.events.some(
        (e) =>
          e.kind === "report.settings" &&
          e.record.settings.run_state === "paused",
      ),
    );
    await delay(500);
    value(
      await ctx.admin.call("changeSettings", {
        params: { asset_id: ctx.app.asset_id },
        body: { settings: { run_state: "running" } },
      }),
    );
  }
  async function waitForDone() {
    const end = Date.now() + 100000;
    while (Date.now() < end) {
      const reports = ctx.events
        .filter((e) => e.kind === "report.status")
        .map((e) => e.record);
      const finals = reports.filter(
        (r) =>
          "type" in r &&
          r.type === "report.status" &&
          "task_state" in r &&
          r.task_state !== "active",
      );
      if (finals.length >= 4) return finals;
      await delay(100);
    }
    throw new Error(
      `flight timeout: ${JSON.stringify(ctx.events.slice(-12))}\n${ctx.diagnostics.slice(-2000)}`,
    );
  }
  const finals = await waitForDone();
  for (const final of finals) {
    if (final.type !== "report.status" || final.kind !== "task") continue;
    assert.equal(
      ctx.events.filter(
        (e) =>
          e.kind === "report.status" &&
          e.record.kind === "task" &&
          e.record.task_id === final.task_id &&
          e.record.task_state === "active",
      ).length,
      1,
      "Core retains one active report before each Task's final outcome",
    );
  }
  await writeFile(
    join(ctx.root, "events.json"),
    JSON.stringify(ctx.events, null, 2),
  );
  assert.deepEqual(
    finals.map((r) => ("task_state" in r ? r.task_state : null)),
    ctx.scenario === "land-now"
      ? ["completed", "completed", "cancelled", "completed"]
      : ["completed", "completed", "completed", "completed"],
  );
  if (ctx.scenario === "flight")
    assert.ok(
      ctx.events.some(
        (e) =>
          e.kind === "report.telemetry" &&
          Math.abs(e.record.position.latitude + 35.3628) < 0.00002 &&
          Math.abs(e.record.position.longitude - 149.16523) < 0.00002,
      ),
      "Core receives telemetry near the Move To destination",
    );
  const archive = await ctx.app.stop();
  if (ctx.scenario === "flight") await checkAssetArchive(archive, true);
  const entries = Object.entries(unzipSync(await readFile(archive)))
    .filter(([name]) => name.startsWith("diagnostics/"))
    .flatMap(([, data]) =>
      strFromU8(data)
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line)),
    );
  const armed = entries
    .filter(
      (entry) =>
        entry.kind === "input" &&
        entry.event.kind === "measurements" &&
        entry.event.measurements.armed,
    )
    .at(-1);
  assert.equal(
    armed?.event.measurements.armed.value,
    false,
    "last archived armed measurement must show disarmed",
  );
  console.log(JSON.stringify({ tasks, finals }));
}
