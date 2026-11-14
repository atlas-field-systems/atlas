import assert from "node:assert/strict";
import { follow, type AtlasEvent } from "@atlas/sdk";
import type { ProtocolTypes as P } from "@atlas/protocol/types";
import { scenario } from "../src/scenario.ts";
import { ipAsset, plugin } from "../src/actors.ts";
import { value } from "../src/world.ts";

scenario({
  name: "lost responses change each domain once",
  checks: [
    "simulations/docs/core-and-sdk.md#scenarios",
    "core/docs/api.md#basics",
    "core/docs/api.md#plugins-answer",
  ],
  async run(w) {
    const events: AtlasEvent[] = [];
    const stream = follow(w.admin, { after: 0 }, (e) => {
      events.push(e);
    });
    const asset = await ipAsset(w);
    const asset_id = asset.session.asset_id;
    await w.settle();
    assert.ok(
      w.network.traffic.some(
        (t) =>
          t.caller === "asset" &&
          t.path === `/entities/assets/${asset_id}/reports`,
      ),
      "startup step 3 sends an empty report batch even when no state is known",
    );
    w.network.once("admin", `/tasks/${asset_id}`, { kind: "loseResponse" });
    const sent = value(
      await w.complete(
        w.admin.call("sendTasks", {
          params: { asset_id },
          body: { tasks: [{ kind: "hold" }] },
        }),
      ),
    );
    assert.deepEqual(
      sent.task_ids,
      [1],
      "one Task created despite lost acknowledgment",
    );
    w.network.once("admin", `/entities/assets/${asset_id}/settings`, {
      kind: "loseResponse",
    });
    const settings = value(
      await w.complete(
        w.admin.call("changeSettings", {
          params: { asset_id },
          body: { settings: { lights: "on" } },
        }),
      ),
    );
    w.network.once("admin", `/tasks/${asset_id}/1/cancel`, {
      kind: "loseResponse",
    });
    const cancel = value(
      await w.complete(
        w.admin.call("cancel", {
          params: { asset_id, task_id: 1 },
        }),
      ),
    );
    await w.settle();
    w.network.once("asset", `/entities/assets/${asset_id}/reports`, {
      kind: "loseResponse",
    });
    value(
      await w.complete(
        asset.client.call("sendReports", {
          params: { asset_id },
          body: {
            reports: [
              {
                type: "report.settings",
                time: w.clock.now(),
                asset_id,
                settings: { lights: "on" },
                request_id: settings.event_id,
              },
            ],
          },
        }),
      ),
    );
    w.network.once("admin", "/entities/geofeatures", { kind: "loseResponse" });
    const place = value(
      await w.complete(
        w.admin.call("createGeofeature", {
          body: {
            kind: "point",
            name: "Landing",
            position: { latitude: 1, longitude: 2 },
          },
        }),
      ),
    );
    const geofeature_id = place.geofeature.geofeature_id;
    w.network.once("admin", `/entities/geofeatures/${geofeature_id}`, {
      kind: "loseResponse",
    });
    const replaced = value(
      await w.complete(
        w.admin.call("replaceGeofeature", {
          params: { geofeature_id },
          body: {
            kind: "point",
            name: "New landing",
            position: { latitude: 3, longitude: 4 },
          },
        }),
      ),
    );
    w.network.once("admin", "/objects", { kind: "loseResponse" });
    const object = value(
      await w.complete(
        w.admin.uploadObject(
          new Uint8Array([1, 2, 3]),
          "application/octet-stream",
          { name: "capture", geofeature_id },
        ),
      ),
    );
    w.network.once("admin", `/objects/${object.object_id}`, {
      kind: "loseResponse",
    });
    const attached = value(
      await w.complete(
        w.admin.call("attachObject", {
          params: { object_id: object.object_id },
          body: { geofeature_id: null },
        }),
      ),
    );
    const calls: number[] = [];
    const p = await plugin(w, async (call, reply, id) => {
      w.network.once("plugin", `/plugins/${call.plugin_id}/answers`, {
        kind: "loseResponse",
      });
      value(
        await reply.answer({
          type: "plugin.result",
          time: w.clock.now(),
          plugin_id: call.plugin_id,
        }),
      );
      calls.push(id);
    });
    const called = value(
      await w.complete(
        w.admin.call("callPlugin", {
          params: { plugin_id: p.plugin_id, action: "scan" },
          body: { inputs: [] },
        }),
      ),
    );
    await w.until(() => calls.length === 1);
    w.network.once("admin", `/objects/${object.object_id}`, {
      kind: "loseResponse",
    });
    const deletedObject = value(
      await w.complete(
        w.admin.call("deleteObject", {
          params: { object_id: object.object_id },
        }),
      ),
    );
    w.network.once("admin", `/entities/geofeatures/${geofeature_id}`, {
      kind: "loseResponse",
    });
    const deletedPlace = value(
      await w.complete(
        w.admin.call("deleteGeofeature", { params: { geofeature_id } }),
      ),
    );
    await w.settle();
    for (const id of [
      sent.event_id,
      settings.event_id,
      cancel.event_id,
      place.event_id,
      replaced.event_id,
      object.event_id,
      attached.event_id,
      called.event_id,
      deletedObject.event_id,
      deletedPlace.event_id,
    ])
      assert.equal(
        events.filter((e) => e.event_id === id).length,
        1,
        "one accepted change, one event",
      );
    for (const kind of [
      "tasks.requested",
      "settings.requested",
      "cancel.requested",
      "geofeature.created",
      "geofeature.replaced",
      "object.stored",
      "object.changed",
      "plugin.result",
      "object.deleted",
      "geofeature.deleted",
    ])
      assert.equal(
        events.filter((e) => e.kind === kind).length,
        1,
        `${kind} happens once`,
      );
    assert.equal(
      events.filter(
        (e) =>
          e.kind === "report.settings" && e.record.settings.lights === "on",
      ).length,
      1,
      "same report batch is not stored twice",
    );
    const attempts = w.network.traffic.filter(
      (t) => t.path === "/entities/geofeatures" && t.method === "POST",
    );
    assert.equal(attempts.length, 2);
    assert.equal(attempts[0].key, attempts[1].key, "retry preserves key");
    const savedFetch = w.network.fetchFor("conflict-account");
    const changed = w.client(
      "conflict-replay",
      { kind: "account" },
      (input, init) => {
        const headers = new Headers(init?.headers);
        if (
          init?.method === "POST" &&
          String(input).endsWith("/entities/geofeatures")
        )
          headers.set("Idempotency-Key", "fixed-conflict");
        return savedFetch(input, { ...init, headers });
      },
    );
    value(await w.complete(changed.connect()));
    value(await w.complete(changed.login("ADM", "simulation-password")));
    value(
      await w.complete(
        changed.call("createGeofeature", {
          body: { kind: "point", position: { latitude: 0, longitude: 0 } },
        }),
      ),
    );
    const refused = await w.complete(
      changed.call("createGeofeature", {
        body: { kind: "point", position: { latitude: 1, longitude: 0 } },
      }),
    );
    assert.equal(refused.ok, false);
    if (!refused.ok) {
      assert.equal(refused.status, 409);
      assert.equal(refused.error, "idempotency_conflict");
    }
    p.session.stop();
    asset.session.stop();
    stream.stop();
  },
});

scenario({
  name: "retry waits through a failed run verification",
  checks: ["sdk/docs/client.md#retries-and-idempotency"],
  async run(w) {
    w.network.once("admin", "/entities/geofeatures", { kind: "loseResponse" });
    w.network.once("admin", "/about", { kind: "refuse", status: 503 });
    const result = await w.complete(
      w.admin.call("createGeofeature", {
        body: { kind: "point", position: { latitude: 1, longitude: 2 } },
      }),
    );
    assert.ok(
      result.ok,
      "a transient failure to verify the run must not end the immutable attempt",
    );
    await w.until(() => w.events.some((e) => e.kind === "geofeature.created"));
    assert.equal(
      w.events.filter((e) => e.kind === "geofeature.created").length,
      1,
    );
  },
});
