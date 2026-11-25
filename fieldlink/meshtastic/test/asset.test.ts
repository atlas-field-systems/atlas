import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import { test } from "node:test";
import { loadPackagedProtocol } from "@atlas/protocol";
import type { ReportSource } from "@atlas/sdk";
import { openAsset } from "../src/asset.ts";
import type { Radio } from "../src/radio.ts";
import { decodeFrames, encodeFrames, frameBytes, readFrame, type Envelope } from "../src/wire.ts";

test("a copter profile fits one frame and the Asset counts only current authenticated polls as contact", { timeout: 5_000 }, async t => {
  const { description } = JSON.parse(await readFile(new URL("../../../asset/examples/copter.json", import.meta.url), "utf8"));
  const { hash } = await loadPackagedProtocol();
  const gateway = "a".repeat(64);
  const session = "931b0fe67c85d24a";
  const failure = new AbortController();
  let now = 120;
  let receive: Parameters<Radio["receive"]>[0] | undefined;
  let discovery: Parameters<Radio["discover"]>[0] | undefined;
  const announced = Promise.withResolvers<string>();
  const announcing = Promise.withResolvers<void>();
  let sent = Promise.withResolvers<Envelope | undefined>();
  const radio: Radio = {
    failure: failure.signal,
    async send(_, bytes) {
      const frame = readFrame(bytes);
      assert.equal(frame?.total, 1);
      sent.resolve(decodeFrames([frame.body]));
    },
    announce(boot) { announced.resolve(boot); return announcing.promise; },
    receive(callback) { receive = callback; return () => { receive = undefined; }; },
    discover(callback) { discovery = callback; return () => { discovery = undefined; }; },
    async close() { failure.abort(); },
  };
  const opened = openAsset({ openRadio: async () => radio, gateway, profile: { description, hash }, signal: failure.signal, now: () => now,
    onRegister: () => () => {} });
  const boot = await announced.promise;
  const deliver = (packet: Envelope, from = gateway) => {
    for (const frame of encodeFrames(packet, Buffer.alloc(8, packet.seq))) receive?.(from, frame);
  };
  async function turn(packet: Envelope) {
    deliver(packet);
    const reply = await sent.promise;
    await new Promise(resolve => setImmediate(resolve));
    sent = Promise.withResolvers<Envelope | undefined>();
    return reply;
  }
  try {
    const register = turn({ kind: "register", session, seq: 1, boot });
    announcing.resolve();
    await register;
    await turn({ kind: "registered", session, seq: 2, boot, registration: { run: 1, assetId: "B", after: 1, lastTaskId: 0 } });
    const { link } = await opened;
    const heard: (number | null)[] = [];
    link.onContact(contact => heard.push(contact.last_heard));
    await turn({ kind: "poll", session, seq: 3, boot, roomBytes: frameBytes });
    now = 180;
    deliver({ kind: "poll", session, seq: 3, boot, roomBytes: frameBytes });
    deliver({ kind: "poll", session, seq: 4, boot, roomBytes: frameBytes }, "b".repeat(64));
    const otherSession = "42".repeat(8);
    discovery?.(gateway, otherSession, "beacon");
    deliver({ kind: "poll", session: otherSession, seq: 4, boot, roomBytes: frameBytes });
    await new Promise(resolve => setImmediate(resolve));
    now = 200;
    await turn({ kind: "poll", session, seq: 4, boot, roomBytes: frameBytes });
    assert.deepEqual(heard, [null, 120, 200]);
    await t.test("an event reply carries a newly active Task and leaves when the hold expires", async () => {
      let wake: Parameters<ReportSource["onWaiting"]>[0] | undefined;
      let batch: ReturnType<ReportSource["take"]>;
      const stop = link.serve({
        mustArriveWaiting: false,
        take: () => batch,
        onWaiting(callback) { wake = callback; return () => { wake = undefined; }; },
      });
      const events = link.events(1)[Symbol.asyncIterator]();
      async function request(seq: number) {
        const event = { kind: "tasks.requested", event_id: seq, record: [{
          kind: "settings", settings: { lights: "on" }, asset_id: "B", time: 1,
          task_id: seq, send_last: seq, requested_by: "ADM",
        }] } as const;
        const delivered = events.next();
        const response = turn({ kind: "poll", session, seq, boot, roomBytes: frameBytes,
          event: { ...event, record: [...event.record] }, receipt: { kind: "stored", id: 1 } });
        assert.equal((await delivered).value?.event_id, seq);
        return { response };
      }
      try {
        const { response } = await request(5);
        wake?.([{ type: "report.status", kind: "queue", task_ids: [5], asset_id: "B", time: 1, request_id: 5 }]);
        await delay(20);
        batch = { priority: "can_skip", settle() { batch = undefined; }, reports: [{
          type: "report.status", kind: "task", task_id: 5, asset_id: "B", time: 1, task_state: "active",
        }] };
        wake?.(batch.reports);
        const first = await response;
        assert.equal(first?.kind, "reply");
        assert.deepEqual(first.submission?.reports, batch.reports);
        const { response: expired } = await request(6);
        const second = await expired;
        assert.equal(second?.kind, "reply");
        assert.equal(second.cursor, 6);
        assert.equal(second.submission, undefined);
      } finally {
        await events.return?.();
        stop();
      }
    });
  } finally {
    failure.abort();
  }
});
