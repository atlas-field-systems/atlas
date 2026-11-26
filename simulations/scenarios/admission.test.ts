import assert from "node:assert/strict";
import { scenario } from "../src/scenario.ts";
import { sdkAssetCaller } from "../src/actors.ts";
import { value } from "../src/world.ts";

scenario({
  name: "one hundred Tasks run in order",
  checks: ["core/docs/requests.md#request-admission"],
  async run(w) {
    const asset = await sdkAssetCaller(w);
    const params = { asset_id: asset.session.asset_id };
    const tasks = Array.from({ length: 100 }, () => ({ kind: "hold" as const }));
    const accepted = value(await w.complete(w.admin.call("sendTasks", { params, body: { tasks } })));
    await w.until(() => asset.session.queue!.held().length === 100);
    for (const id of accepted.task_ids) {
      assert.equal(asset.next()?.task_id, id);
      asset.session.queue!.finish(id, "completed");
    }
    assert.deepEqual(asset.starts, Array.from({ length: 100 }, (_, i) => i + 1));
    await w.complete(asset.session.outbox.flush());
    const snapshot = value(await w.complete(w.admin.call("tasks", { params })));
    assert.equal(snapshot.items.filter(task => task.state === "completed").length, 100);
  },
});

scenario({
  name: "reports continue while the command stream is down",
  checks: ["core/docs/api.md#contact"],
  async run(w) {
    const asset = await sdkAssetCaller(w);
    const asset_id = asset.session.asset_id;
    await w.until(() => w.events.some(e => e.kind === "asset.contact" && e.record.command_stream_open));
    w.network.always("asset", "/events", { kind: "loseRequest" });
    w.network.dropStreams("asset");
    await w.until(() => w.events.filter(e => e.kind === "asset.contact").at(-1)?.record.command_stream_open === false);
    value(await w.complete(asset.client.call("sendReports", { params: { asset_id }, body: { reports: [] } })));
    const refused = await w.complete(w.admin.call("sendTasks", { params: { asset_id }, body: { tasks: [{ kind: "hold" }] } }));
    assert.ok(!refused.ok && refused.error === "asset_offline");
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
