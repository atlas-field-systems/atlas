import assert from "node:assert/strict";
import { createLivePicture, follow } from "@atlas/sdk";
import { scenario } from "../src/scenario.ts";
import { ipAsset } from "../src/actors.ts";
import { value } from "../src/world.ts";

scenario({
  name: "filtered picture keeps shared places live",
  checks: ["sdk/docs/live.md#live-picture"],
  async run(w) {
    const a = await ipAsset(w);
    const picture = createLivePicture(w.admin, {
      asset_id: a.session.asset_id,
    });
    w.onClose(() => picture.stop());
    await w.until(() => picture.assets().ready);
    value(
      await w.complete(
        w.admin.call("createGeofeature", {
          body: {
            kind: "point",
            name: "Live",
            position: { latitude: 1, longitude: 2 },
          },
        }),
      ),
    );
    await w.settle();
    assert.equal(picture.geofeatures().items.length, 1);
  },
});
scenario({
  name: "Task picture keeps final states despite late reports",
  checks: [
    "core/docs/api.md#operator-requests",
    "core/docs/api.md#read-the-picture",
  ],
  async run(w) {
    const a = await ipAsset(w);
    const asset_id = a.session.asset_id;
    const picture = createLivePicture(w.admin);
    w.onClose(() => picture.stop());
    await w.until(() => picture.assets().ready);
    value(
      await w.complete(
        w.admin.call("sendTasks", {
          params: { asset_id },
          body: { tasks: [{ kind: "hold" }] },
        }),
      ),
    );
    await w.until(() => picture.tasks(asset_id).items.length === 1);
    for (const task_state of ["completed", "active"] as const)
      value(
        await w.complete(
          a.client.call("sendReports", {
            params: { asset_id },
            body: {
              reports: [
                {
                  type: "report.status",
                  time: w.clock.now(),
                  asset_id,
                  kind: "task",
                  task_id: 1,
                  task_state,
                },
              ],
            },
          }),
        ),
      );
    await w.settle();
    assert.equal(picture.tasks(asset_id).items[0].state, "completed");
  },
});
scenario({
  name: "stopped follow discards buffered events and same run connect preserves follow",
  checks: [
    "sdk/docs/live.md#follow-completion",
    "sdk/docs/client.md#run-changes-and-idle-contact",
  ],
  async run(w) {
    for (let i = 0; i < 5; i++)
      value(
        await w.complete(
          w.admin.call("createGeofeature", {
            body: {
              kind: "point",
              name: `Place ${i}`,
              position: { latitude: i, longitude: 2 },
            },
          }),
        ),
      );
    let calls = 0;
    const stream = follow(w.admin, { after: 0 }, () => {
      calls++;
      stream.stop();
    });
    assert.equal((await w.complete(stream.done)).reason, "stopped");
    assert.equal(calls, 1);
    const live = follow(w.admin, { after: 0 }, () => {});
    w.onClose(() => live.stop());
    await w.settle();
    value(await w.complete(w.admin.connect()));
    await w.advance(100);
    assert.equal(live.stale, false);
  },
});
scenario({
  name: "login confirms a session after two lost cookie responses",
  checks: ["core/docs/api.md#credential-retry-scenarios"],
  async run(w) {
    const c = w.client("double-login", { kind: "account" });
    value(await w.complete(c.connect()));
    w.network.once("double-login", "/administration/login", {
      kind: "loseResponse",
    });
    w.network.once("double-login", "/administration/login", { kind: "repeat" });
    w.network.once("double-login", "/administration/login", {
      kind: "loseResponse",
    });
    value(await w.complete(c.login("ADM", "simulation-password")));
    assert.equal(value(await w.complete(c.call("me"))).operator_id, "ADM");
  },
});
scenario({
  name: "contact heartbeat follows the last send deadline",
  checks: ["sdk/docs/client.md#run-changes-and-idle-contact"],
  async run(w) {
    const issued = value(await w.complete(w.admin.call("provisionGateway")));
    if (!("key" in issued)) throw new Error("Missing key");
    const c = w.client("heartbeat", { kind: "gateway", key: issued.key });
    value(await w.complete(c.connect()));
    const hold = c.holdContact();
    w.onClose(() => hold.stop());
    await w.advance(9000);
    value(await w.complete(c.connect()));
    const n = w.network.traffic.filter((t) => t.caller === "heartbeat").length;
    await w.advance(10000);
    assert.ok(
      w.network.traffic.filter((t) => t.caller === "heartbeat").length > n,
    );
  },
});
scenario({
  name: "outbox retries storage refusal with immutable reports and keeps emission order",
  checks: [
    "sdk/docs/asset.md#report-outbox",
    "core/docs/api.md#asset-and-gateway-calls",
  ],
  async run(w) {
    const a = await ipAsset(w);
    const asset_id = a.session.asset_id;
    const path = `/entities/assets/${asset_id}/reports`;
    w.network.once("asset", path, { kind: "refuse", status: 507 });
    a.session.outbox.add([
      {
        type: "report.settings",
        time: w.clock.now(),
        asset_id,
        settings: { lights: "off" },
      },
      {
        type: "report.settings",
        time: w.clock.now(),
        asset_id,
        settings: { lights: "on" },
        request_id: 1,
      },
    ]);
    await w.settle();
    await w.advance(1000);
    assert.equal(a.session.outbox.blocked, undefined);
    const attempts = w.network.traffic.filter(
      (t) => t.path === path && JSON.stringify(t.body).includes('"lights"'),
    );
    assert.ok(attempts.length >= 2);
    assert.equal(new Set(attempts.map((t) => t.key)).size, 1);
    assert.ok(
      attempts.every(
        (t) => JSON.stringify(t.body) === JSON.stringify(attempts[0].body),
      ),
    );
    assert.equal(attempts.at(-1)?.status, 200);
    assert.equal(
      value(await w.complete(w.admin.call("asset", { params: { asset_id } })))
        .item.settings.lights.value,
      "on",
    );
    await w.settle();
    for (const name of [
      "definitions.checked",
      "batch.sent",
      "batch.resent",
      "batch.acknowledged",
    ])
      assert.ok(
        w.diagnostics.some((e) => e.name === name),
        name,
      );
  },
});
