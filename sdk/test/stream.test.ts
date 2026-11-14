import { test } from "node:test";
import assert from "node:assert/strict";
import { loadPackagedProtocol } from "@atlas/protocol";
import { createClient } from "../src/client.ts";
import { follow } from "../src/stream.ts";
import { systemClock as clock } from "../src/clock.ts";

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
