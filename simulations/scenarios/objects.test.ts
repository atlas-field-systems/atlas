import assert from "node:assert/strict";
import { scenario } from "../src/scenario.ts";
import { value } from "../src/world.ts";
scenario({
  name: "Objects enforce size deletion and imagery references",
  checks: ["core/docs/api.md#objects", "core/docs/api.md#geo-features"],
  config: { max_object_bytes: 26 },
  async run(w) {
    const tooLarge = await w.complete(
      w.admin.uploadObject(new Uint8Array(27), "application/octet-stream", {
        name: "large",
      }),
    );
    assert.ok(!tooLarge.ok && tooLarge.status === 413);
    assert.equal(
      value(await w.complete(w.admin.call("objects"))).items.length,
      0,
    );
    const tiff = new Uint8Array(26);
    const bytes = new DataView(tiff.buffer);
    tiff.set([73, 73]);
    bytes.setUint16(2, 42, true);
    bytes.setUint32(4, 8, true);
    bytes.setUint16(8, 1, true);
    bytes.setUint16(10, 34735, true);
    const stored = value(
      await w.complete(
        w.admin.uploadObject(tiff, "application/octet-stream", { name: "map" }),
      ),
    );
    const imagery = value(
      await w.complete(
        w.admin.call("createGeofeature", {
          body: { kind: "imagery", object_id: stored.object_id },
        }),
      ),
    );
    const params = { object_id: stored.object_id };
    const refused = await w.complete(w.admin.call("deleteObject", { params }));
    assert.ok(!refused.ok && refused.status === 409);
    value(
      await w.complete(
        w.admin.call("deleteGeofeature", {
          params: { geofeature_id: imagery.geofeature.geofeature_id },
        }),
      ),
    );
    value(await w.complete(w.admin.call("deleteObject", { params })));
    for (const result of [
      await w.complete(w.admin.call("object", { params })),
      await w.complete(w.admin.objectFile(stored.object_id)),
    ])
      assert.ok(!result.ok && result.status === 410);
    assert.equal(
      value(await w.complete(w.admin.call("objects"))).items.length,
      0,
    );
    await w.until(() => w.events.some((e) => e.kind === "object.deleted"));
    assert.equal(w.events.filter((e) => e.kind === "object.stored").length, 1);
  },
});
