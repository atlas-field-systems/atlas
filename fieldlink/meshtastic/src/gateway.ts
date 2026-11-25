import { setTimeout as delay } from "node:timers/promises";
import { loadPackagedProtocol } from "@atlas/protocol";
import type { Report } from "@atlas/sdk";
import { AssetRemoved, ReportRefused, type GatewayHost, type Registration } from "./gateway-host.ts";
import { nonce, receiveEnvelopes, sendEnvelope, type Radio } from "./radio.ts";
import {
  began, canDeliver, eventReplyHoldMs, hasWork, joining, maxReplyTimeoutMs, meshtasticTiming,
  nextTurn, noReply, observedTurn, relayGapMs,
  replied, seen, wentOffline, type PeerTiming, type Timing,
} from "./turns.ts";
import { frameBytes, isDescription, isReport, maxReplyFrames, wireSize, type Envelope } from "./wire.ts";

type Poll = Extract<Envelope, { kind: "poll" }>;
type Binding = { registration: Registration; cursor: number; receipt?: Poll["receipt"]; oversize?: number; storing?: { followup: boolean } };
type Peer = {
  key: string; boot: string; state: PeerTiming;
  binding?: Binding;
  refusal?: "definitions" | "removed";
  deferred?: true;
};

export async function serveGateway({ radio, host, timing = meshtasticTiming, signal: lifetime, now = Date.now, onError }: {
  radio: Radio; host: GatewayHost; timing?: Timing; signal: AbortSignal; now?: () => number; onError?: (error: unknown) => void;
}) {
  if (![timing.pollMs, timing.timeoutMs, timing.offlineMs].every(n => Number.isSafeInteger(n) && n > 0) ||
      timing.timeoutMs > maxReplyTimeoutMs(timing)) throw new Error("Invalid radio timing");
  const started = Date.now();
  const startupTime = now();
  const toContactTime = (time: number) => startupTime + time - started;
  const protocol = await loadPackagedProtocol();
  const signal = AbortSignal.any([lifetime, radio.failure]);
  const roster = await host.carried().catch(error => lifetime.aborted ? [] : Promise.reject(error));
  const unheard = new Map(roster.map(({ assetId, lastHeard = startupTime }) => [assetId, {
    lastHeard,
    // Translate the roster's timestamp into the scheduler's time domain.
    deadline: started + Math.min(0, lastHeard - startupTime) + timing.offlineMs,
  }]));
  if (lifetime.aborted) return;
  const peers = new Map<string, Peer>();
  const session = nonce();
  const since = Date.now();
  // Assets already on this gateway session ignore its remaining beacons.
  const beacons = [0, 2_000, 4_000].map((offset, index) => ({
    at: since + offset, id: `${session.slice(0, -2)}0${index}`,
  }));
  const keyFor = ({ key, boot }: { key: string; boot: string }) => `${key}:${boot}`;
  let seq = 0;
  let times: number[] = [];
  let wake: AbortController | undefined;
  let running: Promise<void> | undefined;
  let waiting: { peer: string; register: boolean; resolve: (packet: Envelope) => void } | undefined;
  const operations = new Set<Promise<void>>();
  const bindingPeers = new Set<string>();
  const contacts = new Map<string, AbortController>();
  const reportError = (error: unknown) => { if (!signal.aborted) onError?.(error); };
  const stopReceive = receiveEnvelopes(radio, key => waiting?.peer === key, (key, packet) => {
    if (packet.session === session && packet.seq === seq && waiting?.peer === key) waiting.resolve(packet);
  }, count => waiting?.register === true || count <= maxReplyFrames);
  const stopDiscover = radio.discover((key, boot, kind) => {
    if (kind !== "discovery" || bindingPeers.has(key)) return;
    const id = keyFor({ key, boot });
    const prior = peers.get(id);
    const now = Date.now();
    if (prior) {
      if (prior.state.kind === "joining") prior.state = seen(prior.state, now);
      else if (!canDeliver(prior.state)) {
        prior.state = { ...prior.state, dueAt: now };
        wake?.abort();
      }
      return;
    }
    if ([...peers.values()].filter(peer => peer.state.kind === "joining").length >= 8) return;
    peers.set(id, { key, boot, state: joining(now) });
    wake?.abort();
  });
  const stopEvents = host.onEvent(assetId => {
    for (const peer of peers.values()) {
      if (peer.state.kind === "ready" && peer.binding?.registration.assetId === assetId) {
        peer.state = hasWork(peer.state);
        wake?.abort();
      }
    }
  });

  function requestFailed(error: unknown, peer?: Peer) {
    if (peer && error instanceof AssetRemoved && peers.get(keyFor(peer)) === peer) {
      peer.refusal = "removed";
      peer.state = joining(Date.now());
    } else if (!(error instanceof AssetRemoved)) reportError(error);
  }

  function background(work: Promise<void>, peer?: Peer) {
    const operation = work.catch(error => requestFailed(error, peer)).finally(() => {
      operations.delete(operation);
      wake?.abort();
    });
    operations.add(operation);
  }

  function contact(assetId: string, open: boolean, lastHeard: number, peer?: Peer) {
    if (open) unheard.delete(assetId);
    contacts.get(assetId)?.abort();
    const attempt = new AbortController();
    contacts.set(assetId, attempt);
    const retrySignal = AbortSignal.any([signal, attempt.signal]);
    background((async () => {
      let backoff = 250;
      try {
        while (!retrySignal.aborted) {
          try {
            await host.contact(assetId, open, lastHeard);
            return;
          } catch (error) {
            if (error instanceof AssetRemoved) throw error;
            reportError(error);
          }
          await delay(backoff, undefined, { signal: retrySignal }).catch(() => {});
          backoff = Math.min(backoff * 2, 5_000);
        }
      } finally {
        if (contacts.get(assetId) === attempt) contacts.delete(assetId);
      }
    })(), peer);
  }

  async function exchange(peer: Peer, packet: Envelope) {
    const timeout = timing.timeoutMs + (packet.kind === "poll" && packet.event ? eventReplyHoldMs : 0);
    const reply = Promise.withResolvers<Envelope | undefined>();
    waiting = { peer: peer.key, register: packet.kind === "register", resolve: reply.resolve };
    try {
      await sendEnvelope(radio, peer.key, packet, signal);
      const limit = AbortSignal.any([signal, AbortSignal.timeout(timeout)]);
      const abort = () => reply.resolve(undefined);
      limit.addEventListener("abort", abort, { once: true });
      if (limit.aborted) abort();
      try {
        const received = await reply.promise;
        if (received?.boot === peer.boot && peers.get(keyFor(peer)) === peer) return received;
      } finally {
        limit.removeEventListener("abort", abort);
      }
    } finally {
      waiting = undefined;
    }
  }

  async function perform(peer: Peer, started: number) {
    const address = { session, seq: ++seq, boot: peer.boot };
    peer.state = began(peer.state, started, timing);
    const binding = peer.binding;
    if (peer.refusal) {
      peers.delete(keyFor(peer));
      await sendEnvelope(radio, peer.key, { kind: "refused", ...address, reason: peer.refusal }, signal);
      return;
    }
    const assetId = binding?.registration.assetId;
    let event: ReturnType<GatewayHost["next"]>;
    if (peer.state.kind === "ready" && canDeliver(peer.state) && binding && assetId) {
      try {
        event = host.next(assetId, binding.cursor);
      } catch (error) {
        if (error instanceof AssetRemoved) throw error;
        reportError(error);
      }
    }
    const poll: Poll = { kind: "poll", ...address, receipt: binding?.receipt, event, roomBytes: frameBytes };
    if (event && wireSize(poll) === Infinity && binding) {
      delete poll.event;
      if (binding.oversize !== event.event_id) {
        binding.oversize = event.event_id;
        reportError(new RangeError(`Event ${event.event_id} exceeds the transfer limit for Asset ${assetId}`));
      }
    }
    const packet: Envelope = !binding ? { kind: "register", ...address } : peer.state.kind === "joining"
      ? { kind: "registered", ...address, registration: binding.registration } : poll;
    const reply = await exchange(peer, packet);
    const received = Date.now();
    if (reply) times = observedTurn(times, received - started);
    const heardAt = toContactTime(received);
    if (packet.kind === "register" && reply?.kind === "profile") {
      bindingPeers.add(peer.key);
      background((async () => {
        try {
          if (reply.hash !== protocol.hash) {
            await host.refuseDefinitions(peer.key, { hash: reply.hash, session: peer.boot });
            peer.refusal = "definitions";
          } else if (isDescription(protocol, reply.description)) {
            const { hash, description, resume } = reply;
            for (const [id, prior] of peers) {
              if (prior === peer || prior.key !== peer.key) continue;
              peers.delete(id);
              const assetId = prior.binding?.registration.assetId;
              if (assetId && prior.state.kind === "ready" && prior.state.deadline !== undefined) {
                contacts.get(assetId)?.abort();
                unheard.set(assetId, { deadline: prior.state.deadline, lastHeard: toContactTime(prior.state.heardAt) });
              }
            }
            const registration = await host.bind(peer.key, { session: peer.boot, hash, description, resume });
            if (signal.aborted) return;
            peer.binding = { registration, cursor: registration.after };
            if (resume?.run === registration.run && resume.assetId === registration.assetId) {
              peer.state = hasWork(replied(peer.state, received, timing));
              contact(registration.assetId, true, heardAt, peer);
              return;
            }
          } else return;
          peer.state = joining(Date.now());
        } finally {
          bindingPeers.delete(peer.key);
        }
      })(), peer);
      return;
    }
    if (!binding || !assetId || reply?.kind !== "reply") {
      peer.state = noReply(peer.state);
      return;
    }
    const submission = reply.submission;
    const toStore = submission && !binding.storing && submission.id > (binding.receipt?.id ?? 0)
      ? submission : undefined;
    const followup = Boolean(poll.event || reply.waiting);
    if (binding.storing && followup) binding.storing.followup = true;
    const state = replied(peer.state, received, timing, followup && !binding.storing && !toStore);
    peer.state = packet.kind === "registered" ? hasWork(state) : state;
    contact(assetId, true, heardAt, peer);
    wake?.abort();
    if (poll.event && event && reply.cursor >= event.event_id) binding.cursor = reply.cursor;
    if (toStore) {
      const storing = { followup };
      binding.storing = storing;
      background((async () => {
        try {
          if (!toStore.reports.every((report): report is Report => isReport(protocol, report) && report.asset_id === assetId))
            throw new ReportRefused("Invalid report submission");
          await host.store(assetId, toStore.id, toStore.reports);
          binding.receipt = { kind: "stored", id: toStore.id };
        } catch (error) {
          if (!(error instanceof ReportRefused)) throw error;
          binding.receipt = { kind: "refused", id: toStore.id };
        } finally {
          delete binding.storing;
        }
        if (storing.followup && peer.state.kind === "ready" && peers.get(keyFor(peer)) === peer)
          peer.state = hasWork(peer.state);
      })(), peer);
    }
  }

  try {
    while (!signal.aborted) {
      const now = Date.now();
      const beacon = beacons[0];
      const beaconAt = beacon?.at ?? Infinity;
      const eligible = [...peers.values()].filter(peer => peer.state.kind === "ready" || !bindingPeers.has(peer.key));
      const startupDeadline = Math.min(...[...unheard.values()].map(asset => asset.deadline));
      const scheduled = nextTurn(eligible, now, timing, times, running !== undefined, startupDeadline);
      const turn = !running && beacon && beaconAt <= now && (scheduled.kind === "wait" || scheduled.kind === "exchange")
        ? { kind: "beacon" as const, id: beacon.id } : scheduled;
      if (turn.kind === "wait") {
        wake = new AbortController();
        const interrupt = AbortSignal.any([signal, wake.signal]);
        const until = running ? turn.until : Math.min(turn.until, beaconAt);
        if (Number.isFinite(until)) await delay(Math.max(1, until - now), undefined, { signal: interrupt }).catch(() => {});
        else await new Promise<void>(resolve => interrupt.addEventListener("abort", () => resolve(), { once: true }));
        wake = undefined;
      } else if (turn.kind === "unheard") {
        for (const [assetId, { deadline, lastHeard }] of unheard) {
          if (deadline > now) continue;
          unheard.delete(assetId);
          contact(assetId, false, lastHeard);
        }
      } else if (turn.kind === "expire") peers.delete(keyFor(turn.peer));
      else if (turn.kind === "offline") {
        const { binding, state } = turn.peer;
        turn.peer.state = wentOffline(state);
        if (binding && state.kind === "ready")
          contact(binding.registration.assetId, false, toContactTime(state.heardAt), turn.peer);
      } else {
        const deferred = turn.kind === "exchange" ? turn.deferred : undefined;
        if (deferred && !deferred.deferred) {
          deferred.deferred = true;
          reportError(new Error(`Radio join deferred for capacity: ${deferred.key}`));
        }
        if (turn.kind === "beacon") beacons.shift();
        const peer = turn.kind === "exchange" ? turn.peer : undefined;
        running = (turn.kind === "beacon" ? radio.announce(turn.id) : perform(turn.peer, now))
          .catch(error => requestFailed(error, peer)).then(() => delay(relayGapMs, undefined, { signal }).catch(() => {})).finally(() => {
          running = undefined;
          wake?.abort();
        });
      }
    }
  } finally {
    stopReceive();
    stopDiscover();
    stopEvents();
    await running;
    await Promise.allSettled(operations);
  }
  if (!lifetime.aborted) radio.failure.throwIfAborted();
}
