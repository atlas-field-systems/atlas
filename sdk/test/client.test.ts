import assert from "node:assert/strict";
import { test } from "node:test";
import { loadPackagedProtocol } from "@atlas/protocol";
import { createClient } from "../src/client.ts";
import { systemClock } from "../src/clock.ts";

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
