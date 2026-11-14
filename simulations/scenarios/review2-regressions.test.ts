import assert from "node:assert/strict";
import { follow, createClient, startAsset } from "@atlas/sdk";
import { scenario } from "../src/scenario.ts";
import { description } from "../src/actors.ts";
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

scenario({
  name: "one client orders diagnostics across startup queue outbox and report retries",
  checks: ["sdk/docs/logging.md#what-it-reports"],
  async run(w) {
    const issued = value(await w.complete(w.admin.call("createAssetKey")));
    assert.ok("key" in issued);
    const diagnostics: import("@atlas/sdk").Diagnostic[] = [];
    const client = createClient({
      credential: { kind: "asset", key: issued.key },
      protocol: w.protocol,
      clock: w.clock,
      baseUrl: w.core.url,
      fetch: w.network.fetchFor("ordered"),
      observer: (event) => {
        diagnostics.push(event);
      },
      backoff: { minMs: 10, maxMs: 100, factor: 2, jitter: 0 },
    });
    w.onClose(() => client.close());
    const session = value(
      await w.complete(
        startAsset(client, {
          clock: w.clock,
          description,
          settings: () => ({}),
          queue: { runNow() {}, stop() {}, update() {} },
        }),
      ),
    );
    w.onClose(() => session.stop());
    const asset_id = session.asset_id;
    value(
      await w.complete(
        w.admin.call("sendTasks", {
          params: { asset_id },
          body: { tasks: [{ kind: "hold" }] },
        }),
      ),
    );
    await w.until(() => session.queue!.held().length === 1);
    await w.complete(session.outbox.flush());
    w.network.once("ordered", `/entities/assets/${asset_id}/reports`, {
      kind: "refuse",
      status: 507,
    });
    session.queue!.next();
    session.queue!.finish(1, "completed");
    await w.complete(session.outbox.flush());
    await w.settle();
    assert.ok(diagnostics.some((e) => e.name === "task.finished"));
    assert.ok(diagnostics.some((e) => e.name === "batch.sent"));
    assert.ok(
      diagnostics.every(
        (event, i) => i === 0 || event.counter > diagnostics[i - 1].counter,
      ),
      "all emitters for this client share a monotonically rising counter",
    );
    assert.equal(
      diagnostics.filter((e) => e.name === "batch.resent").length,
      1,
    );
  },
});
