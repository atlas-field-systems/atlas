export interface Timing {
  pollMs: number;
  timeoutMs: number;
  offlineMs: number;
}

export const meshtasticTiming: Timing = { pollMs: 6_500, timeoutMs: 2_300, offlineMs: 14_900 };
export const relayGapMs = 550;
export const eventReplyHoldMs = 150;
// A full frame uses 365 ms plus 0.5 ms per byte in the relayed ShortTurbo simulator.
const pollSendMs = 455;
const eventExchange = (timing: Timing, frames: number) => frames * pollSendMs + timing.timeoutMs + eventReplyHoldMs;
const unansweredExchange = (timing: Timing) => eventExchange(timing, 1);
const singleFrameTurn = (timing: Timing) => unansweredExchange(timing) + relayGapMs;
const checkInWindow = (timing: Timing) =>
  Math.min(timing.offlineMs / 2 + relayGapMs, timing.offlineMs - 2 * unansweredExchange(timing) - relayGapMs);

// From the first Asset's reply, allow its relay gap, the second Asset's full
// single-frame turn, and the event turn before the first Asset must check in again.
export const maxEventFrames = (timing: Timing) => Math.max(1, 1 + Math.floor(
  (checkInWindow(timing) - relayGapMs - 2 * singleFrameTurn(timing)) / pollSendMs,
));
// Reserve three typical successful turns, two unanswered turns, and 100 ms for scheduling overhead.
const successfulExchangeMs = 1_900;
export const maxReplyTimeoutMs = ({ offlineMs }: Timing) =>
  Math.floor((offlineMs - 100 - 3 * (successfulExchangeMs + eventReplyHoldMs + relayGapMs)) / 2) -
  pollSendMs - eventReplyHoldMs - relayGapMs;
const joinLifetimeMs = 20_000;
const pollInterval = (timing: Timing) => Math.min(timing.pollMs, (timing.offlineMs - unansweredExchange(timing) - relayGapMs) / 2);

type Joining = { kind: "joining"; dueAt: number; expires: number };
type Ready = {
  kind: "ready"; dueAt: number; heardAt: number; checkInBy: number;
  deadline?: number; probeInterval?: number; probeRequested?: true; retry?: "pending" | "exhausted"; work?: "queued" | "followup";
};
export type PeerTiming = Joining | Ready;
type Peer = { state: PeerTiming };

export const joining = (now: number): Joining => ({ kind: "joining", dueAt: now, expires: now + joinLifetimeMs });
export const seen = (state: Joining, now: number): Joining => ({ ...state, expires: now + joinLifetimeMs });
export const hasWork = (state: Ready): Ready => ({ ...state, work: state.work ?? "queued" });
export const requestProbe = (state: Ready, now: number): Ready =>
  state.probeRequested ? state : { ...state, dueAt: now, probeRequested: true };
export const wentOffline = (state: PeerTiming): PeerTiming => state.kind === "ready"
  ? { ...state, deadline: undefined } : state;
export function noReply(state: PeerTiming): PeerTiming {
  if (state.kind === "joining") return state;
  return { ...state, retry: state.deadline !== undefined && state.retry === undefined ? "pending" : "exhausted" };
}

export function began<T extends PeerTiming>(state: T, now: number, timing: Timing): T {
  const interval = pollInterval(timing);
  if (state.kind === "joining") return { ...state, dueAt: now + interval };
  if (state.deadline !== undefined) return { ...state, dueAt: now + interval, work: undefined };
  const probeInterval = Math.min(30_000, 2 * (state.probeInterval ?? interval));
  return { ...state, dueAt: now + probeInterval, work: undefined, probeInterval, probeRequested: undefined };
}

export function replied(state: PeerTiming, now: number, timing: Timing, followup = false): Ready {
  return {
    kind: "ready", dueAt: state.dueAt, heardAt: now, deadline: now + timing.offlineMs,
    // Cap clean poll gaps at 10 s and leave room for a lost exchange and retry.
    checkInBy: now + checkInWindow(timing),
    work: followup ? "followup" : state.kind === "ready" ? state.work : undefined,
  };
}

export const canDeliver = (state: Ready) => state.deadline !== undefined;
// Multi-frame polls have their own budget and do not change the routine check-in estimate.
export const observedTurn = (samples: number[], duration: number, frames = 1) =>
  frames === 1 ? [...samples.slice(-4), duration + relayGapMs] : samples;

export function nextTurn<T extends Peer>(roster: Iterable<T>, now: number, timing: Timing, samples: readonly number[], busy = false, startupDeadline = Infinity, pollFrames: (peer: T) => number = () => 1):
  | { kind: "expire"; peer: T }
  | { kind: "offline"; peer: T }
  | { kind: "exchange"; peer: T; deferred?: T; checkInOnly?: true }
  | { kind: "unheard" }
  | { kind: "wait"; until: number } {
  const peers = [...roster];
  const deadline = (peer: T) => peer.state.kind === "ready" ? peer.state.deadline ?? Infinity : Infinity;
  const established = peers.filter(peer => peer.state.kind === "ready").sort((a, b) => deadline(a) - deadline(b));
  const offline = established.find(peer => deadline(peer) <= now);
  if (offline) return { kind: "offline", peer: offline };
  if (startupDeadline <= now) return { kind: "unheard" };
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
  const overdueProbe = established.find(({ state }) => state.kind === "ready" &&
    state.deadline === undefined && state.probeRequested && now - state.dueAt >= timing.pollMs);
  const unansweredMs = singleFrameTurn(timing);
  const turnMs = samples.length ? Math.max(...samples) : unansweredMs;
  const startBy = ({ state }: T) => {
    if (state.kind === "joining" || state.deadline === undefined || state.retry === "exhausted") return Infinity;
    // Start a pending retry before another unanswered exchange could use its slot.
    return state.retry === "pending" ? state.deadline - unansweredExchange(timing) - unansweredMs : state.checkInBy;
  };
  const candidate = join && now - join.state.dueAt >= timing.pollMs ? join : overdueProbe ?? work ?? join ?? retry ?? due;
  if (candidate) {
    const checkIns = established.filter(peer => Number.isFinite(startBy(peer))).sort((a, b) => startBy(a) - startBy(b));
    const fits = (peer: T, frames: number) => {
      const firstMs = Math.max(turnMs, frames > 1 ? eventExchange(timing, frames) + relayGapMs :
        peer === retry || peer === overdueProbe ? unansweredMs : 0);
      return checkIns.filter(other => other !== peer)
        .every((other, index) => startBy(other) >= now + firstMs + index * turnMs);
    };
    if (!fits(candidate, pollFrames(candidate))) {
      const peer = checkIns[0];
      const frames = pollFrames(peer);
      return {
        kind: "exchange", peer,
        ...(candidate === join ? { deferred: join } : {}),
        ...(frames > 1 && !fits(peer, frames) ? { checkInOnly: true } : {}),
      };
    }
    return { kind: "exchange", peer: candidate };
  }
  return { kind: "wait", until: Math.min(nextDeadline, ...peers.map(({ state }) => state.kind === "joining"
    ? Math.min(state.expires, state.dueAt) : state.deadline === undefined ? state.dueAt : state.retry === "exhausted"
      ? state.deadline : Math.min(state.dueAt, state.checkInBy))) };
}
