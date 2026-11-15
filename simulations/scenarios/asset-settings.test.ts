import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { startApp, parseConfig } from "@atlas/asset";
import { scenario } from "../src/scenario.ts";
import { value } from "../src/world.ts";

for (const change of [{ link_loss_after_s: 25 }, { run_state: "paused" as const }])
  scenario({
    name: `queued settings Task reports ${JSON.stringify(change)} to Core`,
    checks: ["asset/docs/logging.md#record-decisions-and-observed-equipment-behavior"],
    async run(w) {
      const key = value(await w.complete(w.admin.call("createAssetKey")));
      assert.ok("key" in key);
      const raw = JSON.parse(await readFile(new URL("../../asset/examples/copter.json", import.meta.url), "utf8"));
      const config = parseConfig({ ...raw, asset_key: key.key, link: { core_url: w.core.url },
        initial_settings: { ...raw.initial_settings, failsafe_policy: raw.initial_settings.failsafe_policy },
        equipment: { kind: "simulated", position: { latitude: 1, longitude: 2 } },
        log_directory: join(w.root, "logs"), archive_directory: join(w.root, "archives") });
      const clock = { now: () => w.clock.now(), after: (ms: number, fn: () => void) => w.clock.after(Math.ceil(ms), fn) };
      const app = await w.complete(startApp(config, { clock, fetch: w.network.fetchFor("app") }));
      try {
        await w.advance(1000);
        const sent = value(await w.complete(w.admin.call("sendTasks", { params: { asset_id: app.asset_id }, body: { tasks: [{ kind: "settings", settings: change }] } })));
        await w.until(() => w.events.some(e => e.kind === "report.status" && e.record.kind === "task" && e.record.task_id === sent.task_ids[0] && e.record.task_state === "completed"));
        await w.advance(15000);
        assert.equal(w.events.filter(e => e.kind === "report.settings" && Object.entries(change).every(([k, v]) => Reflect.get(e.record.settings, k) === v)).length, 1);
      } finally { await w.complete(app.stop()); }
    },
  });

scenario({
  name: "a rule activation reports its run state change exactly once",
  checks: ["asset/docs/logging.md#record-decisions-and-observed-equipment-behavior"],
  async run(w) {
    const key = value(await w.complete(w.admin.call("createAssetKey")));
    assert.ok("key" in key);
      const raw = JSON.parse(await readFile(new URL("../../asset/examples/copter.json", import.meta.url), "utf8"));
    const config = parseConfig({ ...raw, asset_key: key.key, link: { core_url: w.core.url },
      initial_settings: raw.initial_settings,
      equipment: { kind: "simulated", position: { latitude: 1, longitude: 2 } },
      log_directory: join(w.root, "logs"), archive_directory: join(w.root, "archives") });
    const clock = { now: () => w.clock.now(), after: (ms: number, fn: () => void) => w.clock.after(Math.ceil(ms), fn) };
    const app = await w.complete(startApp(config, { clock, fetch: w.network.fetchFor("app") }));
    try {
      const after = w.events.length;
      value(await w.complete(w.admin.call("changeSettings", { params: { asset_id: app.asset_id }, body: { settings: {
        run_state: "paused", failsafe_policy: [...raw.initial_settings.failsafe_policy, { rule_id: "IDLE", priority: 1, conditions: [{ kind: "idle", for_s: 1 }], response: { kind: "hold" } }],
      } } })));
      await w.advance(5000);
      assert.equal(w.events.slice(after).filter(e => e.kind === "report.settings" && e.record.settings.run_state === "running").length, 1);
    } finally { await w.complete(app.stop()); }
  },
});

scenario({
  name: "pre-registration overflow retains failsafe response evidence",
  checks: ["asset/docs/logging.md#when-logging-cannot-keep-up"],
  async run(w) {
    const key = value(await w.complete(w.admin.call("createAssetKey")));
    assert.ok("key" in key);
      const raw = JSON.parse(await readFile(new URL("../../asset/examples/copter.json", import.meta.url), "utf8"));
    const config = parseConfig({ ...raw, asset_key: key.key, link: { core_url: w.core.url }, log_queue_limit: 1,
      initial_settings: { ...raw.initial_settings, run_state: "paused", home_position: undefined, failsafe_policy: [...raw.initial_settings.failsafe_policy, { rule_id: "IDLE", priority: 1, conditions: [{ kind: "idle", for_s: 0 }], response: { kind: "hold" } }] },
      equipment: { kind: "simulated", position: { latitude: 1, longitude: 2 } },
      log_directory: join(w.root, "logs"), archive_directory: join(w.root, "archives") });
    w.network.cut("app");
    const attempting = Promise.withResolvers<void>();
    const net = w.network.fetchFor("app");
    const clock = { now: () => w.clock.now(), after: (ms: number, fn: () => void) => w.clock.after(Math.ceil(ms), fn) };
    const starting = startApp(config, { clock, fetch: (input, init) => { attempting.resolve(); return net(input, init); } });
    await w.complete(attempting.promise);
    await w.advance(20000);
    w.network.heal("app");
    const app = await w.complete(starting);
    try {
      await w.advance(1000);
      assert.ok(w.events.some(e => e.kind === "report.failsafe" && e.record.kind === "response" && e.record.task_state === "failed" && e.record.rule_id === "IDLE"));
    } finally { await w.complete(app.stop()); }
  },
});

for (const change of [{ link_loss_after_s: 25 }])
  scenario({
    name: `settings-only Asset executes queued settings Task and reports ${JSON.stringify(change)} to Core`,
    checks: ["asset/docs/logging.md#record-decisions-and-observed-equipment-behavior"],
    async run(w) {
      const key = value(await w.complete(w.admin.call("createAssetKey")));
      assert.ok("key" in key);
      const raw = JSON.parse(await readFile(new URL("../../asset/examples/copter.json", import.meta.url), "utf8"));
      const config = parseConfig({ ...raw, asset_key: key.key, link: { core_url: w.core.url },
        description: { commands: [], reports: ["settings", "status"], settings: ["link_loss_after_s"] },
        initial_settings: { link_loss_after_s: 12 },
        equipment: { kind: "simulated", position: { latitude: 1, longitude: 2 } },
        log_directory: join(w.root, "logs"), archive_directory: join(w.root, "archives") });
      const clock = { now: () => w.clock.now(), after: (ms: number, fn: () => void) => w.clock.after(Math.ceil(ms), fn) };
      const app = await w.complete(startApp(config, { clock, fetch: w.network.fetchFor("app") }));
      try {
        await w.advance(1000);
        const sent = value(await w.complete(w.admin.call("sendTasks", { params: { asset_id: app.asset_id }, body: { tasks: [{ kind: "settings", settings: change }] } })));
        await w.until(() => w.events.some(e => e.kind === "report.status" && e.record.kind === "task" && e.record.task_id === sent.task_ids[0] && e.record.task_state === "completed"));
        await w.advance(15000);
        assert.equal(w.events.filter(e => e.kind === "report.settings" && Object.entries(change).every(([k, v]) => Reflect.get(e.record.settings, k) === v)).length, 1);
      } finally { await w.complete(app.stop()); }
    },
  });
