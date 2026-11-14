import assert from "node:assert/strict";
import { follow, createClient } from "@atlas/sdk";
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
scenario({
  name: "login recovery has its own deadline and distinguishes an unconfirmed session",
  checks: ["sdk/docs/client.md#retries-and-idempotency"],
  async run(w) {
    const began = w.clock.now();
    const networkFetch = w.network.fetchFor("slow-login");
    const c = w.client(
      "slow-login",
      { kind: "account" },
      async (input, init) => {
        if (
          new URL(String(input)).pathname === "/administration/login" &&
          w.clock.now() - began <= 10000
        )
          throw new TypeError(
            "Network unavailable for the first request window",
          );
        return networkFetch(input, init);
      },
    );
    value(await w.complete(c.connect()));
    value(await w.complete(c.login("ADM", "simulation-password")));
    assert.equal(value(await w.complete(c.call("me"))).operator_id, "ADM");

    const unconfirmed = createClient({
      credential: { kind: "account" },
      protocol: w.protocol,
      clock: w.clock,
      baseUrl: w.core.url,
      requestTimeoutMs: 100,
      backoff: { minMs: 10, maxMs: 20, factor: 2, jitter: 0 },
      fetch: (input, init) => w.network.fetchFor("no-cookie")(input, init),
    });
    w.onClose(() => unconfirmed.close());
    value(await w.complete(unconfirmed.connect()));
    const missing = await w.complete(
      unconfirmed.login("ADM", "simulation-password"),
    );
    assert.ok(!missing.ok);
    assert.equal(missing.error, "session_not_confirmed");
    const wrong = await w.complete(unconfirmed.login("ADM", "wrong-password"));
    assert.ok(!wrong.ok);
    assert.equal(wrong.error, "unauthenticated");
  },
});
