import { listedPlacesForOperator } from "@atlas/sdk";
import assert from "node:assert/strict";
import { scenario } from "../src/scenario.ts";
import { plugin } from "../src/actors.ts";
import { value } from "../src/world.ts";
scenario({
  name: "Plugin silence drops unanswered calls and rejects a second answer",
  checks: [
    "core/docs/api.md#a-plugin-goes-offline-or-is-removed",
    "core/docs/api.md#plugins-answer",
  ],
  async run(w) {
    const calls: number[] = [];
    const p = await plugin(w, (_call, _reply, id) => {
      calls.push(id);
    });
    await w.until(() => w.events.some((e) => e.kind === "plugin.described"));
    const params = { plugin_id: p.plugin_id, action: "scan" };
    const first = value(
      await w.complete(
        w.admin.call("callPlugin", { params, body: { inputs: [] } }),
      ),
    );
    await w.until(() => calls.length === 1);
    const body = {
      type: "plugin.result" as const,
      time: w.clock.now(),
      plugin_id: p.plugin_id,
      request_id: first.event_id,
      places: [{ kind: "point" as const, position: { latitude: 1, longitude: 2 } }],
    };
    const created = value(await w.complete(p.client.call("createGeofeature", {
      body: body.places[0], query: { request_id: first.event_id },
    })));
    const edited = value(await w.complete(w.admin.call("replaceGeofeature", {
      params: { geofeature_id: created.geofeature.geofeature_id },
      body: { ...body.places[0], name: "edited" },
    })));
    assert.equal(edited.geofeature.requested_by, p.plugin_id);
    assert.equal(edited.geofeature.request_id, first.event_id);
    value(await w.complete(p.client.call("answerPlugin", { params, body })));
    const answered = value(await w.complete(w.admin.call("pluginCall", {
      params: { plugin_id: p.plugin_id, event_id: first.event_id },
    })));
    assert.deepEqual(listedPlacesForOperator(answered, answered.call.record.requested_by), body.places);
    assert.deepEqual(listedPlacesForOperator(answered, "other"), []);
    const twice = await w.complete(
      p.client.call("answerPlugin", { params, body }),
    );
    assert.ok(!twice.ok && twice.status === 409);
    const second = value(
      await w.complete(
        w.admin.call("callPlugin", { params, body: { inputs: [] } }),
      ),
    );
    await w.until(() => calls.length === 2);
    p.session.stop();
    w.network.cut("plugin");
    await w.advance(31000);
    await w.until(() =>
      w.events.some(
        (e) =>
          e.kind === "plugin.dropped" &&
          e.record.request_id === second.event_id,
      ),
    );
    const entry = value(
      await w.complete(
        w.admin.call("pluginCall", {
          params: { plugin_id: p.plugin_id, event_id: second.event_id },
        }),
      ),
    );
    assert.equal(entry.answer!.kind, "plugin.dropped");
  },
});
