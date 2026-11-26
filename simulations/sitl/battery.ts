import assert from "node:assert/strict";

import { readFile } from "node:fs/promises";

import { setTimeout as delay } from "node:timers/promises";

import { unzipSync, strFromU8 } from "fflate";

import { value } from "../src/world.ts";

import { linkLossSeconds, type FlightContext } from "./fixture.ts";

export async function battery(ctx: FlightContext) {
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
  if (ctx.scenario === "boundary") {
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
        body: {
          tasks: [
            {
              kind: "move_to",
              destination: {
                latitude: -35.3628,
                longitude: 149.16523,
                altitudes: [{ altitude_m: 5, altitude_reference: "launch" }],
              },
            },
          ],
        },
      }),
    );
  }
  if (ctx.scenario === "link")
    await ctx.until(() =>
      ctx.events.some(
        (e) =>
          e.kind === "report.telemetry" &&
          e.record.position.altitudes?.some(
            (a) => a.altitude_reference === "launch" && a.altitude_m >= 3,
          ),
      ),
    );
  if (ctx.scenario === "link") {
    ctx.cutNextFrame = true;
    await ctx.until(() => ctx.abortedAt !== undefined);
    await delay(
      linkLossSeconds * 1000 +
        ctx.config.control_tick_s * 2000,
    );
    ctx.linkController = new AbortController();
  }
  await ctx.until(() =>
    ctx.events.some(
      (e) =>
        e.kind === "report.failsafe" &&
        e.record.kind === "response" &&
        e.record.rule_id ===
          (ctx.scenario === "battery"
            ? "LB"
            : ctx.scenario === "boundary"
              ? "AREA"
              : "LINK") &&
        e.record.task_state === "completed",
    ),
  );
  const responses = ctx.events.filter(
    (e) =>
      e.kind === "report.failsafe" &&
      e.record.kind === "response" &&
      e.record.rule_id ===
        (ctx.scenario === "battery"
          ? "LB"
          : ctx.scenario === "boundary"
            ? "AREA"
            : "LINK"),
  );
  assert.ok(
    responses.some(
      (e) =>
        e.kind === "report.failsafe" &&
        e.record.kind === "response" &&
        e.record.task_state === "active",
    ),
  );
  const archive = await ctx.app.stop();
  const zipped = unzipSync(await readFile(archive));
  const entries = Object.entries(zipped)
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
  const reports = entries
    .filter((entry) => entry.kind === "report")
    .map((entry) => entry.report);
  const response = reports.find(
    (r) =>
      r.type === "report.failsafe" &&
      r.kind === "response" &&
      r.rule_id ===
        (ctx.scenario === "battery"
          ? "LB"
          : ctx.scenario === "boundary"
            ? "AREA"
            : "LINK") &&
      r.task_state === "active",
  );
  assert.ok(
    response,
    "archive must contain an emitted response, not startup configuration",
  );
  assert.ok(
    reports.some(
      (r) =>
        r.type === "report.failsafe" &&
        r.rule_id === response.rule_id &&
        r.task_state === "completed",
    ),
  );
  if (ctx.scenario === "boundary") {
    const outside = entries.find(
      (e) =>
        e.kind === "input" &&
        e.event.kind === "measurements" &&
        e.event.measurements.position?.value.latitude > -35.3631,
    );
    assert.ok(
      outside,
      "archive must show the vehicle outside the configured area",
    );
    assert.ok(
      response.time >= outside.event.measurements.position.time + 2000,
      "boundary response must wait for the configured duration",
    );
  }
  if (ctx.scenario === "link")
    assert.ok(
      response.time >=
        ctx.abortedAt! + linkLossSeconds * 1000,
      `LINK started too early at ${response.time - ctx.abortedAt!} ms`,
    );
  console.log(JSON.stringify({ scenario: ctx.scenario, archive }));
  return;
}
