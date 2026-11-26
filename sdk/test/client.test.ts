import assert from "node:assert/strict";
import { test } from "node:test";
import { loadPackagedProtocol } from "@atlas/protocol";
import { createClient, systemClock, type Diagnostic } from "../src/index.ts";

test("client refuses non-loopback HTTP before sending credentials", async () => {
  const protocol = await loadPackagedProtocol();
  let sends = 0;
  const options = {
    protocol,
    credential: { kind: "asset" as const, key: "secret" },
    clock: systemClock,
    fetch: async () => {
      sends++;
      throw new Error("must not send");
    },
  };
  for (const baseUrl of [
    "http://core.example",
    "http://192.168.1.1",
    "http://128.0.0.1",
    "http://localhost.example",
  ])
    assert.throws(() => createClient({ ...options, baseUrl }), /loopback/);
  for (const baseUrl of [
    "https://core.example",
    "http://localhost",
    "http://127.0.0.1",
    "http://127.255.255.254",
    "http://[::1]",
  ])
    createClient({ ...options, baseUrl }).close();
  assert.equal(sends, 0);
});

test("a later diagnostic gap counts observer throws and rejections [sdk/docs/logging.md#rules]", async t => {
  const protocol = await loadPackagedProtocol();
  const delivered: Diagnostic[] = [];
  const client = createClient({
    protocol,
    credential: { kind: "account" },
    clock: systemClock,
    baseUrl: "http://127.0.0.1:8443",
    async fetch() {
      return Response.json({
        run_id: 1,
        definitions_hash: protocol.hash,
        stream_keepalive_s: 2,
        core_version: "test",
        protocol_version: "test",
      });
    },
    observer(event) {
      if (event.name === "validation.failed" && event.counter === 2) return Promise.reject(new Error("observer unavailable"));
      if (event.name === "validation.failed") throw new Error("observer unavailable");
      delivered.push(event);
    },
  });
  t.after(() => client.close());
  for (let i = 0; i < 3; i++)
    assert.equal(client.validate("requests.login", {}).ok, false);

  await Promise.resolve();
  assert.equal(delivered.length, 0);
  assert.equal((await client.connect()).ok, true);
  assert.deepEqual(
    delivered.filter(event => event.name === "diagnostics.gap").map(event => event.detail.dropped),
    [3],
  );
});

test("malformed successful handshakes and entity snapshots return invalid_response [sdk/docs/client.md]", async t => {
  const protocol = await loadPackagedProtocol();
  let body: unknown = { definitions_hash: protocol.hash };
  const client = createClient({
    protocol,
    credential: { kind: "account" },
    clock: systemClock,
    baseUrl: "http://localhost",
    fetch: async () => Response.json(body),
  });
  t.after(() => client.close());
  const handshake = await client.connect();
  assert.equal(!handshake.ok && handshake.error, "invalid_response");
  body = { definitions_hash: protocol.hash, run_id: 1, stream_keepalive_s: 2, core_version: "test", protocol_version: "test" };
  assert.equal((await client.connect()).ok, true);
  const snapshot = { as_of: 0, assets: [], observations: [], tracks: [], geofeatures: [] };
  for (body of [{ ...snapshot, assets: null }, { ...snapshot, observations: [{}] }]) {
    const result = await client.call("entities");
    assert.equal(!result.ok && result.error, "invalid_response");
  }
  body = snapshot;
  assert.equal((await client.call("entities")).ok, true);
});
