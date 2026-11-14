import assert from "node:assert/strict";
import { scenario } from "../src/scenario.ts";
import { ipAsset, description } from "../src/actors.ts";
import { value } from "../src/world.ts";
scenario({
  name: "place edits update only online unfinished Tasks when requested",
  checks: ["core/docs/api.md#geo-features"],
  async run(w) {
    const online = await ipAsset(w, "online");
    const offline = await ipAsset(w, "offline");
    for (const asset of [online, offline]) {
      asset.session.stop();
      value(
        await w.complete(
          asset.client.call("register", {
            body: { ...description, commands: ["move_to"] },
          }),
        ),
      );
    }
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
            params: { asset_id: asset.session.asset_id },
            body: { tasks: [{ kind: "move_to", geofeature_id }] },
          }),
        ),
      );
    // Explicit queue evidence means silence does not drop work already held.
    for (const asset of [online, offline])
      value(
        await w.complete(
          asset.client.call("sendReports", {
            params: { asset_id: asset.session.asset_id },
            body: {
              reports: [
                {
                  type: "report.status",
                  time: w.clock.now(),
                  asset_id: asset.session.asset_id,
                  kind: "queue",
                  task_ids: [1],
                },
              ],
            },
          }),
        ),
      );
    await w.advance(31000);
    value(
      await w.complete(
        online.client.call("sendReports", {
          params: { asset_id: online.session.asset_id },
          body: { reports: [] },
        }),
      ),
    );
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
            params: { asset_id: asset.session.asset_id },
          }),
        ),
      ).items[0].task;
      assert.ok(
        task.kind === "move_to" && task.destination?.latitude === 1,
        "edit alone keeps original copy",
      );
    }
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
      { asset_id: online.session.asset_id, task_id: 1 },
    ]);
    assert.deepEqual(edit.not_updated_task_ids, [
      { asset_id: offline.session.asset_id, task_id: 1 },
    ]);
    value(await w.complete(w.admin.call("deleteGeofeature", { params })));
    const task = value(
      await w.complete(
        w.admin.call("tasks", {
          params: { asset_id: online.session.asset_id },
        }),
      ),
    ).items[0].task;
    assert.ok(
      task.kind === "move_to" && task.destination?.latitude === 3,
      "deleting place preserves updated Task copy",
    );
  },
});
