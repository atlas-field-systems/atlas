import assert from "node:assert/strict";
import { createClient } from "@atlas/sdk";
import { assetApp } from "../src/asset-app.ts";
import { scenario } from "../src/scenario.ts";
import { radioAsset } from "../src/actors.ts";
import { value, type World } from "../src/world.ts";

const checks = ["sdk/docs/client.md#retries-and-idempotency"];
async function account(w: World, name: string) {
  const c = w.client(name, { kind: "account" });
  value(await w.complete(c.connect()));
  value(await w.complete(c.login("ADM", "simulation-password")));
  return c;
}
function gate() {
  let release!: () => void;
  const promise = new Promise<void>((r) => {
    release = r;
  });
  return { promise, release };
}
scenario({
  name: "lost login for another account confirms the requested identity",
  checks,
  async run(w) {
    value(
      await w.complete(
        w.admin.call("addAccount", {
          body: {
            operator_id: "OP",
            password: "second-password",
            admin: false,
          },
        }),
      ),
    );
    const c = await account(w, "identity");
    w.network.once("identity", "/administration/login", {
      kind: "loseResponse",
    });
    value(await w.complete(c.login("OP", "second-password")));
    assert.equal(value(await w.complete(c.call("me"))).operator_id, "OP");
  },
});
scenario({
  name: "outstanding Task retry cannot cross a session change",
  checks,
  async run(w) {
    const a = await assetApp(w);
    const c = await account(w, "session");
    value(
      await w.complete(
        w.admin.call("addAccount", {
          body: {
            operator_id: "OP",
            password: "second-password",
            admin: false,
          },
        }),
      ),
    );
    const path = `/tasks/${a.asset_id}`;
    w.network.once("session", path, { kind: "loseResponse" });
    const pending = c.call("sendTasks", {
      params: { asset_id: a.asset_id },
      body: { tasks: [{ kind: "hold" }] },
    });
    await w.until(() =>
      w.network.traffic.some(
        (t) => t.caller === "session" && t.path === path && t.status === 202,
      ),
    );
    w.network.cut("session");
    const result = await w.complete(pending);
    assert.ok(!result.ok && result.retry);
    w.network.heal("session");
    value(await w.complete(c.call("logout")));
    value(await w.complete(c.login("OP", "second-password")));
    const boundary = w.network.traffic.length;
    const retried = await w.complete(result.retry());
    assert.ok(
      !retried.ok && retried.error === "session_changed",
      JSON.stringify(retried),
    );
    assert.equal(
      w.network.traffic
        .slice(boundary)
        .filter((t) => t.path === path || t.path.includes("/tasks")).length,
      0,
    );
    assert.equal(
      value(
        await w.complete(
          c.call("tasks", { params: { asset_id: a.asset_id } }),
        ),
      ).items.length,
      1,
    );
  },
});
scenario({
  name: "late old-session 401 leaves a new login connected",
  checks: ["sdk/docs/client.md#credentials"],
  async run(w) {
    const hold = gate();
    w.onClose(hold.release);
    const fetch = w.network.fetchFor("late-auth");
    let delay = false,
      entered = false;
    const c = w.client(
      "late-auth",
      { kind: "account" },
      async (input, init) => {
        const r = await fetch(input, init);
        if (delay && new URL(String(input)).pathname === "/administration/me") {
          delay = false;
          entered = true;
          await hold.promise;
        }
        return r;
      },
    );
    value(await w.complete(c.connect()));
    delay = true;
    const pending = c.call("me");
    await w.until(() => entered);
    value(await w.complete(c.login("ADM", "simulation-password")));
    hold.release();
    await w.complete(pending);
    assert.equal(c.status.phase, "connected");
    value(await w.complete(c.call("me")));
  },
});
scenario({
  name: "verification cannot release an old mutation into a newly connected run",
  checks: ["sdk/docs/client.md#reset-and-idle-contact"],
  async run(w) {
    const hold = gate();
    w.onClose(hold.release);
    const fetch = w.network.fetchFor("run-fence");
    let delay = false,
      entered = false;
    const c = w.client(
      "run-fence",
      { kind: "account" },
      async (input, init) => {
        const r = await fetch(input, init);
        if (delay && new URL(String(input)).pathname === "/about") {
          delay = false;
          entered = true;
          await hold.promise;
        }
        return r;
      },
    );
    value(await w.complete(c.connect()));
    value(await w.complete(c.login("ADM", "simulation-password")));
    w.network.cut("run-fence");
    const unknown = await w.complete(
      c.call("createGeofeature", {
        body: { kind: "point", position: { latitude: 1, longitude: 2 } },
      }),
    );
    assert.ok(!unknown.ok && unknown.retry);
    await w.restartCore();
    w.network.heal("run-fence");
    delay = true;
    const pending = unknown.retry();
    await w.until(() => entered);
    value(await w.complete(c.connect()));
    value(await w.complete(c.login("ADM", "simulation-password")));
    const boundary = w.network.traffic.length;
    hold.release();
    const result = await w.complete(pending);
    assert.ok(
      !result.ok && result.error === "run_ended",
      JSON.stringify(result),
    );
    assert.equal(
      w.network.traffic
        .slice(boundary)
        .filter(
          (t) => t.caller === "run-fence" && t.path === "/entities/geofeatures",
        ).length,
      0,
    );
    assert.equal(
      value(await w.complete(c.call("geofeatures"))).items.length,
      0,
    );
  },
});
for (const verification of [false, true])
  scenario({
    name: `retry deadline bounds ${verification ? "verification" : "backoff"} and sends`,
    checks,
    async run(w) {
      const c = createClient({
        protocol: w.protocol,
        credential: { kind: "account" },
        clock: w.clock,
        fetch: w.network.fetchFor("budget"),
        baseUrl: w.core.url,
        requestTimeoutMs: 100,
        backoff: {
          minMs: verification ? 40 : 100,
          maxMs: 100,
          factor: 2,
          jitter: 0,
        },
      });
      w.onClose(() => c.close());
      value(await w.complete(c.connect()));
      value(await w.complete(c.login("ADM", "simulation-password")));
      w.network.once("budget", "/entities/geofeatures", {
        kind: "loseRequest",
      });
      if (verification)
        w.network.once("budget", "/about", { kind: "delay", ms: 90 });
      const start = w.clock.now();
      const result = await w.complete(
        c.call("createGeofeature", {
          body: { kind: "point", position: { latitude: 1, longitude: 2 } },
        }),
      );
      assert.ok(
        !result.ok && result.error === "unknown" && result.retry,
        JSON.stringify(result),
      );
      assert.equal(w.clock.now() - start, 100);
      assert.equal(
        w.network.traffic.filter(
          (t) => t.caller === "budget" && t.path === "/entities/geofeatures",
        ).length,
        1,
      );
    },
  });
for (const mutate of ["bytes", "query"] as const)
  scenario({
    name: `Object retries snapshot caller-owned ${mutate}`,
    checks,
    async run(w) {
      const c = await account(w, "snapshot");
      const bytes = Buffer.from("original");
      const query = { name: "original.txt" };
      w.network.once("snapshot", "/objects", { kind: "loseResponse" });
      const pending = c.uploadObject(bytes, "text/plain", query);
      await w.until(() =>
        w.network.traffic.some(
          (t) =>
            t.caller === "snapshot" &&
            t.path === "/objects" &&
            t.status === 201,
        ),
      );
      if (mutate === "bytes") bytes.fill(120);
      else query.name = "changed.txt";
      const stored = value(await w.complete(pending));
      assert.equal(
        await value(await w.complete(c.objectFile(stored.object_id))).text(),
        "original",
      );
    },
  });
scenario({
  name: "close is terminal while connect awaits its response",
  checks: ["sdk/docs/client.md#results-and-errors"],
  async run(w) {
    const hold = gate();
    w.onClose(hold.release);
    const fetch = w.network.fetchFor("closing");
    let entered = false;
    const c = w.client("closing", { kind: "account" }, async (input, init) => {
      const r = await fetch(input, init);
      entered = true;
      await hold.promise;
      return r;
    });
    const pending = c.connect();
    await w.until(() => entered);
    c.close();
    hold.release();
    await w.complete(pending);
    assert.equal(c.status.phase, "closed");
    const boundary = w.network.traffic.length;
    assert.throws(() => c.call("me"));
    assert.equal(w.network.traffic.length, boundary);
  },
});
scenario({
  name: "radio definitions refusal leaves gateway and existing radio usable",
  checks: [
    "sdk/docs/client.md#definitions-check",
    "core/docs/api.md#radio-assets",
  ],
  async run(w) {
    const radio = await radioAsset(w);
    const rejected = await w.complete(
      radio.client.call("registerRadio", {
        body: { definitions_hash: "0".repeat(64) },
      }),
    );
    assert.ok(!rejected.ok && rejected.error === "definitions_mismatch");
    assert.equal(radio.client.status.phase, "connected");
    value(
      await w.complete(
        radio.client.call("registerRadio", {
          body: { definitions_hash: w.protocol.hash },
        }),
      ),
    );
    value(
      await w.complete(
        radio.client.call("putContact", {
          params: { asset_id: radio.asset_id },
          body: {
            time: w.clock.now(),
            asset_id: radio.asset_id,
            contact: "online",
          },
        }),
      ),
    );
    value(
      await w.complete(
        radio.client.call("sendReports", {
          params: { asset_id: radio.asset_id },
          body: {
            reports: [
              {
                type: "report.settings",
                asset_id: radio.asset_id,
                time: w.clock.now(),
                settings: { lights: "on" },
              },
            ],
          },
        }),
      ),
    );
  },
});
