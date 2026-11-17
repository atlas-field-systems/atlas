import assert from "node:assert/strict";
import { connect } from "node:net";
import { once } from "node:events";
import { send, common, MavLinkProtocolV2 } from "node-mavlink";

import { writeFile } from "node:fs/promises";

import { join } from "node:path";

import { value } from "../src/world.ts";

import type { FlightContext } from "./fixture.ts";

export async function subsystem(ctx: FlightContext) {
  await ctx.until(() =>
    ctx.events.some(
      (e) =>
        e.kind === "report.status" &&
        e.record.kind === "subsystem" &&
        e.record.condition === "healthy",
    ),
  );
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
  const pilot = connect({ host: "127.0.0.1", port: ctx.pilotPort });
  ctx.cleanup.push(() => {
    pilot.destroy();
  });
  await once(pilot, "connect");
  const disable = new common.ParamSet();
  Object.assign(disable, {
    targetSystem: 1,
    targetComponent: 1,
    paramId: "SIM_GPS1_ENABLE",
    paramValue: 0,
    paramType: 9,
  });
  assert.equal(
    ctx.events.filter(
      (e) =>
        e.kind === "report.status" &&
        e.record.kind === "subsystem" &&
        e.record.condition === "healthy",
    ).length,
    1,
    "unchanged GPS health is not broadcast periodically",
  );
  const disabledAt = Date.now();
  await send(pilot, disable, new MavLinkProtocolV2(254, 190));
  await ctx.until(() =>
    ctx.events.some(
      (e) =>
        e.kind === "report.status" &&
        e.record.kind === "subsystem" &&
        e.record.subsystem_id === "GPS" &&
        e.record.condition === "faulted" &&
        e.record.time >= disabledAt,
    ),
  );
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
