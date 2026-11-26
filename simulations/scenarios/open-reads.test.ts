import assert from "node:assert/strict";
import { createLivePicture } from "@atlas/sdk";
import { assetApp } from "../src/asset-app.ts";
import { scenario } from "../src/scenario.ts";
import { radioAsset, plugin } from "../src/actors.ts";
import { value } from "../src/world.ts";
scenario({
  name: "an Asset and a gateway read another Asset, its Tasks, history, Objects, Plugin calls, and the picture",
  checks: ["core/docs/api.md#reads"],
  async run(w) {
    const reader = await assetApp(w, { name: "reader" });
    const other = await assetApp(w, { name: "other" });
    const radio = await radioAsset(w);
    const readerClient = reader.reader();
    value(await w.complete(readerClient.connect()));
    const asset_id = other.asset_id;
    const sent = value(
      await w.complete(
        w.admin.call("sendTasks", {
          params: { asset_id },
          body: { tasks: [{ kind: "hold" }] },
        }),
      ),
    );
    const changed = value(await w.complete(w.admin.call("changeSettings", {
      params: { asset_id }, body: { settings: { run_state: "paused" } },
    })));
    await w.until(() => w.events.some(e => e.kind === "report.settings" && e.record.request_id === changed.event_id));
    const bytes = new Uint8Array([65, 84, 76, 65, 83]);
    const object = value(
      await w.complete(
        w.admin.uploadObject(bytes, "application/octet-stream", {
          name: "evidence",
        }),
      ),
    );
    const p = await plugin(w, () => {});
    await w.until(() => w.events.some((e) => e.kind === "plugin.contact" && e.record.contact === "online"));
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

    for (const client of [readerClient, radio.client]) {
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
            e.record.settings.run_state === "paused",
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

scenario({
  name: "an Asset's live picture follows another Asset's Tasks",
  checks: ["core/docs/api.md#reads", "sdk/docs/live.md#live-picture"],
  async run(w) {
    const reader = await assetApp(w, { name: "reader" });
    const other = await assetApp(w, { name: "other" });
    const client = reader.reader();
    value(await w.complete(client.connect()));
    const picture = createLivePicture(client);
    w.onClose(() => picture.stop());
    await w.until(() => picture.tasks(other.asset_id).ready);
    const send = async (asset_id: string) =>
      value(
        await w.complete(
          w.admin.call("sendTasks", {
            params: { asset_id },
            body: { tasks: [{ kind: "hold" }] },
          }),
        ),
      ).task_ids[0];
    const unrelated = await send(other.asset_id);
    const own = await send(reader.asset_id);
    const ids = (asset_id: string) =>
      picture.tasks(asset_id).items.map((t) => t.task.task_id);
    // The reader's own Task arrives after the other's, so the stream has passed it.
    await w.until(() => ids(reader.asset_id).includes(own));
    assert.ok(
      ids(other.asset_id).includes(unrelated),
      "live picture shows another Asset's new Task",
    );
  },
});
