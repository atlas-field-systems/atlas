import assert from "node:assert/strict";
import { createLivePicture, follow } from "@atlas/sdk";
import { scenario } from "../src/scenario.ts";
import { assetApp } from "../src/asset-app.ts";
import { sdkAssetCaller, description } from "../src/actors.ts";
import { value } from "../src/world.ts";

for (const failure of ["entities", "tasks", "removed"] as const) {
  scenario({
    name: `picture recovers ${failure} snapshot failure and follows later places`,
    checks: ["sdk/docs/live.md#live-picture"],
    async run(w) {
      const a = await assetApp(w);
      const asset_id = a.asset_id;
      const network = w.network.fetchFor("picture");
      let began: number | undefined;
      let removed = false;
      const c = w.client(
        "picture",
        { kind: "account" },
        async (input, init) => {
          const path = new URL(String(input)).pathname;
          if (
            failure === "removed" &&
            path === `/tasks/${asset_id}` &&
            !removed
          ) {
            removed = true;
            value(await w.admin.call("removeAsset", { params: { asset_id } }));
          }
          if (
            path ===
              (failure === "entities" ? "/entities" : `/tasks/${asset_id}`) &&
            failure !== "removed"
          ) {
            began ??= w.clock.now();
            if (w.clock.now() - began <= 10000)
              throw new TypeError(
                "Snapshot unavailable for the request window",
              );
          }
          return network(input, init);
        },
      );
      value(await w.complete(c.connect()));
      value(await w.complete(c.login("ADM", "simulation-password")));
      const picture = createLivePicture(c);
      w.onClose(() => picture.stop());
      await w.settle();
      await w.advance(11000);
      assert.equal(picture.assets().ready, true);
      const place = value(
        await w.complete(
          w.admin.call("createGeofeature", {
            body: { kind: "point", position: { latitude: 1, longitude: 2 } },
          }),
        ),
      );
      await w.settle();
      assert.ok(
        picture
          .geofeatures()
          .items.some(
            (g) => g.geofeature_id === place.geofeature.geofeature_id,
          ),
      );
      if (failure === "removed") assert.equal(picture.assets().items.length, 0);
    },
  });
}

scenario({
  name: "picture notifies quiet open and quiet disconnect freshness",
  checks: ["sdk/docs/live.md#live-picture"],
  async run(w) {
    const c = w.client("quiet", { kind: "account" });
    value(await w.complete(c.connect()));
    value(await w.complete(c.login("ADM", "simulation-password")));
    const picture = createLivePicture(c);
    w.onClose(() => picture.stop());
    const changes: boolean[] = [];
    picture.onChange(() => changes.push(picture.assets().stale));
    await w.settle();
    assert.equal(changes.at(-1), false);
    w.network.dropStreams("quiet");
    await w.settle();
    assert.equal(changes.at(-1), true);
  },
});

scenario({
  name: "follow times out before stream response headers and reconnects",
  checks: ["sdk/docs/live.md#reconnecting"],
  async run(w) {
    const network = w.network.fetchFor("headers");
    let opens = 0;
    const c = w.client("headers", { kind: "account" }, async (input, init) => {
      if (new URL(String(input)).pathname === "/events" && ++opens === 1)
        return new Promise<Response>((_, reject) =>
          init?.signal?.addEventListener(
            "abort",
            () => reject(new Error("aborted")),
            { once: true },
          ),
        );
      return network(input, init);
    });
    value(await w.complete(c.connect()));
    value(await w.complete(c.login("ADM", "simulation-password")));
    const stream = follow(c, { after: 0 }, () => {});
    w.onClose(() => stream.stop());
    await w.settle();
    assert.equal(opens, 1);
    await w.advance(10000);
    assert.equal(stream.stale, true);
    await w.advance(10);
    assert.ok(opens >= 2);
    assert.equal(stream.stale, false);
  },
});

scenario({
  // SDK picture contract: the app has no gimbal acquisition input or dynamic camera declaration API.
  name: "picture reconciles declared equipment after registration and later reports",
  checks: [
    "core/docs/api.md#read-the-picture",
    "sdk/docs/live.md#live-picture",
  ],
  async run(w) {
    const a = await sdkAssetCaller(w, "equipment", w.clock, {
      ...description,
      reports: ["status", "gimbal"],
      subsystems: [{ subsystem_id: "S1", label: "Drive" }],
      cameras: [
        {
          camera_id: "C1",
          mount: "gimbal",
          yaw_deg: 0,
          pitch_deg: 0,
          horizontal_fov_deg: 80,
          vertical_fov_deg: 60,
        },
      ],
    });
    a.session.stop();
    const asset_id = a.session.asset_id;
    const send = () =>
      w.complete(
        a.client.call("sendReports", {
          params: { asset_id },
          body: {
            reports: [
              {
                type: "report.status",
                time: w.clock.now(),
                asset_id,
                kind: "subsystem",
                subsystem_id: "S1",
                condition: "healthy",
              },
              {
                type: "report.gimbal",
                time: w.clock.now(),
                asset_id,
                camera_id: "C1",
                yaw_deg: 1,
                pitch_deg: 2,
              },
            ],
          },
        }),
      );
    value(await send());
    const picture = createLivePicture(w.admin);
    w.onClose(() => picture.stop());
    await w.settle();
    assert.deepEqual(Object.keys(picture.assets().items[0].subsystems), ["S1"]);
    value(await w.complete(a.client.call("register", { body: description })));
    await w.settle();
    const check = async () => {
      const fresh = value(
        await w.complete(w.admin.call("asset", { params: { asset_id } })),
      ).item;
      assert.deepEqual(picture.assets().items[0].subsystems, fresh.subsystems);
      assert.deepEqual(picture.assets().items[0].gimbals, fresh.gimbals);
    };
    await check();
    value(await send());
    await w.settle();
    await check();
  },
});
