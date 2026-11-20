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

test("stopping an open stream emits no failure [sdk/docs/logging.md]", { timeout: 5000 }, async t => {
  const protocol = await loadPackagedProtocol();
  const server = createServer((request, response) => {
    if (request.url === "/about") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ run_id: 1, definitions_hash: protocol.hash, core_version: "test", protocol_version: "test" }));
      return;
    }
    response.writeHead(200, { "content-type": "text/event-stream" });
    response.flushHeaders();
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
  const client = createClient({
    protocol,
    credential: { kind: "account" },
    clock,
    baseUrl: `http://127.0.0.1:${address.port}`,
    fetch,
    observer: event => { names.push(event.name); },
  });
  t.after(() => client.close());
  assert.equal((await client.connect()).ok, true);

  const opened = Promise.withResolvers<void>();
  const stream = follow(client, {
    after: 0,
    onContact: contact => { if (contact.open) opened.resolve(); },
  }, () => {});
  t.after(() => stream.stop());
  await opened.promise;
  stream.stop();
  assert.equal((await stream.done).reason, "stopped");
  assert.ok(names.includes("stream.close"));
  assert.deepEqual(names.filter(name => name.endsWith("_failed") || name === "stream.interrupted"), []);
});
