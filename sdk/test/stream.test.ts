import { test } from "node:test";
import { once } from "node:events";
import { createServer } from "node:http";
import assert from "node:assert/strict";
import { loadPackagedProtocol } from "@atlas/protocol";
import { createClient, follow, systemClock as clock } from "../src/index.ts";

for (const shape of ["line", "frame"] as const) {
  test(
    `follow ends with invalid_event on an oversized SSE ${shape} [sdk/docs/live.md#follow-completion]`,
    { timeout: 5000 },
    async () => {
      const protocol = await loadPackagedProtocol();
      const chunk = new TextEncoder().encode(
        shape === "frame"
          ? "data: " + "x".repeat(1024 * 1024) + "\n"
          : "x".repeat(1024 * 1024),
      );
      let sent = 0;
      const client = createClient({
        protocol,
        credential: { kind: "account" },
        clock,
        baseUrl: "http://127.0.0.1:8443",
        async fetch(input) {
          if (new URL(String(input)).pathname === "/about")
            return Response.json({
              run_id: 1,
              definitions_hash: protocol.hash,
              core_version: "test",
              protocol_version: "test",
            });
          return new Response(
            new ReadableStream<Uint8Array>({
              pull(controller) {
                if (sent++ < 18) controller.enqueue(chunk);
              },
            }),
          );
        },
      });
      assert.equal((await client.connect()).ok, true, "client connects");
      const stream = follow(client, { after: 0 }, () => {});
      const end = await stream.done;
      assert.equal(end.reason, "invalid_event", "follow ends on the bound");
    },
  );
}

for (const scenario of ["deliberate stop", "open timeout", "network drop"] as const)
  test(`follow reports failures once after ${scenario} [sdk/docs/logging.md]`, { timeout: 5000 }, async t => {
    const protocol = await loadPackagedProtocol();
    const dropConnection = Promise.withResolvers<() => void>();
    const server = createServer((request, response) => {
      if (request.url === "/about") {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ run_id: 1, definitions_hash: protocol.hash, core_version: "test", protocol_version: "test" }));
        return;
      }
      if (scenario === "open timeout") return;
      response.writeHead(200, { "content-type": "text/event-stream" });
      response.flushHeaders();
      dropConnection.resolve(() => response.destroy());
    });
    t.after(() => {
      server.close();
      server.closeAllConnections();
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    assert.ok(address && typeof address === "object");
    const names: string[] = [];
    const reconnecting = Promise.withResolvers<void>();
    const client = createClient({
      protocol,
      credential: { kind: "account" },
      clock,
      baseUrl: `http://127.0.0.1:${address.port}`,
      fetch,
      requestTimeoutMs: 200,
      observer: event => {
        names.push(event.name);
        if (event.name === "stream.reconnect") reconnecting.resolve();
      },
    });
    t.after(() => client.close());
    assert.equal((await client.connect()).ok, true);

    const opened = Promise.withResolvers<void>();
    const stream = follow(client, {
      after: 0,
      onContact: contact => { if (contact.open) opened.resolve(); },
    }, () => {});
    t.after(() => stream.stop());
    if (scenario !== "open timeout") await opened.promise;
    if (scenario === "network drop") (await dropConnection.promise)();
    if (scenario !== "deliberate stop") await reconnecting.promise;
    stream.stop();
    assert.equal((await stream.done).reason, "stopped");
    const failures = names.filter(name => name.startsWith("stream.") &&
      (name.endsWith("_failed") || name === "stream.interrupted" || name === "stream.open_timeout"));
    assert.deepEqual(failures, {
      "deliberate stop": [],
      "open timeout": ["stream.open_timeout"],
      "network drop": ["stream.interrupted"],
    }[scenario]);
    assert.ok(names.includes("stream.close"));
  });

function fakeClient(protocol: Awaited<ReturnType<typeof loadPackagedProtocol>>, body: () => ReadableStream<Uint8Array>, observer?: (event: { name: string }) => void) {
  return createClient({
    protocol,
    credential: { kind: "account" },
    clock,
    baseUrl: "http://127.0.0.1:8443",
    observer,
    async fetch(input) {
      if (new URL(String(input)).pathname === "/about")
        return Response.json({ run_id: 1, definitions_hash: protocol.hash, core_version: "test", protocol_version: "test" });
      return new Response(body(), { headers: { "content-type": "text/event-stream" } });
    },
  });
}

test("an interrupted stream never passes error text to the observer [sdk/docs/logging.md#rules]", { timeout: 5000 }, async t => {
  const protocol = await loadPackagedProtocol();
  const events: unknown[] = [];
  const interrupted = Promise.withResolvers<void>();
  const client = fakeClient(protocol, () => new ReadableStream(), event => {
    events.push(event);
    if (event.name === "stream.interrupted") interrupted.resolve();
  });
  t.after(() => client.close());
  assert.equal((await client.connect()).ok, true);
  const stream = follow(client, {
    after: 0,
    beforeOpen: () => { throw new Error("Authorization: Bearer secret-key-value"); },
  }, () => {});
  await interrupted.promise;
  stream.stop();
  await stream.done;
  assert.equal(JSON.stringify(events).includes("secret-key-value"), false);
});

test("stopping from a contact callback cancels the stream source [sdk/docs/live.md#follow-completion]", { timeout: 5000 }, async t => {
  const protocol = await loadPackagedProtocol();
  let cancelled = 0;
  const client = fakeClient(protocol, () => new ReadableStream({
    start(controller) { controller.enqueue(new TextEncoder().encode(": keepalive\n\n")); },
    cancel() { cancelled++; },
  }));
  t.after(() => client.close());
  assert.equal((await client.connect()).ok, true);
  const stream = follow(client, {
    after: 0,
    onContact: contact => { if (contact.open) stream.stop(); },
  }, () => {});
  assert.equal((await stream.done).reason, "stopped");
  assert.equal(cancelled, 1);
});

test("a throwing contact callback still cancels a readable source [sdk/docs/live.md#follow-completion]", { timeout: 5000 }, async t => {
  const protocol = await loadPackagedProtocol();
  let cancelled = 0;
  let thrown = false;
  const client = fakeClient(protocol, () => new ReadableStream({
    start(controller) { controller.enqueue(new TextEncoder().encode(": keepalive\n\n")); },
    cancel() { cancelled++; },
  }));
  t.after(() => client.close());
  assert.equal((await client.connect()).ok, true);
  const closed = Promise.withResolvers<void>();
  const stream = follow(client, {
    after: 0,
    onContact: contact => {
      if (!contact.open) return closed.resolve();
      if (!thrown) { thrown = true; throw new Error("callback failed"); }
    },
  }, () => {});
  await closed.promise;
  stream.stop();
  await stream.done;
  assert.equal(cancelled >= 1, true);
});

test("a stop finishes even when the source never settles its cancellation [sdk/docs/live.md#follow-completion]", { timeout: 5000 }, async t => {
  const protocol = await loadPackagedProtocol();
  const client = fakeClient(protocol, () => new ReadableStream({
    start(controller) { controller.enqueue(new TextEncoder().encode(": keepalive\n\n")); },
    cancel: () => new Promise<void>(() => {}),
  }));
  t.after(() => client.close());
  assert.equal((await client.connect()).ok, true);
  const stream = follow(client, {
    after: 0,
    onContact: contact => { if (contact.open) stream.stop(); },
  }, () => {});
  assert.equal((await stream.done).reason, "stopped");
});

test("an error whose name carries text still reaches the observer only as a fixed category [sdk/docs/logging.md#rules]", { timeout: 5000 }, async t => {
  const protocol = await loadPackagedProtocol();
  const events: unknown[] = [];
  const interrupted = Promise.withResolvers<void>();
  const client = fakeClient(protocol, () => new ReadableStream(), event => {
    events.push(event);
    if (event.name === "stream.interrupted") interrupted.resolve();
  });
  t.after(() => client.close());
  assert.equal((await client.connect()).ok, true);
  const stream = follow(client, {
    after: 0,
    beforeOpen: () => { throw new DOMException("x", "secret-key-value"); },
  }, () => {});
  await interrupted.promise;
  stream.stop();
  await stream.done;
  assert.equal(JSON.stringify(events).includes("secret-key-value"), false);
});

test("an error name that changes between reads never reaches the observer [sdk/docs/logging.md#rules]", { timeout: 5000 }, async t => {
  const protocol = await loadPackagedProtocol();
  const events: unknown[] = [];
  const interrupted = Promise.withResolvers<void>();
  const client = fakeClient(protocol, () => new ReadableStream(), event => {
    events.push(event);
    if (event.name === "stream.interrupted") interrupted.resolve();
  });
  t.after(() => client.close());
  assert.equal((await client.connect()).ok, true);
  let reads = 0;
  const shifty = new Error("x");
  Object.defineProperty(shifty, "name", { get: () => (reads++ === 0 ? "TypeError" : "secret-key-value") });
  const stream = follow(client, { after: 0, beforeOpen: () => { throw shifty; } }, () => {});
  await interrupted.promise;
  stream.stop();
  await stream.done;
  assert.equal(JSON.stringify(events).includes("secret-key-value"), false);
});

test("a source that refuses cancellation after an invalid frame is reported [sdk/docs/logging.md]", { timeout: 5000 }, async t => {
  const protocol = await loadPackagedProtocol();
  const names: string[] = [];
  const chunk = new TextEncoder().encode("x".repeat(1024 * 1024));
  let sent = 0;
  const client = fakeClient(protocol, () => new ReadableStream({
    pull(controller) { if (sent++ < 18) controller.enqueue(chunk); },
    cancel: () => Promise.reject(new Error("refused")),
  }), event => names.push(event.name));
  t.after(() => client.close());
  assert.equal((await client.connect()).ok, true);
  const stream = follow(client, { after: 0 }, () => {});
  assert.equal((await stream.done).reason, "invalid_event");
  await new Promise<void>(resolve => setImmediate(resolve));
  assert.ok(names.includes("stream.reader_cancel_failed"));
});

test("follow accepts a 16 MiB frame and refuses one extra byte [core/docs/api.md#the-event-log-and-live-stream]", async t => {
  const protocol = await loadPackagedProtocol();
  const frame = (id: number, size: number) => {
    const envelope = { event_id: id, time: 0, kind: "plugin.result",
      record: { type: "plugin.result", time: 0, plugin_id: "P1", request_id: 1 } };
    const data = "\ndata: " + JSON.stringify(envelope) + "\n\n";
    const padding = size - Buffer.byteLength(":" + data);
    return ":" + "é".repeat(Math.floor(padding / 2)) + " ".repeat(padding % 2) + data;
  };
  const limit = 16 * 1024 * 1024;
  const client = createClient({
    protocol, credential: { kind: "account" }, clock, baseUrl: "http://localhost",
    async fetch(input) {
      if (new URL(String(input)).pathname === "/about")
        return Response.json({ run_id: 1, definitions_hash: protocol.hash, core_version: "test", protocol_version: "test" });
      return new Response(frame(1, limit) + frame(2, limit + 1));
    },
  });
  t.after(() => client.close());
  assert.ok((await client.connect()).ok);
  const seen: number[] = [];
  const stream = follow(client, { after: 0 }, event => { seen.push(event.event_id); });
  assert.equal((await stream.done).reason, "invalid_event");
  assert.deepEqual(seen, [1]);
});
