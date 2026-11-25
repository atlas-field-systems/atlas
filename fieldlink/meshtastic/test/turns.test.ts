import assert from "node:assert/strict";
import { test } from "node:test";
import { began, hasWork, joining, maxEventFrames, meshtasticTiming, nextTurn, noReply, observedTurn, relayGapMs, replied, requestProbe, wentOffline, type PeerTiming } from "../src/turns.ts";

const timing = meshtasticTiming;
const unanswered = timing.timeoutMs + 450;
const now = 20_000;
const ready = (name: string, heard = now - 3_000) =>
  ({ name, state: replied(began(joining(heard - 1_000), heard - 1_000, timing), heard, timing) });
const newcomer = { name: "new", state: joining(now) };

test("work goes ahead of a due check-in whenever the earlier deadline has room", () => {
  const asset = ready("task recipient");
  const work = { ...asset, state: hasWork(asset.state) };
  const due = ready("check-in", now - 6_000);
  assert.deepEqual(nextTurn([work, due], now, timing, observedTurn([], 1_200)), { kind: "exchange", peer: work });
  const urgent = ready("urgent", now - 9_000);
  assert.deepEqual(nextTurn([urgent, work], now, timing, []), { kind: "exchange", peer: urgent });
});

test("a maximum-size poll waits for at-risk check-ins and runs once they are fresh", () => {
  const asset = ready("Task recipient", now - 2_000);
  const work = { ...asset, state: hasWork(asset.state) };
  const older = ready("older check-in", now - 5_000);
  const newer = ready("newer check-in", now - 2_450);
  const samples = observedTurn([], 1_900);
  const frames = (peer: typeof work) => peer === work ? maxEventFrames(timing) : 1;
  assert.deepEqual(nextTurn([work, older, newer], now, timing, samples, false, Infinity, frames),
    { kind: "exchange", peer: older });
  older.state = replied(older.state, now - 550, timing);
  assert.deepEqual(nextTurn([work, older, newer], now, timing, samples, false, Infinity, frames),
    { kind: "exchange", peer: work });
});

test("a due Asset can check in while its own large poll waits", () => {
  const oldest = ready("earliest check-in", now - 6_000);
  const work = { ...oldest, state: hasWork(oldest.state) };
  const other = ready("next check-in", now - 5_000);
  const frames = (peer: typeof work) => peer === work ? maxEventFrames(timing) : 1;
  assert.deepEqual(nextTurn([work, other], now, timing, observedTurn([], 1_900), false, Infinity, frames),
    { kind: "exchange", peer: work, checkInOnly: true });
});

// fieldlink/meshtastic/README.md#first-implementation
for (const [name, durations] of [
  ["2,100 ms turns", [2_100]],
  ["2,300 ms turns", [2_300]],
  ["a slow two-frame reply in the sample window", [2_850, 2_100, 2_100]],
  ["turns at the end of the event reply window", [2_905]],
] as const) {
  test(`a maximum-size event gets a turn after ${name}`, () => {
    const recipient = ready("Task recipient", now - 500);
    recipient.state = hasWork(recipient.state);
    const peers = [ready("oldest", now - 5_000), ready("other", now - 3_000), recipient];
    const frames = (peer: typeof recipient) => peer === recipient ? maxEventFrames(timing) : 1;
    let samples = durations.reduce<number[]>((prior, duration) => observedTurn(prior, duration), []);
    let time = now;
    while (time - now < 10_000) {
      const turn = nextTurn(peers, time, timing, samples, false, Infinity, frames);
      assert.equal(turn.kind, "exchange");
      if (turn.peer === recipient && !turn.checkInOnly) return;
      const duration = durations[durations.length - 1];
      const replyAt = time + duration;
      turn.peer.state = replied(began(turn.peer.state, time, timing), replyAt, timing);
      if (turn.peer === recipient) recipient.state = hasWork(recipient.state);
      samples = observedTurn(samples, duration);
      time = replyAt + relayGapMs;
    }
    assert.fail("maximum-size event had no delivery turn within 10 seconds");
  });
}

// fieldlink/meshtastic/README.md#first-implementation
test("a discovery-due probe gets a turn despite a continuous report backlog", () => {
  const offline = wentOffline(ready("recovered").state);
  assert.equal(offline.kind, "ready");
  const recovered: { state: PeerTiming } = { state: requestProbe(offline, now) };
  const backlog: { state: PeerTiming } = { state: replied(ready("backlog", now - 5_000).state, now - 5_000, timing, true) };
  const other: { state: PeerTiming } = { state: ready("other", now - 3_000).state };
  const peers = [backlog, other, recovered];
  const samples = observedTurn([], 2_300);
  for (let time = now; time < now + 20_000; time += 2_300 + relayGapMs) {
    const turn = nextTurn(peers, time, timing, samples);
    assert.equal(turn.kind, "exchange");
    if (turn.peer === recovered) {
      assert.ok(time >= now + timing.pollMs);
      const checkIns = [backlog, other].map(({ state }) => {
        assert.equal(state.kind, "ready");
        return state.checkInBy;
      }).sort((a, b) => a - b);
      assert.ok(checkIns[0] >= time + 3_455);
      assert.ok(checkIns[1] >= time + 3_455 + 2_850);
      return;
    }
    turn.peer.state = replied(began(turn.peer.state, time, timing), time + 2_300, timing, turn.peer === backlog);
  }
  assert.fail("discovery-due probe was starved by the report backlog");
});

test("a reply with more work gets a follow-up ahead of other queued work", () => {
  const checkingIn = ready("check-in", now - 4_000);
  const queued = { ...checkingIn, state: hasWork(checkingIn.state) };
  const justReplied = { name: "reports waiting", state: replied(began(joining(now - 1_000), now - 1_000, timing), now, timing, true) };
  assert.deepEqual(nextTurn([queued, justReplied], now, timing, []), { kind: "exchange", peer: justReplied });
});

test("a fourth Asset can join when measured turns fit and gets a deferral otherwise", () => {
  const established = [ready("one", now - 6_000), ready("two", now - 3_600), ready("three", now - 1_800)];
  const peers = [...established, newcomer];
  assert.deepEqual(nextTurn(peers, now, timing, []), { kind: "exchange", peer: established[0], deferred: newcomer });
  assert.deepEqual(nextTurn(peers, now, timing, observedTurn([], 1_200)), { kind: "exchange", peer: newcomer });
  const fourth = ready("four", now);
  assert.deepEqual(nextTurn([...peers, fourth], now, timing, observedTurn([], 1_200)), { kind: "exchange", peer: newcomer });
});

test("one unanswered work poll can retry promptly before returning to ordinary retries", () => {
  const fresh = ready("Task recipient", now - 1_000);
  const state = noReply(began(fresh.state, now - 3_500, timing));
  assert.deepEqual(nextTurn([{ state }], now, timing, []), { kind: "exchange", peer: { state } });
  const retry = noReply(began(state, now, timing));
  assert.equal(nextTurn([{ state: retry }], now + 3_500, timing, []).kind, "wait");
});

test("offlining and retrying a silent Asset leave healthy check-ins eligible", () => {
  const asset = ready("silent", now - timing.offlineMs);
  const silent = { ...asset, state: noReply(began(asset.state, now - 6_000, timing)) };
  const healthy = ready("healthy", now - timing.pollMs);
  assert.deepEqual(nextTurn([silent, healthy], now - 2_000, timing, [], true), { kind: "wait", until: now });
  assert.deepEqual(nextTurn([silent, healthy], now, timing, [], true), { kind: "offline", peer: silent });
  const offline = { ...silent, state: wentOffline(silent.state) };
  assert.deepEqual(nextTurn([offline, healthy], now, timing, []), { kind: "exchange", peer: healthy });
});

// fieldlink/meshtastic/README.md#first-implementation
for (const fixture of [
  { name: "reviewer fixture", heardAt: [16_941, 19_388, 14_602], missingPoll: 22_297, readyAt: 26_297 },
  { name: "cut under Task load", heardAt: [14_000, 16_000, 12_500], missingPoll: 18_000, readyAt: 21_300 },
]) {
  test(`${fixture.name} keeps both healthy Assets online`, () => {
    const peers: { state: PeerTiming; pollAt: number }[] = fixture.heardAt.map(heard => ({
      state: replied(began(joining(heard - 1_000), heard - 1_000, timing), heard, timing),
      pollAt: heard - 1_000,
    }));
    const victim = peers[2];
    victim.state = noReply(began(victim.state, fixture.missingPoll, timing));
    let time = fixture.readyAt, taskAt = time, gaps = 0, misses = 1, expired = 0;
    const samples = observedTurn([], 1_900);

    function expire(peer: typeof victim) {
      assert.equal(peer, victim, `${fixture.name}: healthy Core contact expired at ${time} ms`);
      expired++;
      peer.state = wentOffline(peer.state);
    }

    while (time < fixture.readyAt + 30_000) {
      if (time >= taskAt) {
        const peer = peers[(taskAt - fixture.readyAt) / 5_000 % 2];
        if (peer.state.kind === "ready") peer.state = hasWork(peer.state);
        taskAt += 5_000;
      }
      const turn = nextTurn(peers, time, timing, samples);
      if (turn.kind === "wait") {
        const next = Math.min(taskAt, turn.until);
        assert.ok(next > time);
        time = next;
        continue;
      }
      if (turn.kind === "offline") {
        expire(turn.peer);
        continue;
      }
      assert.equal(turn.kind, "exchange");
      const { peer } = turn;
      const hasTask = peer.state.kind === "ready" && peer.state.work === "queued";
      const end = time + (peer === victim ? unanswered : 1_900);
      peer.state = began(peer.state, time, timing);
      for (;;) {
        const inFlight = nextTurn(peers, end, timing, samples, true);
        if (inFlight.kind !== "offline") break;
        expire(inFlight.peer);
      }
      if (peer === victim) {
        peer.state = noReply(peer.state);
        misses++;
      } else {
        gaps = Math.max(gaps, time - peer.pollAt);
        peer.pollAt = time;
        peer.state = replied(peer.state, end, timing, hasTask);
      }
      time = end + relayGapMs;
    }
    assert.equal(expired, 1);
    assert.ok(misses >= 2);
    assert.ok(gaps <= 14_000, `${fixture.name}: healthy poll gap was ${gaps} ms`);
  });
}

// fieldlink/meshtastic/README.md#first-implementation
test("isolated losses preserve Core contact when idle and under Task load", () => {
  for (const tasks of [false, true]) {
    for (let seed = 1; seed <= 200; seed++) {
      let random = seed;
      const rand = () => (random = (Math.imul(random, 1664525) + 1013904223) >>> 0) / 2 ** 32;
      const peers: { state: ReturnType<typeof noReply> }[] = [1_000, 2_800, 4_600].map(heard =>
        ({ state: ready("established", heard).state }));
      let time = 6_000;
      let nextTask = tasks ? time : Infinity;
      let lastLoss = -Infinity;
      let samples: number[] = [];
      while (time < 606_000) {
        while (nextTask <= time) {
          const peer = peers[Math.floor(rand() * peers.length)];
          if (peer.state.kind === "ready") peer.state = hasWork(peer.state);
          nextTask += 4_000 + 5_000 * rand();
        }
        const turn = nextTurn(peers, time, timing, samples);
        if (turn.kind === "wait") {
          time = Math.min(turn.until, nextTask);
          continue;
        }
        assert.equal(turn.kind, "exchange", `Core expired contact (seed ${seed}, Tasks ${tasks})`);
        const { peer } = turn;
        const work = peer.state.kind === "ready" && peer.state.work === "queued";
        peer.state = began(peer.state, time, timing);
        const misses = rand() < 0.05 && time - lastLoss >= 15_000;
        const duration = misses ? unanswered : 1_400 + 500 * rand();
        assert.equal(nextTurn(peers, time + duration, timing, samples, true).kind, "wait",
          `Core expired contact during an exchange (seed ${seed}, Tasks ${tasks})`);
        if (misses) {
          lastLoss = time;
          peer.state = noReply(peer.state);
        } else {
          samples = observedTurn(samples, duration);
          peer.state = replied(peer.state, time + duration, timing, work);
        }
        time += duration + 550;
      }
      assert.ok(Number.isFinite(lastLoss));
    }
  }
});

// fieldlink/meshtastic/README.md#first-implementation
test("three Assets check in during work and a join, with room to recover one lost poll", () => {
  for (const loseOne of [false, true]) {
    for (let seed = 1; seed <= 100; seed++) {
      let random = seed;
      const rand = () => (random = (Math.imul(random, 1664525) + 1013904223) >>> 0) / 2 ** 32;
      const peers: { state: ReturnType<typeof joining> | ReturnType<typeof replied>; heard?: number }[] = [
        ...[0, 1].map(i => ({ state: ready("established", 1000 + i * 2200).state, heard: 1000 + i * 2200 })),
        { state: joining(5_500) },
      ];
      let time = 4_400;
      let nextTask = 5_500;
      let polls = 0;
      let samples: number[] = [];
      while (time < 70_000) {
        while (nextTask <= time) {
          const peer = peers[Math.floor(rand() * peers.length)];
          if (peer.state.kind === "ready") peer.state = hasWork(peer.state);
          nextTask += 4_000 + 5_000 * rand();
        }
        const turn = nextTurn(peers, time, timing, samples);
        if (turn.kind === "wait") {
          time = Math.min(turn.until, nextTask);
          continue;
        }
        assert.equal(turn.kind, "exchange", `healthy peer went offline or failed to join (seed ${seed})`);
        const { peer } = turn;
        const work = peer.state.kind === "ready" && peer.state.work === "queued";
        peer.state = began(peer.state, time, timing);
        if (peer.state.kind === "ready" && ++polls === 5 + seed % 15 && loseOne) {
          time += unanswered;
          peer.state = noReply(peer.state);
        } else {
          if (peer.heard !== undefined && !loseOne)
            assert.ok(time - peer.heard <= 10_000, `poll gap ${time - peer.heard} ms (seed ${seed})`);
          peer.heard = time;
          const duration = 1_400 + 500 * rand();
          time += duration;
          samples = observedTurn(samples, duration);
          peer.state = replied(peer.state, time, timing, work);
        }
        time += 550;
      }
    }
  }
});

// fieldlink/meshtastic/README.md#first-implementation
test("a silent radio's unattended probes back off", () => {
  const probe = (state: PeerTiming, time: number) => noReply(began(state, time, timing));
  const offline = wentOffline(ready("silent").state);
  const first = probe(offline, now);
  const second = probe(first, now + 12_000);
  assert.ok(first.dueAt - now < second.dueAt - (now + 12_000));
  assert.equal(nextTurn([{ state: second }], now + 18_000, timing, []).kind, "wait");
});
