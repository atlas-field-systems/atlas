import assert from "node:assert/strict";
import { scenario } from "../src/scenario.ts";
import { ipAsset } from "../src/actors.ts";
import { value } from "../src/world.ts";
scenario({
  name: "reports after a gap send live first and retained oldest first",
  checks: [
    "core/docs/api.md#asset-and-gateway-calls",
    "core/docs/api.md#reads",
  ],
  async run(w) {
    const asset = await ipAsset(w);
    const asset_id = asset.session.asset_id;
    const path = `/entities/assets/${asset_id}/reports`;
    const original = w.clock.now();
    w.network.cut("asset");
    await w.advance(31000);
    w.network.heal("asset");
    await w.complete(asset.session.outbox.flush());
    const report = (offset: number) => ({
      type: "report.settings" as const,
      time: original + offset,
      asset_id,
      settings: { lights: "on" as const },
    });
    const start = w.network.traffic.length;
    w.network.once("asset", path, { kind: "delay", ms: 100 });
    asset.session.outbox.add([report(31000)]);
    asset.session.outbox.add([report(0), report(100)], "retained");
    asset.session.outbox.add([report(31001)]);
    await w.settle();
    assert.equal(
      w.network.traffic.slice(start).filter((t) => t.path === path).length,
      1,
      "one batch at a time",
    );
    await w.complete(asset.session.outbox.flush());
    const sent = w.network.traffic
      .slice(start)
      .filter((t) => t.path === path && t.body);
    const times = sent
      .map((t) =>
        (t.body as { reports: { time: number }[] }).reports.map((r) => r.time),
      )
      .filter((batch) => batch.length);
    assert.deepEqual(
      times,
      [[original + 31000], [original + 31001], [original, original + 100]],
      "live waits before retained, whose order is unchanged",
    );
    const history: number[] = [];
    const pages = w.admin
      .history({ asset_id, report: "settings", limit: 1 })
      [Symbol.asyncIterator]();
    for (;;) {
      const page = await w.complete(pages.next());
      if (page.done) break;
      history.push(...value(page.value).items.map((e) => e.record.time));
    }
    assert.deepEqual(
      history,
      [original, original + 100, original + 31000, original + 31001],
      "history orders retained evidence by original time",
    );
    assert.equal(
      value(await w.complete(w.admin.call("asset", { params: { asset_id } })))
        .item.settings.lights.time,
      original + 31001,
    );
  },
});
