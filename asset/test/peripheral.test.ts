import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Socket } from "node:net";
import { once } from "node:events";
import { systemClock } from "@atlas/sdk";
import { peripheral } from "../src/peripheral.ts";

test("docs/runtime.md: shutdown waits for a capture from a disconnected peripheral", { timeout: 5000 }, async t => {
  const peers = new Set<Socket>();
  const server = createServer(peer => {
    peers.add(peer);
    peer.on("error", () => {});
  });
  t.after(() => { for (const peer of peers) peer.destroy(); server.close(); });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const capture = Promise.withResolvers<void>();
  const started = Promise.withResolvers<void>();
  const disconnected = Promise.withResolvers<void>();
  const dropped: unknown[] = [];
  const driver = peripheral({ kind: "peripheral", host: "127.0.0.1", port: address.port, max_message_bytes: 1024, reconnect_s: 0.001 }, systemClock, {
    observation() {},
    async file() { started.resolve(); await capture.promise; },
    diagnostic(value) {
      if (value && typeof value === "object" && "kind" in value && value.kind === "peripheral_file_dropped") dropped.push(value);
      if (value && typeof value === "object" && "kind" in value && value.kind === "peripheral_error") disconnected.resolve(); },
  });
  t.after(async () => { capture.resolve(); await driver.stop(); });
  const first = once(server, "connection");
  const position = Promise.withResolvers<void>();
  driver.start(sample => { if (sample.position) position.resolve(); });
  const [peer] = await first;
  peer.write(JSON.stringify({ kind: "file", name: "capture", contentType: "text/plain", base64: "YQ==" }) + "\n");
  await started.promise;
  for (let i = 1; i <= 8; i++) {
    peer.write(JSON.stringify({ kind: "file", name: String(i), contentType: "text/plain", base64: "YQ==" }) + "\n");
  }
  peer.write(JSON.stringify({ kind: "position", source: "GPS", valid: true, time: 1, position: { latitude: 0, longitude: 0 } }) + "\n");
  await position.promise;
  assert.equal(dropped.length, 1);
  peer.resetAndDestroy();
  await disconnected.promise;
  await new Promise<void>(resolve => setTimeout(resolve, 10));
  const second = once(server, "connection");
  driver.tick(systemClock.now());
  await second;
  let stopped = false;
  const stopping = Promise.resolve(driver.stop()).then(() => { stopped = true; });
  await new Promise<void>(resolve => setImmediate(resolve));
  await new Promise<void>(resolve => setImmediate(resolve));
  assert.equal(stopped, false, "shutdown must retain the earlier capture owner");
  capture.resolve();
  await stopping;
  assert.equal(stopped, true);
});
