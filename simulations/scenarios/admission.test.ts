import assert from "node:assert/strict";
import { scenario } from "../src/scenario.ts";
import { assetApp } from "../src/asset-app.ts";
import { sdkAssetCaller } from "../src/actors.ts";
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
    "core/docs/requests.md#request-admission",
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
  checks: ["core/docs/requests.md#request-admission"],
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

// The real app refuses to start a flying configuration with no critical battery
// rule, so another program on IP, a contract caller, reports one.
scenario({
  name: "a flying Asset with no critical battery rule still takes Fail-safe",
  checks: ["core/docs/api.md#operator-requests", "asset/docs/failsafes.md#an-operator-can-fire-the-failsafe"],
  async run(w) {
    const asset = await sdkAssetCaller(w, "asset", w.clock, {
      entity_type: "drone",
      commands: ["takeoff", "hold", "failsafe"],
      reports: ["status", "settings"],
      settings: ["failsafe_policy"],
    }, { failsafe_policy: [] });
    const asset_id = asset.session.asset_id;
    await w.until(() => w.events.some(e => e.kind === "report.settings" && e.record.asset_id === asset_id));
    const ordinary = await w.complete(w.admin.call("sendTasks", { params: { asset_id }, body: { tasks: [{ kind: "hold" }] } }));
    assert.ok(!ordinary.ok && ordinary.error === "no_critical_battery_rule" && ordinary.status === 409);
    const fired = value(await w.complete(w.admin.call("sendTasks", { params: { asset_id }, body: { tasks: [{ kind: "failsafe" }], now: true } })));
    await w.until(() => asset.starts.includes(fired.task_ids[0]));
  },
});
