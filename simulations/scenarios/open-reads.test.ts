import assert from "node:assert/strict";
import { scenario } from "../src/scenario.ts";
import { ipAsset, radioAsset, plugin } from "../src/actors.ts";
import { value } from "../src/world.ts";
scenario({
  name: "an Asset and a gateway read another Asset, its Tasks, and the picture",
  checks: ["core/docs/api.md#reads"],
  async run(w) {
    const reader = await ipAsset(w, "reader");
    const other = await ipAsset(w, "other");
    const radio = await radioAsset(w);
    const asset_id = other.session.asset_id;
    const sent = value(
      await w.complete(
        w.admin.call("sendTasks", {
          params: { asset_id },
          body: { tasks: [{ kind: "hold" }] },
        }),
      ),
    );
    const report = {
      type: "report.settings" as const,
      time: w.clock.now(),
      asset_id,
      settings: { lights: "on" as const },
    };
    value(
      await w.complete(
        other.client.call("sendReports", {
          params: { asset_id },
          body: { reports: [report] },
        }),
      ),
    );
    const bytes = new Uint8Array([65, 84, 76, 65, 83]);
    const object = value(
      await w.complete(
        w.admin.uploadObject(bytes, "application/octet-stream", {
          name: "evidence",
        }),
      ),
    );
    const p = await plugin(w, () => {});
    await w.until(() => w.events.some((e) => e.kind === "plugin.described"));
    const call = value(
      await w.complete(
        w.admin.call("callPlugin", {
          params: { plugin_id: p.plugin_id, action: "scan" },
          body: { inputs: [] },
        }),
      ),
    );
    const place = value(
      await w.complete(
        w.admin.call("createGeofeature", {
          body: { kind: "point", position: { latitude: 1, longitude: 2 } },
        }),
      ),
    );

    for (const client of [reader.client, radio.client]) {
      assert.equal(
        value(await w.complete(client.call("asset", { params: { asset_id } })))
          .item.asset_id,
        asset_id,
      );
      assert.deepEqual(
        value(
          await w.complete(client.call("tasks", { params: { asset_id } })),
        ).items.map((t) => t.task.task_id),
        sent.task_ids,
      );
      const history = client.history({ asset_id })[Symbol.asyncIterator]();
      const page = await w.complete(history.next());
      assert.ok(!page.done);
      assert.ok(
        value(page.value).items.some(
          (e) =>
            e.kind === "report.settings" &&
            e.record.asset_id === asset_id &&
            e.record.settings.lights === "on",
        ),
      );
      const places = client.geofeatureHistory()[Symbol.asyncIterator]();
      const placePage = await w.complete(places.next());
      assert.ok(!placePage.done);
      assert.ok(
        value(placePage.value).items.some((e) => e.event_id === place.event_id),
      );
      const calls = client.pluginCalls(p.plugin_id)[Symbol.asyncIterator]();
      const callPage = await w.complete(calls.next());
      assert.ok(!callPage.done);
      assert.ok(
        value(callPage.value).items.some(
          (e) =>
            e.call.event_id === call.event_id &&
            e.call.record.action === "scan",
        ),
      );
      const file = value(await w.complete(client.objectFile(object.object_id)));
      assert.deepEqual(new Uint8Array(await file.arrayBuffer()), bytes);
      const picture = value(await w.complete(client.call("entities")));
      assert.ok(
        picture.assets.some(
          (a: { asset_id: string }) => a.asset_id === asset_id,
        ),
      );
    }
  },
});
