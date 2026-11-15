import assert from "node:assert/strict";
import { createClient, createLivePicture, follow } from "@atlas/sdk";
import { scenario } from "../src/scenario.ts";
import { assetApp } from "../src/asset-app.ts";
import { reportingPeripheral } from "../src/peripheral.ts";
import { ipAsset, radioAsset, plugin } from "../src/actors.ts";
import { value } from "../src/world.ts";

scenario({
  name: "filtered picture keeps shared places live",
  checks: ["sdk/docs/live.md#live-picture"],
  async run(w) {
    const a = await assetApp(w);
    const picture = createLivePicture(w.admin, {
      asset_id: a.asset_id,
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
  // Raw Core contract: an active report after final completion is contradictory traffic the app never emits.
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
    await w.until(() => a.session.queue!.held().length === 1);
    await w.complete(a.session.outbox.flush());
    await w.settle();
    assert.equal(picture.tasks(asset_id).items[0].state, "queued");
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
    const { app: a } = await reportingPeripheral(w, { config: {
      description: { commands: [], reports: ["status", "settings"], settings: ["run_state"] },
      initial_settings: { run_state: "running" },
    } });
    const asset_id = a.asset_id;
    const path = `/entities/assets/${asset_id}/reports`;
    await w.until(() => w.network.traffic.some(t => t.caller === "asset" && t.path === "/events"));
    w.network.once("asset", path, { kind: "refuse", status: 507 });
    value(await w.complete(w.admin.call("sendTasks", {
      params: { asset_id },
      body: { tasks: [{ kind: "settings", settings: { run_state: "paused" } }] },
    })));
    await w.settle();
    await w.advance(1000);
    const attempts = w.network.traffic.filter(
      (t) => t.path === path && t.key === w.network.traffic.find(t => t.path === path && t.status === 507)?.key,
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
        .item.settings.run_state.value,
      "paused",
    );
    const finals = w.events.filter(e => e.kind === "report.status" && e.record.kind === "task");
    assert.deepEqual(finals.map(e => e.kind === "report.status" && e.record.kind === "task" ? e.record.task_state : undefined), ["active", "completed"]);
  },
});
scenario({
  // SDK picture contract: the app has no gimbal acquisition input; radio waits for gateway and Fieldlink.
  name: "gimbal snapshot resists older reports and radio registration keeps gateway",
  checks: ["core/docs/api.md#reads", "sdk/docs/live.md#live-picture"],
  async run(w) {
    const a = await ipAsset(w, "asset", w.clock, {
      entity_type: "ground_vehicle",
      commands: [],
      reports: ["gimbal"],
      cameras: [
        {
          camera_id: "C1",
          mount: "gimbal",
          yaw_deg: 0,
          pitch_deg: -45,
          horizontal_fov_deg: 80,
          vertical_fov_deg: 60,
        },
      ],
    });
    const asset_id = a.session.asset_id;
    const report = (time: number, yaw_deg: number) => ({
      type: "report.gimbal" as const,
      time,
      asset_id,
      camera_id: "C1",
      yaw_deg,
      pitch_deg: -20,
    });
    const send = async (time: number, yaw: number) =>
      value(
        await w.complete(
          a.client.call("sendReports", {
            params: { asset_id },
            body: { reports: [report(time, yaw)] },
          }),
        ),
      );
    await send(w.clock.now(), 10);
    const picture = createLivePicture(w.admin);
    w.onClose(() => picture.stop());
    await w.until(() => picture.assets().ready);
    await send(w.clock.now() - 1, 0);
    await w.settle();
    assert.equal(
      picture.assets().items.find((a) => a.asset_id === asset_id)?.gimbals.C1
        .yaw_deg,
      10,
    );
    await send(w.clock.now(), 90);
    await w.settle();
    assert.equal(
      picture.assets().items.find((a) => a.asset_id === asset_id)?.reports[
        "report.gimbal"
      ],
      undefined,
    );
    const radio = await radioAsset(w);
    await w.settle();
    const expected = value(
      await w.complete(
        w.admin.call("asset", { params: { asset_id: radio.asset_id } }),
      ),
    ).item;
    assert.equal(
      picture.assets().items.find((a) => a.asset_id === radio.asset_id)
        ?.gateway_id,
      expected.gateway_id,
    );
  },
});
scenario({
  name: "Plugin calls run concurrently and slow stream handlers do not cause idle reconnects",
  checks: ["core/docs/api.md#plugins-answer", "sdk/docs/live.md#reconnecting"],
  async run(w) {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let calls = 0;
    const p = await plugin(w, async () => {
      calls++;
      await gate;
    });
    for (let i = 0; i < 2; i++)
      value(
        await w.complete(
          w.admin.call("callPlugin", {
            params: { plugin_id: p.plugin_id, action: "scan" },
            body: { inputs: [] },
          }),
        ),
      );
    await w.settle();
    assert.equal(calls, 2);
    const c = w.client("slow-reader", { kind: "account" });
    value(await w.complete(c.connect()));
    value(await w.complete(c.login("ADM", "simulation-password")));
    const stream = follow(c, { after: 0 }, () => gate);
    w.onClose(() => {
      release();
      stream.stop();
    });
    await w.settle();
    await w.advance(35000);
    assert.equal(
      w.diagnostics.filter((e) => e.name === "stream.idle").length,
      0,
    );
    release();
    await w.settle();
  },
});
scenario({
  // SDK helper contract: ignored duplicate events and explicit queue clear are exercised by a caller.
  name: "diagnostics record validation authentication queue and retry decisions",
  checks: ["sdk/docs/logging.md#what-it-reports"],
  async run(w) {
    assert.throws(() =>
      w.admin.call("createGeofeature", {
        body: { kind: "point", position: { latitude: 1000, longitude: 0 } },
      }),
    );
    const c = w.client("unauthorized", { kind: "account" });
    value(await w.complete(c.connect()));
    await w.complete(c.call("me"));
    w.network.once("admin", "/entities", { kind: "refuse", status: 503 });
    value(await w.complete(w.admin.call("entities")));
    const a = await ipAsset(w);
    const asset_id = a.session.asset_id;
    const sent = value(
      await w.complete(
        w.admin.call("sendTasks", {
          params: { asset_id },
          body: { tasks: [{ kind: "hold" }, { kind: "hold" }] },
        }),
      ),
    );
    await w.until(() => a.session.queue!.held().length === 2);
    a.session.queue!.apply({
      kind: "tasks.requested",
      event_id: sent.event_id,
      record: [],
    });
    a.session.queue!.next();
    a.session.queue!.finish(1, "completed");
    a.session.queue!.clear();
    await w.complete(a.session.outbox.flush());
    await w.settle();
    for (const name of [
      "validation.failed",
      "authentication.401",
      "request.retry_status",
      "queue.applied",
      "queue.ignored",
      "task.handed",
      "task.finished",
      "task.cancelled",
      "queue.cleared",
    ])
      assert.ok(
        w.diagnostics.some((e) => e.name === name),
        name,
      );
    const invalid = w.diagnostics.find((e) => e.name === "validation.failed")!;
    assert.ok(String(invalid.detail.problems).includes("position"));
    assert.equal(
      w.diagnostics.find((e) => e.name === "request.retry_status")?.detail
        .status,
      503,
    );
    const mismatch = createClient({
      baseUrl: w.core.url,
      protocol: { ...w.protocol, hash: "sha256:other" },
      credential: { kind: "account" },
      clock: w.clock,
      fetch: w.network.fetchFor("mismatch"),
      observer: (event) => {
        w.diagnostics.push(event);
      },
    });
    w.onClose(() => mismatch.close());
    await w.complete(mismatch.connect());
    await w.settle();
    assert.deepEqual(
      w.diagnostics.find((e) => e.name === "definitions.mismatch")?.detail,
      { ours: "sha256:other", core: w.protocol.hash },
    );
    const bytes = JSON.stringify(w.diagnostics);
    for (const secret of w.network.secrets) assert.ok(!bytes.includes(secret));
  },
});
scenario({
  // SDK helper contract: synchronous queue transitions in a single millisecond are explicitly controlled.
  name: "same millisecond queue reports keep emitted order inside a batch",
  checks: ["core/docs/api.md#reads", "sdk/docs/asset.md#report-outbox"],
  async run(w) {
    const a = await ipAsset(w);
    const asset_id = a.session.asset_id;
    const path = `/entities/assets/${asset_id}/reports`;
    value(
      await w.complete(
        w.admin.call("sendTasks", {
          params: { asset_id },
          body: { tasks: [{ kind: "hold" }, { kind: "hold" }] },
        }),
      ),
    );
    await w.until(() => a.session.queue!.held().length === 2);
    await w.complete(a.session.outbox.flush());
    w.network.once("asset", path, { kind: "delay", ms: 100 });
    a.session.outbox.add([
      {
        type: "report.settings",
        time: w.clock.now(),
        asset_id,
        settings: { lights: "on" },
      },
    ]);
    const now = w.clock.now();
    a.session.queue!.next();
    a.session.queue!.finish(1, "completed");
    value(
      await w.complete(
        w.admin.call("sendTasks", {
          params: { asset_id },
          body: { tasks: [{ kind: "hold" }] },
        }),
      ),
    );
    await w.settle();
    assert.equal(w.clock.now(), now);
    await w.complete(a.session.outbox.flush());
    const read = value(
      await w.complete(w.admin.call("tasks", { params: { asset_id } })),
    );
    assert.deepEqual(a.session.queue!.held(), [2, 3]);
    assert.deepEqual(read.held, [2, 3]);
  },
});
scenario({
  name: "dropped Task picture preserves drop after late final evidence",
  checks: [
    "core/docs/api.md#operator-requests",
    "sdk/docs/live.md#live-picture",
  ],
  async run(w) {
    const { app: a } = await reportingPeripheral(w, { config: {
      description: { commands: [], reports: ["status", "settings"], settings: ["run_state"] },
      initial_settings: { run_state: "running" },
    } });
    const asset_id = a.asset_id;
    const picture = createLivePicture(w.admin);
    w.onClose(() => picture.stop());
    await w.until(() => picture.assets().ready);
    const path = `/entities/assets/${asset_id}/reports`;
    // The request reaches the app, but its answer and final evidence cannot reach Core.
    w.network.once("asset", path, { kind: "delay", ms: 60000 });
    value(await w.complete(w.admin.call("sendTasks", {
      params: { asset_id },
      body: { tasks: [{ kind: "settings", settings: { run_state: "running" } }] },
    })));
    await w.until(() => w.network.traffic.some(t => t.path === path && t.fault?.kind === "delay"));
    w.network.cut("asset");
    await w.advance(31000);
    assert.equal(picture.tasks(asset_id).items[0].state, "dropped");
    w.network.heal("asset");
    await w.until(() => w.events.some(e => e.kind === "report.status" && e.record.kind === "task" && e.record.task_state === "completed"));
    await w.settle();
    assert.equal(picture.tasks(asset_id).items[0].state, "dropped");
  },
});
scenario({
  name: "same run connect preserves stream epoch",
  checks: ["sdk/docs/client.md#run-changes-and-idle-contact"],
  async run(w) {
    const stream = follow(w.admin, { after: 0 }, () => {});
    w.onClose(() => stream.stop());
    await w.settle();
    value(await w.complete(w.admin.connect()));
    await w.advance(100);
    assert.equal(stream.stale, false);
  },
});
scenario({
  name: "a delayed transport ends at the SDK timeout",
  checks: ["sdk/docs/client.md#retries-and-idempotency"],
  async run(w) {
    w.network.once("admin", "/entities/geofeatures", {
      kind: "delay",
      ms: 60000,
    });
    const before = w.clock.now();
    const result = await w.complete(w.admin.call("geofeatures"));
    assert.ok(!result.ok && result.error === "unknown");
    assert.equal(w.clock.now() - before, 10000);
  },
});
