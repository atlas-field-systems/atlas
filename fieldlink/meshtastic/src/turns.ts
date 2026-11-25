export interface Timing {
  pollMs: number;
  timeoutMs: number;
  offlineMs: number;
}

export const meshtasticTiming: Timing = { pollMs: 6_500, timeoutMs: 2_300, offlineMs: 14_900 };
export const relayGapMs = 550;
export const eventReplyHoldMs = 150;
// One-frame submission observed in the relayed ShortTurbo simulator.
const pollSendMs = 450;
const unansweredExchange = (timing: Timing) => pollSendMs + timing.timeoutMs + eventReplyHoldMs;
// Reserve three successful turns, two unanswered turns, and 100 ms for scheduling overhead.
export const maxReplyTimeoutMs = ({ offlineMs }: Timing) =>
  Math.floor((offlineMs - 100 - 3 * (1_900 + eventReplyHoldMs + relayGapMs)) / 2) -
  pollSendMs - eventReplyHoldMs - relayGapMs;
const joinLifetimeMs = 20_000;
const pollInterval = (timing: Timing) => Math.min(timing.pollMs, (timing.offlineMs - unansweredExchange(timing) - relayGapMs) / 2);

type Joining = { kind: "joining"; dueAt: number; expires: number };
type Ready = {
  kind: "ready"; dueAt: number; heardAt: number; checkInBy: number;
  deadline?: number; retry?: "pending" | "exhausted"; work?: "queued" | "followup";
};
export type PeerTiming = Joining | Ready;
type Peer = { state: PeerTiming };

export const joining = (now: number): Joining => ({ kind: "joining", dueAt: now, expires: now + joinLifetimeMs });
export const seen = (state: Joining, now: number): Joining => ({ ...state, expires: now + joinLifetimeMs });
export const hasWork = (state: Ready): Ready => ({ ...state, work: state.work ?? "queued" });
export const wentOffline = (state: PeerTiming): PeerTiming => state.kind === "ready"
  ? { ...state, deadline: undefined } : state;
export function noReply(state: PeerTiming): PeerTiming {
  if (state.kind === "joining") return state;
  return { ...state, retry: state.deadline !== undefined && state.retry === undefined ? "pending" : "exhausted" };
}

export function began<T extends PeerTiming>(state: T, now: number, timing: Timing): T {
  const dueAt = now + pollInterval(timing);
  return state.kind === "ready" ? { ...state, dueAt, work: undefined } : { ...state, dueAt };
}

export function replied(state: PeerTiming, now: number, timing: Timing, followup = false): Ready {
  return {
    kind: "ready", dueAt: state.dueAt, heardAt: now, deadline: now + timing.offlineMs,
    // Cap clean poll gaps at 10 s and leave room for a lost exchange and retry.
    checkInBy: now + Math.min(timing.offlineMs / 2 + relayGapMs, timing.offlineMs - 2 * unansweredExchange(timing) - relayGapMs),
    work: followup ? "followup" : state.kind === "ready" ? state.work : undefined,
  };
}

export const canDeliver = (state: Ready) => state.deadline !== undefined;
export const observedTurn = (samples: readonly number[], duration: number) => [...samples.slice(-4), duration + relayGapMs];

export function nextTurn<T extends Peer>(roster: Iterable<T>, now: number, timing: Timing, samples: readonly number[], busy = false, awaitingContact?: { since: number }):
  | { kind: "expire" | "offline" | "exchange"; peer: T; deferred?: T }
  | { kind: "unheard"; since: number }
  | { kind: "wait"; until: number } {
  const peers = [...roster];
  const deadline = (peer: T) => peer.state.kind === "ready" ? peer.state.deadline ?? Infinity : Infinity;
  const established = peers.filter(peer => peer.state.kind === "ready").sort((a, b) => deadline(a) - deadline(b));
  const offline = established.find(peer => deadline(peer) <= now);
  if (offline) return { kind: "offline", peer: offline };
  const startupDeadline = awaitingContact ? awaitingContact.since + timing.offlineMs : Infinity;
  if (awaitingContact && startupDeadline <= now) return { kind: "unheard", since: awaitingContact.since };
  const nextDeadline = Math.min(established[0] ? deadline(established[0]) : Infinity, startupDeadline);
  if (busy) return { kind: "wait", until: nextDeadline };

  const expired = peers.find(peer => peer.state.kind === "joining" && peer.state.expires <= now);
  if (expired) return { kind: "expire", peer: expired };
  const healthy = established.filter(({ state }) =>
    state.kind === "ready" && state.deadline !== undefined && state.retry === undefined);
  const work = healthy.find(peer => peer.state.kind === "ready" && peer.state.work === "followup") ??
    healthy.find(peer => peer.state.kind === "ready" && peer.state.work);
  const due = healthy.find(({ state }) => state.kind === "ready" && Math.min(state.dueAt, state.checkInBy) <= now);
  const join = peers.find(peer => peer.state.kind === "joining" && peer.state.dueAt <= now);
  const retry = established.find(({ state }) => state.kind === "ready" &&
    (state.deadline === undefined ? state.dueAt <= now : state.retry === "pending"));
  const unansweredMs = unansweredExchange(timing) + relayGapMs;
  const turnMs = samples.length ? Math.max(...samples) : unansweredMs;
  const startBy = ({ state }: T) => {
    if (state.kind === "joining" || state.deadline === undefined || state.retry === "exhausted") return Infinity;
    // Start a pending retry before another unanswered exchange could use its slot.
    return state.retry === "pending" ? state.deadline - unansweredExchange(timing) - unansweredMs : state.checkInBy;
  };
  const candidate = join && now - join.state.dueAt >= timing.pollMs ? join : work ?? join ?? retry ?? due;
  if (candidate) {
    const checkIns = established.filter(peer => Number.isFinite(startBy(peer))).sort((a, b) => startBy(a) - startBy(b));
    const firstMs = candidate === retry ? Math.max(unansweredMs, turnMs) : turnMs;
    const others = checkIns.filter(peer => peer !== candidate);
    if (others.some((peer, index) => startBy(peer) < now + firstMs + index * turnMs))
      return { kind: "exchange", peer: checkIns[0], ...(candidate === join ? { deferred: join } : {}) };
    return { kind: "exchange", peer: candidate };
  }
  return { kind: "wait", until: Math.min(nextDeadline, ...peers.map(({ state }) => state.kind === "joining"
    ? Math.min(state.expires, state.dueAt) : state.deadline === undefined ? state.dueAt : state.retry === "exhausted"
      ? state.deadline : Math.min(state.dueAt, state.checkInBy))) };
}
