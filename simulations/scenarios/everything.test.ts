import assert from "node:assert/strict";
import { follow } from "@atlas/sdk";
import { scenario } from "../src/scenario.ts";
import { ipAsset } from "../src/actors.ts";
import { value } from "../src/world.ts";

scenario({
  name: "keyed everything follow sees unrelated Tasks before and after reconnect",
  checks: ["core/docs/api.md#callers-and-credentials"],
  async run(w) {
    const reader = await ipAsset(w, "reader");
    const other = await ipAsset(w, "other");
    const after = value(await w.complete(reader.client.call("entities"))).as_of;
    const all: number[] = [],
      defaults: number[] = [];
    const everything = follow(
      reader.client,
      { after, everything: true },
      (e) => {
        all.push(e.event_id);
      },
    );
    const normal = follow(reader.client, { after }, (e) => {
      defaults.push(e.event_id);
    });
    w.onClose(() => {
      everything.stop();
      normal.stop();
    });
    await w.settle();
    for (const reconnect of [false, true]) {
      if (reconnect) w.network.dropStreams("reader");
      const unrelated = value(
        await w.complete(
          w.admin.call("sendTasks", {
            params: { asset_id: other.session.asset_id },
            body: { tasks: [{ kind: "hold" }] },
          }),
        ),
      );
      const own = value(
        await w.complete(
          w.admin.call("sendTasks", {
            params: { asset_id: reader.session.asset_id },
            body: { tasks: [{ kind: "hold" }] },
          }),
        ),
      );
      // A later in-scope event proves both readers have passed the unrelated event.
      await w.until(
        () => all.includes(own.event_id) && defaults.includes(own.event_id),
      );
      assert.equal(
        all.filter((id) => id === unrelated.event_id).length,
        1,
        "everything receives the exact unrelated event once",
      );
      assert.ok(
        !defaults.includes(unrelated.event_id),
        "default audience excludes unrelated Asset",
      );
    }
  },
});
