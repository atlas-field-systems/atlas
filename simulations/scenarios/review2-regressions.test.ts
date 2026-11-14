import assert from "node:assert/strict";
import { follow } from "@atlas/sdk";
import { scenario } from "../src/scenario.ts";
import { value } from "../src/world.ts";

scenario({
  name: "follow stops reading the source while its handler is pending",
  checks: [
    "sdk/docs/live.md#reconnecting",
    "core/docs/api.md#the-event-log-and-live-stream",
  ],
  async run(w) {
    value(
      await w.complete(
        w.admin.call("createGeofeature", {
          body: { kind: "point", position: { latitude: 1, longitude: 2 } },
        }),
      ),
    );
    let reads = 0;
    const networkFetch = w.network.fetchFor("backpressure");
    const client = w.client(
      "backpressure",
      { kind: "account" },
      async (input, init) => {
        const response = await networkFetch(input, init);
        if (new URL(String(input)).pathname !== "/events" || !response.body)
          return response;
        const reader = response.body.getReader();
        return new Response(
          new ReadableStream(
            {
              async pull(target) {
                reads++;
                const next = await reader.read();
                if (next.done) target.close();
                else target.enqueue(next.value);
              },
              cancel() {
                return reader.cancel();
              },
            },
            { highWaterMark: 0 },
          ),
          { headers: response.headers },
        );
      },
    );
    value(await w.complete(client.connect()));
    value(await w.complete(client.login("ADM", "simulation-password")));
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let entered = false;
    const stream = follow(client, { after: 0 }, async () => {
      entered = true;
      await gate;
    });
    w.onClose(() => {
      release();
      stream.stop();
    });
    await w.until(() => entered);
    const before = reads;
    await w.advance(35000);
    assert.equal(
      reads,
      before,
      "SDK must preserve source backpressure during a handler",
    );
    release();
    await w.settle();
    assert.ok(reads > before);
  },
});
