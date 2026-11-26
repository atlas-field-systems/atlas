import assert from "node:assert/strict";
import { scenario } from "../src/scenario.ts";
import { value } from "../src/world.ts";
import { sdkAssetCaller, description } from "../src/actors.ts";
import { createLivePicture } from "@atlas/sdk";

for (const verificationFailure of [undefined, 503]) scenario({
  name: `a storage-refusal retry cannot write into a new run (verification ${verificationFailure ?? "available"})`,
  checks: ["sdk/docs/client.md#reset-and-idle-contact"],
  async run(w) {
    const issued = value(await w.complete(w.admin.call("provisionGateway")));
    assert.ok("key" in issued);
    const c = w.client("old-retry", { kind: "gateway", key: issued.key });
    value(await w.complete(c.connect()));
    w.network.once("old-retry", "/entities/assets/radios", {
      kind: "refuse",
      status: 507,
    });
    const pending = await w.complete(
      c.call("registerRadio", { body: { definitions_hash: w.protocol.hash } }),
    );
    assert.ok(!pending.ok && pending.retry);
    await w.restartCore();
    if (verificationFailure)
      w.network.once("old-retry", "/about", { kind: "refuse", status: verificationFailure });
    const retried = await w.complete(pending.retry());
    assert.ok(!retried.ok && retried.error === "run_ended");
    assert.equal(
      w.network.traffic.filter(
        (t) => t.caller === "old-retry" && t.path === "/entities/assets/radios",
      ).length,
      1,
    );
  },
});

scenario({
  name: "redeclared equipment has the same evidence in live and fresh pictures",
  checks: ["core/docs/api.md#reads"],
  async run(w) {
    const declared: typeof description = {
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
    };
    const a = await sdkAssetCaller(w, "equipment", w.clock, declared);
    a.session.stop();
    const asset_id = a.session.asset_id;
    value(
      await w.complete(
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
      ),
    );
    const picture = createLivePicture(w.admin);
    w.onClose(() => picture.stop());
    await w.until(() => picture.assets().ready);
    value(await w.complete(a.client.call("register", { body: description })));
    await w.settle();
    const duringRemoval = createLivePicture(w.admin);
    w.onClose(() => duringRemoval.stop());
    await w.until(() => duringRemoval.assets().ready);
    value(await w.complete(a.client.call("register", { body: declared })));
    await w.settle();
    const snapshot = value(
      await w.complete(w.admin.call("asset", { params: { asset_id } })),
    );
    await w.until(() => picture.assets().ready && duringRemoval.assets().ready);
    for (const view of [picture, duringRemoval]) {
      const live = view.assets().items.find((a) => a.asset_id === asset_id);
      assert.deepEqual(live?.subsystems, snapshot.item.subsystems);
      assert.deepEqual(live?.gimbals, snapshot.item.gimbals);
    }
  },
});
