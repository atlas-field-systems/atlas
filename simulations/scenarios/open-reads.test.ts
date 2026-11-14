import assert from "node:assert/strict";
import { scenario } from "../src/scenario.ts";
import { ipAsset, radioAsset } from "../src/actors.ts";
import { value } from "../src/world.ts";
scenario({
  name: "an Asset and a gateway read another Asset, its Tasks, and the picture",
  checks: ["core/docs/api.md#reads"],
  async run(w) {
    const reader = await ipAsset(w, "reader");
    const other = await ipAsset(w, "other");
    const radio = await radioAsset(w);
    const asset_id = other.session.asset_id;
    for (const client of [reader.client, radio.client]) {
      assert.equal(
        value(await w.complete(client.call("asset", { params: { asset_id } })))
          .item.asset_id,
        asset_id,
      );
      value(await w.complete(client.call("tasks", { params: { asset_id } })));
      const picture = value(await w.complete(client.call("entities")));
      assert.ok(
        picture.assets.some((a: { asset_id: string }) => a.asset_id === asset_id),
      );
    }
  },
});
