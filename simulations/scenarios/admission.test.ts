import assert from "node:assert/strict";
import { scenario } from "../src/scenario.ts";
import { assetApp } from "../src/asset-app.ts";
import type { World } from "../src/world.ts";

async function pausedAsset(w: World) {
  return assetApp(w, { config: {
    description: { commands: [], reports: ["status", "settings"], settings: ["run_state"] },
    initial_settings: { run_state: "paused" },
  } });
}
function held(w: World, asset_id: string) {
  const latest = w.events.filter(e => e.kind === "report.status" && e.record.asset_id === asset_id && e.record.kind === "queue").at(-1);
  return latest?.kind === "report.status" && latest.record.kind === "queue" ? latest.record.task_ids : [];
}
import { value } from "../src/world.ts";
scenario({
  name: "admission uses latest reported queue and admits now at capacity",
  checks: [
    "core/docs/requests.md#scenario-paused-work-at-capacity",
    "core/docs/requests.md#scenario-now-at-capacity",
  ],
  async run(w) {
    const asset = await pausedAsset(w);
    const params = { asset_id: asset.asset_id };
    value(
      await w.complete(
        w.admin.call("sendTasks", {
          params,
          body: {
            tasks: Array.from({ length: 63 }, () => ({
              kind: "settings" as const, settings: { run_state: "paused" as const },
            })),
          },
        }),
      ),
    );
    await w.until(() => held(w, asset.asset_id).length === 63);
    value(
      await w.complete(
        w.admin.call("sendTasks", {
          params,
          body: { tasks: [{ kind: "settings", settings: { run_state: "paused" } }] },
        }),
      ),
    );
    await w.until(() => held(w, asset.asset_id).length === 64);
    const full = await w.complete(
      w.admin.call("sendTasks", {
        params,
        body: { tasks: [{ kind: "settings", settings: { run_state: "paused" } }] },
      }),
    );
    assert.ok(!full.ok && full.error === "queue_full" && full.status === 409);
    value(
      await w.complete(
        w.admin.call("cancel", { params: { ...params, task_id: 1 } }),
      ),
    );
    await w.until(() => held(w, asset.asset_id).length === 63);
    value(
      await w.complete(
        w.admin.call("sendTasks", {
          params,
          body: { tasks: [{ kind: "settings", settings: { run_state: "paused" } }] },
        }),
      ),
    );
    await w.until(() => held(w, asset.asset_id).length === 64);
    const now = value(
      await w.complete(
        w.admin.call("sendTasks", {
          params,
          body: { tasks: [{ kind: "settings", settings: { run_state: "running" } }], now: true },
        }),
      ),
    );
    assert.deepEqual(now.task_ids, [66], "refusal assigns no Task ID");
    await w.until(() => w.events.some(e => e.kind === "report.status" && e.record.kind === "task" && e.record.task_id === 66 && e.record.task_state === "completed"));
    assert.deepEqual(held(w, asset.asset_id), []);
    assert.deepEqual(w.events.filter(e => e.kind === "report.status" && e.record.kind === "task" && e.record.task_state === "active").map(e => e.kind === "report.status" && e.record.kind === "task" ? e.record.task_id : undefined), [66]);
  },
});

scenario({
  name: "in-flight requests can overfill but the Asset holds at most 64",
  checks: ["core/docs/requests.md#scenario-paused-work-at-capacity"],
  async run(w) {
    const asset = await pausedAsset(w);
    const asset_id = asset.asset_id;
    const params = { asset_id };
    value(
      await w.complete(
        w.admin.call("sendTasks", {
          params,
          body: {
            tasks: Array.from({ length: 63 }, () => ({
              kind: "settings" as const, settings: { run_state: "paused" as const },
            })),
          },
        }),
      ),
    );
    await w.until(() => held(w, asset.asset_id).length === 63);
    w.network.once("asset", `/entities/assets/${asset_id}/reports`, {
      kind: "delay",
      ms: 1000,
    });
    const first = value(
      await w.complete(
        w.admin.call("sendTasks", {
          params,
          body: { tasks: [{ kind: "settings", settings: { run_state: "paused" } }] },
        }),
      ),
    );
    const second = value(
      await w.complete(
        w.admin.call("sendTasks", {
          params,
          body: { tasks: [{ kind: "settings", settings: { run_state: "paused" } }] },
        }),
      ),
    );
    assert.deepEqual(first.task_ids, [64]);
    assert.deepEqual(second.task_ids, [65]);
    await w.advance(1100);
    await w.until(() =>
      w.events.some(
        (e) =>
          e.kind === "report.status" &&
          e.record.kind === "task" &&
          e.record.task_id === 65 &&
          e.record.task_state === "cancelled",
      ),
    );
    assert.equal(held(w, asset.asset_id).length, 64);
    assert.ok(
      w.events.every(
        (e) =>
          e.kind !== "report.status" ||
          e.record.kind !== "queue" ||
          e.record.task_ids.length <= 64,
      ),
    );
  },
});
