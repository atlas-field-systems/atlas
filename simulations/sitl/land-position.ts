import assert from "node:assert/strict";

import { readFile, writeFile } from "node:fs/promises";

import { join } from "node:path";

import { unzipSync, strFromU8 } from "fflate";

import { value } from "../src/world.ts";

import type { FlightContext } from "./fixture.ts";

export async function landPosition(ctx: FlightContext) {
  const target = { latitude: -35.36295, longitude: 149.16523 };
  if (ctx.scenario === "atlas-home")
    value(
      await ctx.admin.call("changeSettings", {
        params: { asset_id: ctx.app.asset_id },
        body: { settings: { home_position: target } },
      }),
    );
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
          ctx.scenario === "land-position"
            ? {
                kind: "land",
                landing_position: target,
                transit_altitude: {
                  altitude_m: 8,
                  altitude_reference: "launch",
                },
              }
            : {
                kind: "return_to_home",
                transit_altitude: {
                  altitude_m: 8,
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
        e.record.task_id === 2 &&
        e.record.task_state !== "active",
    ),
  );
  await writeFile(
    join(ctx.root, "events.json"),
    JSON.stringify(ctx.events, null, 2),
  );
  const archive = await ctx.app.stop();
  const entries = Object.entries(unzipSync(await readFile(archive)))
    .filter(([name]) => name.startsWith("diagnostics/"))
    .flatMap(([, data]) =>
      strFromU8(data)
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line)),
    );
  assert.equal(
    entries
      .filter(
        (e) =>
          e.kind === "input" &&
          e.event.kind === "measurements" &&
          e.event.measurements.armed,
      )
      .at(-1)?.event.measurements.armed.value,
    false,
  );
  const last = ctx.events.filter((e) => e.kind === "report.telemetry").at(-1);
  assert.ok(last?.kind === "report.telemetry");
  const metres = Math.hypot(
    (last.record.position.latitude - target.latitude) * 111195,
    (last.record.position.longitude - target.longitude) * 90700,
  );
  assert.ok(
    metres < 3,
    `Core final position is ${metres} m from requested destination`,
  );
  assert.ok(
    ctx.events.some(
      (e) =>
        e.kind === "report.status" &&
        e.record.kind === "task" &&
        e.record.task_id === 2 &&
        e.record.task_state === "completed",
    ),
  );
  return;
}
