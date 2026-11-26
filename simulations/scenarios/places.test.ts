import assert from "node:assert/strict";
import { scenario } from "../src/scenario.ts";
import { assetApp } from "../src/asset-app.ts";
import { value } from "../src/world.ts";
scenario({
  name: "place edits update only online unfinished Tasks when requested",
  checks: ["core/docs/api.md#geo-features"],
  async run(w) {
    async function paused(name: string) {
      const app = await assetApp(w, { name, equipment: "ardupilot" });
      const changed = value(await w.complete(w.admin.call("changeSettings", {
        params: { asset_id: app.asset_id }, body: { settings: { run_state: "paused" } },
      })));
      await w.until(() => w.events.some(e => e.kind === "report.settings" && e.record.request_id === changed.event_id));
      return app;
    }
    const online = await paused("online");
    const offline = await paused("offline");
    const place = value(
      await w.complete(
        w.admin.call("createGeofeature", {
          body: { kind: "point", position: { latitude: 1, longitude: 2 } },
        }),
      ),
    );
    const geofeature_id = place.geofeature.geofeature_id;
    for (const asset of [online, offline])
      value(
        await w.complete(
          w.admin.call("sendTasks", {
            params: { asset_id: asset.asset_id },
            body: { tasks: [{ kind: "move_to", geofeature_id }] },
          }),
        ),
      );
    for (const asset of [online, offline])
      await w.until(() => w.events.some(e => e.kind === "report.status" && e.record.asset_id === asset.asset_id && e.record.kind === "queue" && e.record.task_ids.includes(1)));
    const params = { geofeature_id };
    const body = {
      kind: "point" as const,
      position: { latitude: 3, longitude: 4 },
    };
    value(
      await w.complete(w.admin.call("replaceGeofeature", { params, body })),
    );
    for (const asset of [online, offline]) {
      const task = value(
        await w.complete(
          w.admin.call("tasks", {
            params: { asset_id: asset.asset_id },
          }),
        ),
      ).items[0].task;
      assert.ok(
        task.kind === "move_to" && task.destination?.latitude === 1,
        "edit alone keeps original copy",
      );
    }
    w.network.cut("offline");
    const attempted = value(await w.complete(w.admin.call("replaceGeofeature", {
      params, body, query: { update_tasks: true },
    })));
    assert.ok(attempted.updated_task_ids?.some(id => id.asset_id === offline.asset_id));
    for (let second = 0; second < 31; second++) await w.advance(1000);
    const dropped = value(await w.complete(w.admin.call("tasks", {
      params: { asset_id: offline.asset_id },
    }))).items[0];
    assert.equal(dropped.place_update, "dropped");
    assert.ok(dropped.task.kind === "move_to" && dropped.task.destination?.latitude === 1);
    const edit = value(
      await w.complete(
        w.admin.call("replaceGeofeature", {
          params,
          body,
          query: { update_tasks: true },
        }),
      ),
    );
    assert.deepEqual(edit.updated_task_ids, [
      { asset_id: online.asset_id, task_id: 1 },
    ]);
    assert.deepEqual(edit.not_updated_task_ids, [
      { asset_id: offline.asset_id, task_id: 1 },
    ]);
    await w.until(() => w.events.some(e => e.kind === "report.status" &&
      e.record.kind === "queue" && e.record.updated_task_ids?.includes(1)));
    value(await w.complete(w.admin.call("deleteGeofeature", { params })));
    const task = value(
      await w.complete(
        w.admin.call("tasks", {
          params: { asset_id: online.asset_id },
        }),
      ),
    ).items[0].task;
    assert.ok(
      task.kind === "move_to" && task.destination?.latitude === 3,
      "deleting place preserves updated Task copy",
    );
  },
});
