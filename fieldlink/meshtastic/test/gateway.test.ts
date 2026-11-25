import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";
import { test } from "node:test";
import { loadPackagedProtocol } from "@atlas/protocol";
import { serveGateway } from "../src/gateway.ts";
import { AssetRemoved, type GatewayHost } from "../src/gateway-host.ts";
import { nonce, receiveEnvelopes, sendEnvelope, type Radio } from "../src/radio.ts";
import { meshtasticTiming } from "../src/turns.ts";
import type { Envelope } from "../src/wire.ts";

type Mesh = {
  announce(boot: string): void;
  next(): Promise<Envelope>;
  respond(packet: Envelope, reply?: Partial<Extract<Envelope, { kind: "reply" }>>): Promise<void>;
  errors: unknown[];
};

async function exercise(
  overrides: Partial<GatewayHost>,
  run: (mesh: Mesh) => Promise<void>,
  pollMs = 1_500,
) {
  const controller = new AbortController();
  const { signal } = controller;
  const { hash } = await loadPackagedProtocol();
  const peer = "b".repeat(64);
  let receive: Parameters<Radio["receive"]>[0] | undefined;
  const discovering = Promise.withResolvers<Parameters<Radio["discover"]>[0]>();
  const output = new AsyncQueue();
  const errors: unknown[] = [];
  const radio: Radio = {
    failure: signal,
    async send(_, bytes) { outgoing(peer, bytes); },
    async announce() {},
    receive(listener) { receive = listener; return () => { receive = undefined; }; },
    discover(listener) { discovering.resolve(listener); return () => {}; },
    async close() {},
  };
  let outgoing: Parameters<Radio["receive"]>[0] = () => {};
  receiveEnvelopes({ ...radio, receive(listener) { outgoing = listener; return () => {}; } },
    () => true, (_, packet) => output.push(packet));
  const remote: Radio = { ...radio, async send(_, bytes) { receive?.(peer, bytes); } };
  const host: GatewayHost = {
    async carried() { return []; },
    onEvent: () => () => {},
    async bind() { return { run: 1, assetId: "B", after: 1, lastTaskId: 0 }; },
    async refuseDefinitions() { assert.fail("unexpected refusal"); },
    next() { return undefined; },
    async store() {},
    async contact() {},
    ...overrides,
  };
  const running = serveGateway({ radio, host, signal, timing: { ...meshtasticTiming, pollMs }, onError: error => errors.push(error) });
  try {
    const discover = await discovering.promise;
    await run({
      announce: boot => discover(peer, boot, "discovery"),
      next: () => output.next(),
      async respond(packet, reply) {
        const { session, seq, boot } = packet;
        const response: Envelope = packet.kind === "register"
          ? { kind: "profile", session, seq, boot, hash, description: { commands: [], reports: ["settings"] } }
          : { kind: "reply", session, seq, boot, cursor: 1, ...reply };
        await sendEnvelope(remote, peer, response, signal);
      },
      errors,
    });
  } finally {
    controller.abort();
    await running;
  }
}

class AsyncQueue {
  #items: Envelope[] = [];
  #available = Promise.withResolvers<void>();
  push(packet: Envelope) {
    this.#items.push(packet);
    this.#available.resolve();
  }
  async next() {
    while (!this.#items.length) await this.#available.promise;
    const packet = this.#items.shift()!;
    if (!this.#items.length) this.#available = Promise.withResolvers<void>();
    return packet;
  }
}

async function join(mesh: Mesh, boot = nonce()) {
  mesh.announce(boot);
  const register = await mesh.next();
  assert.equal(register.kind, "register");
  await mesh.respond(register);
  const registered = await mesh.next();
  assert.equal(registered.kind, "registered");
  await mesh.respond(registered);
  return boot;
}

// Meshtastic README, First implementation: Core storage and delivery run between radio turns.
test("a dead Core stream still sends polls and reports the error", { timeout: 7_000 }, async () => {
  const failure = new Error("Core event stream ended");
  await exercise({ next() { throw failure; } }, async mesh => {
    await join(mesh);
    const poll = await Promise.race([mesh.next(), delay(1_800)]);
    assert.equal(poll?.kind, "poll");
    assert.equal(poll.event, undefined);
    assert.ok(mesh.errors.includes(failure));
  });
});

test("reports waiting behind a submission trigger a follow-up after storage", { timeout: 7_000 }, async () => {
  const storing = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  await exercise({ async store() { storing.resolve(); await release.promise; } }, async mesh => {
    await join(mesh);
    const poll = await mesh.next();
    assert.equal(poll.kind, "poll");
    await mesh.respond(poll, { waiting: true, submission: {
      id: 1, reports: [{ type: "report.settings", asset_id: "B", time: 1, settings: { lights: "off" } }],
    } });
    await storing.promise;
    const following = mesh.next();
    try {
      assert.equal(await Promise.race([following, delay(1_700)]), undefined, "no early follow-up while the submission was blocked");
    } finally {
      release.resolve();
    }
    const receipt = await following;
    assert.equal(receipt.kind, "poll");
    assert.deepEqual(receipt.receipt, { kind: "stored", id: 1 });
  }, 4_500);
});

for (const reason of ["event", "later waiting reply"] as const) {
  test(`a pending report defers the follow-up after ${reason}`, { timeout: 11_000 }, async () => {
    const storing = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    await exercise({
      next(_, after) {
        if (reason === "event" && after < 2) return {
          kind: "tasks.requested", event_id: 2, time: 1,
          record: [{ kind: "hold", task_id: 1, asset_id: "B", time: 1, requested_by: "OP" }],
        };
      },
      async store() { storing.resolve(); await release.promise; },
    }, async mesh => {
      await join(mesh);
      const poll = await mesh.next();
      assert.equal(poll.kind, "poll");
      assert.equal(Boolean(poll.event), reason === "event");
      await mesh.respond(poll, {
        cursor: reason === "event" ? 2 : 1,
        submission: { id: 1, reports: [
          { type: "report.status", kind: "task", asset_id: "B", time: 1, task_id: 1, task_state: "active" },
        ] },
      });
      await storing.promise;
      let receipt: Promise<Envelope>;
      try {
        if (reason === "later waiting reply") {
          const routine = await mesh.next();
          assert.equal(routine.kind, "poll");
          assert.equal(routine.receipt, undefined);
          await mesh.respond(routine, { waiting: true });
        }
        receipt = mesh.next();
        assert.equal(await Promise.race([receipt, delay(1_800)]), undefined, "follow-up ran before Core stored the report");
      } finally {
        release.resolve();
      }
      const following = await Promise.race([receipt, delay(1_800)]);
      assert.equal(following?.kind, "poll", "receipt waited for the routine poll");
      assert.deepEqual(following.receipt, { kind: "stored", id: 1 });
    }, 4_500);
  });
}

test("a failed replacement bind preserves the old app's offline deadline", { timeout: 19_000 }, async () => {
  const first = nonce(), replacement = nonce();
  const offline = Promise.withResolvers<{ lastHeard: number; at: number }>();
  let heardAt = 0;
  await exercise({
    async bind(_, profile) {
      if (profile.session === replacement) throw new Error("Core could not bind the replacement");
      return { run: 1, assetId: "B", after: 1, lastTaskId: 0 };
    },
    async contact(_, open, lastHeard) {
      if (open) heardAt = lastHeard;
      else offline.resolve({ lastHeard, at: Date.now() });
    },
  }, async mesh => {
    await join(mesh, first);
    const poll = await mesh.next();
    assert.equal(poll.kind, "poll");
    await mesh.respond(poll);
    mesh.announce(replacement);
    const register = await mesh.next();
    assert.equal(register.kind, "register");
    await mesh.respond(register);
    const result = await Promise.race([offline.promise, delay(15_000, undefined, { ref: false })]);
    assert.ok(result, "Core never heard that the old app went offline");
    assert.equal(result.lastHeard, heardAt);
    assert.ok(result.at - heardAt >= meshtasticTiming.offlineMs);
    assert.ok(result.at - heardAt < meshtasticTiming.offlineMs + 500);
  });
});

test("a replacement profile retires the previous radio app while Core binds it", { timeout: 7_000 }, async () => {
  const binding = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const first = nonce(), replacement = nonce();
  await exercise({
    async bind(_, profile) {
      if (profile.session === replacement) {
        binding.resolve();
        await release.promise;
      }
      return { run: 1, assetId: "B", after: 1, lastTaskId: 0 };
    },
  }, async mesh => {
    await join(mesh, first);
    const poll = await mesh.next();
    assert.equal(poll.kind, "poll");
    await mesh.respond(poll);
    mesh.announce(replacement);
    const register = await mesh.next();
    assert.equal(register.kind, "register");
    await mesh.respond(register);
    await binding.promise;
    const following = mesh.next();
    try {
      assert.equal(await Promise.race([following, delay(1_650)]), undefined, "the old app no longer receives polls");
    } finally {
      release.resolve();
    }
    const registered = await following;
    assert.equal(registered.kind, "registered");
    assert.equal(registered.boot, replacement);
  });
});

test("a removed Asset's contact triggers refusal before fetching more work", { timeout: 7_000 }, async () => {
  let reads = 0;
  await exercise({
    next() { reads++; throw new AssetRemoved("Asset removed"); },
    async contact() { throw new AssetRemoved("Asset removed"); },
  }, async mesh => {
    await join(mesh);
    const refusal = await mesh.next();
    assert.equal(refusal.kind, "refused");
    assert.equal(refusal.reason, "removed");
    assert.equal(reads, 0);
  });
});
