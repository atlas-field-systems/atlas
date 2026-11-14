import assert from "node:assert/strict";
import { follow, createLivePicture, type AtlasEvent } from "@atlas/sdk";
import { scenario } from "../src/scenario.ts";
import { value } from "../src/world.ts";
import type { ProtocolTypes as P } from "@atlas/protocol/types";
scenario({
  name: "dropped streams resume once and recover a snapshot",
  checks: [
    "simulations/docs/core-and-sdk.md#scenarios",
    "core/docs/api.md#the-event-log-and-live-stream",
    "sdk/docs/live.md#live-picture",
  ],
  async run(w) {
    const reader = w.client("reader", { kind: "account" });
    value(await w.complete(reader.connect()));
    value(await w.complete(reader.login("ADM", "simulation-password")));
    const all: AtlasEvent[] = [];
    const stream = follow(reader, { after: 0 }, (e) => {
      all.push(e);
    });
    await w.settle();
    const create = async (name: string, latitude: number) =>
      value(
        await w.complete(
          w.admin.call("createGeofeature", {
            body: { kind: "point", name, position: { latitude, longitude: 2 } },
          }),
        ),
      );
    const a = await create("First", 1);
    const snapshot = value(await w.complete(w.admin.call("entities")));
    const restored = new Map(
      snapshot.geofeatures.map((g) => [g.geofeature_id, g]),
    );
    const suffix = follow(w.admin, { after: snapshot.as_of }, (e) => {
      if (e.kind === "geofeature.created" || e.kind === "geofeature.replaced")
        restored.set(e.record.geofeature_id, e.record);
      if (e.kind === "geofeature.deleted")
        restored.delete(e.record.geofeature_id);
    });
    w.network.dropStreams("reader");
    const b = await create("Second", 3);
    const replacement = value(
      await w.complete(
        w.admin.call("replaceGeofeature", {
          params: { geofeature_id: b.geofeature.geofeature_id },
          body: {
            kind: "point",
            name: "Final",
            position: { latitude: 4, longitude: 2 },
          },
        }),
      ),
    );
    await w.until(() => !stream.stale && stream.cursor >= replacement.event_id);
    w.network.dropStreams("reader");
    const deletion = value(
      await w.complete(
        w.admin.call("deleteGeofeature", {
          params: { geofeature_id: a.geofeature.geofeature_id },
        }),
      ),
    );
    await w.until(() => stream.cursor >= deletion.event_id);
    assert.equal(
      w.network.traffic.filter(
        (t) =>
          t.caller === "reader" && t.path === "/events" && t.status === 200,
      ).length,
      3,
      "two stream reopens",
    );
    const ids = all.map((e) => e.event_id);
    assert.deepEqual(
      ids,
      [a.event_id, b.event_id, replacement.event_id, deletion.event_id],
      "every event delivered once in order after drops",
    );
    const expected = [
      {
        geofeature_id: b.geofeature.geofeature_id,
        name: "Final",
        latitude: 4,
        longitude: 2,
      },
    ];
    const project = (items: P["geofeature"][]) =>
      items.map((g) => {
        assert.equal(g.kind, "point");
        return {
          geofeature_id: g.geofeature_id,
          name: g.name,
          ...(g.kind === "point"
            ? { latitude: g.position.latitude, longitude: g.position.longitude }
            : {}),
        };
      });
    const full = new Map<string, P["geofeature"]>();
    for (const e of all) {
      if (e.kind === "geofeature.created" || e.kind === "geofeature.replaced")
        full.set(e.record.geofeature_id, e.record);
      if (e.kind === "geofeature.deleted") full.delete(e.record.geofeature_id);
    }
    await w.settle();
    assert.deepEqual(
      project([...full.values()]),
      expected,
      "stream alone matches the literal final place",
    );
    assert.deepEqual(
      project([...restored.values()]),
      expected,
      "snapshot plus suffix matches the literal final place",
    );
    const picture = createLivePicture(w.admin);
    await w.until(() => picture.geofeatures().ready);
    assert.deepEqual(
      project(picture.geofeatures().items),
      expected,
      "live picture matches independent expectation",
    );
    picture.stop();
    stream.stop();
    suffix.stop();
  },
});
