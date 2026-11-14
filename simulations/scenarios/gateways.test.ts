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
    radio.close();
    radio.client.close();
    await w.advance(31000);
    const picture = value(
      await w.complete(
        w.admin.call("asset", { params: { asset_id: radio.asset_id } }),
      ),
    );
    assert.equal(picture.item.contact.contact, "offline");
  },
});
