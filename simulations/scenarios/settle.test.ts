import assert from "node:assert/strict";
import { scenario } from "../src/scenario.ts";
import { follow } from "@atlas/sdk";
import { value } from "../src/world.ts";
scenario({
  name: "settle waits for a delayed stream chunk",
  checks: ["simulations/README.md#real-parts-simulated-world"],
  async run(w) {
    w.network.chunkTurnDelay = true;
    const handled: number[] = [];
    const stream = follow(w.admin, { after: 0 }, (e) => {
      handled.push(e.event_id);
    });
    await w.settle();
    const changed = value(
      await w.complete(
        w.admin.call("createGeofeature", {
          body: { kind: "point", position: { latitude: 1, longitude: 2 } },
        }),
      ),
    );
    await w.settle();
    assert.ok(
      handled.includes(changed.event_id),
      "settle includes a stream chunk deferred to another event-loop turn",
    );
    stream.stop();
    await stream.done;
  },
});
