import assert from "node:assert/strict";
import type { ProtocolTypes } from "@atlas/protocol/types";
import { assetApp } from "../src/asset-app.ts";
import { scenario } from "../src/scenario.ts";
import { value } from "../src/world.ts";

scenario({
  name: "real Asset executes movement through simulated MAVLink equipment",
  checks: ["asset/docs/runtime.md#movement-execution"],
  async run(w) {
    const app = await assetApp(w, { equipment: "ardupilot" });
    await w.until(() => w.events.some(e => e.kind === "report.telemetry" && e.record.asset_id === app.asset_id));
    const sent = value(await w.complete(w.admin.call("sendTasks", {
      params: { asset_id: app.asset_id },
      body: { tasks: [
        { kind: "takeoff", target_altitude: { altitude_reference: "launch", altitude_m: 10 } },
        { kind: "move_to", destination: { latitude: 1.001, longitude: 2.001 } },
        { kind: "hold" },
        { kind: "return_to_home" },
      ] },
    })));
    await w.until(() => w.events.some(e => e.kind === "report.status" && e.record.asset_id === app.asset_id && e.record.kind === "task" && e.record.task_id === sent.task_ids[3] && e.record.task_state === "completed"));
    const completed = w.events.flatMap(e => e.kind === "report.status" && e.record.asset_id === app.asset_id && e.record.kind === "task" && e.record.task_state === "completed" ? [e.record.task_id] : []);
    assert.deepEqual(completed, sent.task_ids);
    assert.ok(app.equipment?.commands.some(c => c.command === 400), "driver armed the equipment");
    assert.ok(app.equipment?.commands.some(c => c.command === 22), "driver requested takeoff");
    assert.ok(app.equipment?.targets.some(p => p.latitude === 1.001 && p.longitude === 2.001), "driver sent destination");
    assert.ok(w.events.some(e => e.kind === "report.telemetry" && e.record.asset_id === app.asset_id && e.record.position?.latitude === 1.001), "Core observed movement");
  },
});

for (const vz of [-300, 300]) scenario({
  name: `Hold waits for vertical motion ${vz} cm/s to stop`,
  checks: ["asset/docs/runtime.md#movement-execution"],
  async run(w) {
    const app = await assetApp(w, { equipment: "ardupilot" });
    assert.ok(app.equipment);
    const send = async (tasks: ProtocolTypes["requests.tasks"]["tasks"]) =>
      value(await w.complete(w.admin.call("sendTasks", { params: { asset_id: app.asset_id }, body: { tasks } }))).task_ids[0];
    const hasState = (taskId: number, state: "active" | "completed") =>
      w.events.some(e => e.kind === "report.status" && e.record.asset_id === app.asset_id &&
        e.record.kind === "task" && e.record.task_id === taskId && e.record.task_state === state);

    const takeoff = await send([{ kind: "takeoff", target_altitude: { altitude_reference: "launch", altitude_m: 10 } }]);
    await w.until(() => hasState(takeoff, "completed"));
    app.equipment.setVerticalSpeedCms(vz);
    await w.advance(1000);

    const hold = await send([{ kind: "hold" }]);
    await w.until(() => hasState(hold, "active"));
    await w.advance(2000);
    assert.equal(hasState(hold, "completed"), false);

    app.equipment.setVerticalSpeedCms(0);
    await w.until(() => hasState(hold, "completed"));
  },
});
