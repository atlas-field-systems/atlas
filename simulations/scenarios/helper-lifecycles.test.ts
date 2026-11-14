import assert from "node:assert/strict";
import { startAsset, startPlugin, type Reply, type Report } from "@atlas/sdk";
import { scenario } from "../src/scenario.ts";
import { description } from "../src/actors.ts";
import { value, type World } from "../src/world.ts";

function gate() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}
async function assetClient(w: World, name: string) {
  const key = value(await w.complete(w.admin.call("createAssetKey")));
  assert.ok("key" in key);
  return w.client(name, { kind: "asset", key: key.key });
}
scenario({
  name: "IP Asset close discards Tasks behind an asynchronous settings handler",
  checks: ["sdk/docs/asset.md#running-over-any-link"],
  async run(w) {
    const c = await assetClient(w, "gated-asset");
    const g = gate();
    let entered = false,
      tasks = 0;
    const s = value(
      await w.complete(
        startAsset(c, {
          clock: w.clock,
          description,
          settings: () => ({}),
          onSettings: async () => {
            entered = true;
            await g.promise;
          },
          queue: {
            runNow() {
              tasks++;
            },
            stop() {},
            update() {},
          },
        }),
      ),
    );
    w.onClose(() => {
      g.release();
      s.stop();
    });
    const params = { asset_id: s.asset_id };
    value(
      await w.complete(
        w.admin.call("changeSettings", {
          params,
          body: { settings: { lights: "on" } },
        }),
      ),
    );
    await w.until(() => entered);
    value(
      await w.complete(
        w.admin.call("sendTasks", {
          params,
          body: { tasks: [{ kind: "hold" }], now: true },
        }),
      ),
    );
    await w.settle();
    c.close();
    const reports = w.network.traffic.filter(
      (t) => t.caller === "gated-asset" && t.path.endsWith("/reports"),
    ).length;
    g.release();
    await w.settle();
    assert.equal(tasks, 0);
    assert.equal(
      w.network.traffic.filter(
        (t) => t.caller === "gated-asset" && t.path.endsWith("/reports"),
      ).length,
      reports,
    );
    assert.equal((await w.complete(s.done)).reason, "closed");
  },
});
scenario({
  name: "IP Asset propagates a settings consumer error and stops reporting",
  checks: ["sdk/docs/asset.md#running-over-any-link"],
  async run(w) {
    const c = await assetClient(w, "throwing-asset");
    const failure = new Error("settings failed");
    const s = value(
      await w.complete(
        startAsset(c, {
          clock: w.clock,
          description,
          settings: () => ({}),
          onSettings() {
            throw failure;
          },
        }),
      ),
    );
    w.onClose(() => s.stop());
    const outcome = s.done.then(
      () => undefined,
      (e) => e,
    );
    value(
      await w.complete(
        w.admin.call("changeSettings", {
          params: { asset_id: s.asset_id },
          body: { settings: { lights: "on" } },
        }),
      ),
    );
    assert.equal(await w.complete(outcome), failure);
    const count = w.network.traffic.filter(
      (t) => t.caller === "throwing-asset",
    ).length;
    await w.advance(35000);
    assert.equal(
      w.network.traffic.filter((t) => t.caller === "throwing-asset").length,
      count,
    );
  },
});
scenario({
  name: "Asset retries an unanswered initial about and registers once",
  checks: ["sdk/docs/asset.md#startup-on-ip"],
  async run(w) {
    const c = await assetClient(w, "initial-loss");
    w.network.once("initial-loss", "/about", { kind: "loseResponse" });
    const s = value(
      await w.complete(
        startAsset(c, { clock: w.clock, description, settings: () => ({}) }),
      ),
    );
    w.onClose(() => s.stop());
    assert.ok(
      w.network.traffic.filter(
        (t) => t.caller === "initial-loss" && t.path === "/about",
      ).length >= 2,
    );
    assert.equal(
      w.network.traffic.filter(
        (t) => t.caller === "initial-loss" && t.path === "/entities/assets",
      ).length,
      1,
    );
  },
});
for (const stage of ["connect", "description"] as const)
  scenario({
    name: `Plugin stop during ${stage} prevents stream contact and calls`,
    checks: ["sdk/docs/client.md#plugins"],
    async run(w) {
      const key = value(await w.complete(w.admin.call("provisionPlugin")));
      assert.ok("key" in key);
      const g = gate();
      let entered = false,
        handled = 0;
      const fetch = w.network.fetchFor("stopping-plugin");
      const c = w.client(
        "stopping-plugin",
        { kind: "plugin", key: key.key, plugin_id: key.plugin_id },
        async (input, init) => {
          const r = await fetch(input, init);
          if (
            new URL(String(input)).pathname ===
            (stage === "connect"
              ? "/about"
              : `/plugins/${key.plugin_id}/description`)
          ) {
            entered = true;
            await g.promise;
          }
          return r;
        },
      );
      const s = startPlugin(c, {
        description: {
          type: "plugin.description",
          time: w.clock.now(),
          plugin_id: key.plugin_id,
          name: "Survey",
          actions: [{ action: "scan", label: "Scan", inputs: [] }],
        },
        onCall() {
          handled++;
        },
      });
      w.onClose(() => {
        g.release();
        s.stop();
      });
      await w.until(() => entered);
      s.stop();
      g.release();
      await w.settle();
      let end: unknown;
      void s.done.then((v) => {
        end = v;
      });
      await w.settle();
      assert.deepEqual(end, { reason: "stopped" });
      await w.advance(35000);
      assert.equal(handled, 0);
      assert.equal(
        w.network.traffic.filter(
          (t) => t.caller === "stopping-plugin" && t.path === "/events",
        ).length,
        0,
      );
      assert.equal(
        w.network.traffic.filter(
          (t) => t.caller === "stopping-plugin" && t.path === "/about",
        ).length,
        1,
      );
    },
  });
scenario({
  name: "Plugin reply remains available after validation and Core refusal",
  checks: ["core/docs/api.md#plugins-answer", "sdk/docs/client.md#plugins"],
  async run(w) {
    let reply: Reply | undefined;
    const issued = value(await w.complete(w.admin.call("provisionPlugin")));
    assert.ok("key" in issued);
    let loseAnswers = false;
    const network = w.network.fetchFor("plugin");
    const client = w.client(
      "plugin",
      { kind: "plugin", key: issued.key, plugin_id: issued.plugin_id },
      async (input, init) => {
        const response = await network(input, init);
        if (loseAnswers && new URL(String(input)).pathname.endsWith("/answers"))
          throw new TypeError("Answer response lost");
        return response;
      },
    );
    const session = startPlugin(client, {
      description: {
        type: "plugin.description",
        time: w.clock.now(),
        plugin_id: issued.plugin_id,
        name: "Survey",
        actions: [{ action: "scan", label: "Scan", inputs: [] }],
      },
      onCall(_call, r) {
        reply = r;
      },
    });
    w.onClose(() => session.stop());
    const p = { client, session, plugin_id: issued.plugin_id };
    await w.until(() => w.events.some((e) => e.kind === "plugin.described"));
    const call = value(
      await w.complete(
        w.admin.call("callPlugin", {
          params: { plugin_id: p.plugin_id, action: "scan" },
          body: { inputs: [] },
        }),
      ),
    );
    await w.until(() => !!reply);
    const body = {
      type: "plugin.result" as const,
      time: w.clock.now(),
      plugin_id: p.plugin_id,
    };
    await assert.rejects(async () => reply!.answer({ ...body, time: -1 }));
    const refused = await w.complete(
      reply!.answer({ ...body, geofeature_ids: ["G404"] }),
    );
    assert.ok(!refused.ok && refused.status === 400);
    const entry = value(
      await w.complete(
        w.admin.call("pluginCall", {
          params: { plugin_id: p.plugin_id, event_id: call.event_id },
        }),
      ),
    );
    assert.equal(entry.answer, null);
    loseAnswers = true;
    const unknown = await w.complete(
      reply!.answer({
        ...body,
        type: "plugin.failure",
        explanation: "Unable to scan",
      }),
    );
    assert.ok(!unknown.ok && unknown.error === "unknown" && unknown.retry);
    await assert.rejects(() => reply!.answer(body), /only one answer/);
    loseAnswers = false;
    value(await w.complete(unknown.retry()));
    await assert.rejects(() => reply!.answer(body), /only one answer/);
    const attempts = w.network.traffic.filter(
      (t) =>
        t.caller === "plugin" &&
        t.path.endsWith("/answers") &&
        JSON.stringify(t.body).includes("plugin.failure"),
    );
    assert.equal(new Set(attempts.map((t) => t.key)).size, 1);
  },
});
scenario({
  name: "Asset reconnect sends current settings before retained history and reopens without draining it",
  checks: ["core/docs/api.md#asset-and-gateway-calls"],
  async run(w) {
    const key = value(await w.complete(w.admin.call("createAssetKey")));
    assert.ok("key" in key);
    const first = gate(),
      history = gate();
    let gated = false,
      sending = false;
    const fetch = w.network.fetchFor("rejoining");
    const c = w.client(
      "rejoining",
      { kind: "asset", key: key.key },
      async (input, init) => {
        const path = new URL(String(input)).pathname;
        const result = await fetch(input, init);
        if (gated && path.endsWith("/reports")) {
          const body = JSON.parse(String(init?.body));
          if (body.reports.some((r: Report) => r.time === 1))
            await history.promise;
          else if (!sending) {
            sending = true;
            await first.promise;
          }
        }
        return result;
      },
    );
    let lights: "on" | "off" = "on";
    const s = value(
      await w.complete(
        startAsset(c, {
          clock: w.clock,
          description,
          settings: () => ({ lights }),
          queue: { runNow() {}, stop() {}, update() {} },
        }),
      ),
    );
    w.onClose(() => {
      first.release();
      history.release();
      s.stop();
    });
    await w.until(() =>
      w.network.traffic.some(
        (t) => t.caller === "rejoining" && t.path === "/events",
      ),
    );
    const report = (time: number): Report => ({
      type: "report.settings",
      time,
      asset_id: s.asset_id,
      settings: { lights: "on" },
    });
    gated = true;
    s.outbox.add([report(2)]);
    await w.until(() => sending);
    s.outbox.add(
      Array.from({ length: 1001 }, () => report(1)),
      "retained",
    );
    lights = "off";
    w.network.dropStreams("rejoining");
    await w.settle();
    await w.advance(10);
    first.release();
    await w.settle();
    const reports = w.network.traffic.filter(
      (t) => t.caller === "rejoining" && t.path.endsWith("/reports"),
    );
    assert.ok(
      JSON.stringify(reports[2].body).includes('"lights":"off"'),
      "current state follows only the in-flight batch",
    );
    value(
      await w.complete(
        w.admin.call("sendTasks", {
          params: { asset_id: s.asset_id },
          body: { tasks: [{ kind: "hold" }] },
        }),
      ),
    );
    await w.settle();
    assert.equal(
      s.queue!.held().length,
      1,
      "Tasks arrive while retained history is pending",
    );
    history.release();
    await w.complete(s.outbox.flush());
  },
});
