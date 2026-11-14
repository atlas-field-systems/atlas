import assert from "node:assert/strict";
import { scenario } from "../src/scenario.ts";
import { ipAsset, radioAsset } from "../src/actors.ts";
import { value } from "../src/world.ts";
scenario({
  name: "gateway may act only for its radios and silence makes radios offline",
  checks: ["core/docs/api.md#radio-assets", "core/docs/api.md#contact"],
  async run(w) {
    const radio = await radioAsset(w);
    const ip = await ipAsset(w);
    const refused = await w.complete(
      radio.client.call("sendReports", {
        params: { asset_id: ip.session.asset_id },
        body: { reports: [] },
      }),
    );
    assert.ok(
      !refused.ok && refused.status === 403,
      "gateway cannot impersonate IP Asset",
    );
    assert.equal(
      value(
        await w.complete(
          w.admin.call("asset", { params: { asset_id: radio.asset_id } }),
        ),
      ).item.contact.contact,
      "online",
    );
    const gateway_id = value(
      await w.complete(
        w.admin.call("asset", { params: { asset_id: radio.asset_id } }),
      ),
    ).item.gateway_id;
    assert.ok(gateway_id);
    radio.close();
    radio.client.close();
    await w.advance(31000);
    const picture = value(
      await w.complete(
        w.admin.call("asset", { params: { asset_id: radio.asset_id } }),
      ),
    );
    assert.equal(picture.item.contact.contact, "offline");
    const gateways = value(await w.complete(w.admin.call("assets")));
    assert.equal(
      gateways.gateways.find((g) => g.gateway_id === gateway_id)?.contact,
      "offline",
    );
  },
});

scenario({
  name: "two gateways isolate radio reports and link loss on one Core",
  checks: [
    "atlas/scale.md#setup",
    "core/docs/api.md#radio-assets",
    "core/docs/api.md#contact",
  ],
  async run(w) {
    const first = await radioAsset(w, "gateway-first");
    const second = await radioAsset(w, "gateway-second");
    const beats = [first.client.holdContact(), second.client.holdContact()];
    w.onClose(() => beats.forEach((b) => b.stop()));
    for (const [gateway, other] of [
      [first, second],
      [second, first],
    ]) {
      const refused = await w.complete(
        gateway.client.call("sendReports", {
          params: { asset_id: other.asset_id },
          body: { reports: [] },
        }),
      );
      assert.ok(
        !refused.ok && refused.status === 403,
        "gateway cannot report for the other network",
      );
    }
    w.network.cut("gateway-first");
    await w.advance(31000);
    for (const [radio, expected] of [
      [first, "offline"],
      [second, "online"],
    ] as const) {
      const asset = value(
        await w.complete(
          w.admin.call("asset", { params: { asset_id: radio.asset_id } }),
        ),
      ).item;
      assert.equal(asset.contact.contact, expected);
      const gateways = value(await w.complete(w.admin.call("assets"))).gateways;
      assert.equal(
        gateways.find((g) => g.gateway_id === asset.gateway_id)?.contact,
        expected,
      );
    }
  },
});
