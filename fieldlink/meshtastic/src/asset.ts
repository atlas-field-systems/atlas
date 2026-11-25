import { once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";
import { loadPackagedProtocol } from "@atlas/protocol";
import type { AssetEvent, AssetLink, Batch, ReportSource } from "@atlas/sdk";
import type { Description, Registration } from "./gateway-host.ts";
import { nonce, receiveEnvelopes, sendEnvelope, type Radio } from "./radio.ts";
import { eventReplyHoldMs, meshtasticTiming, relayGapMs } from "./turns.ts";
import { frameBytes, isDescription, isEvent, maxReplyFrames, wireSize, type Envelope } from "./wire.ts";

type Profile = { hash: string; description: Description };
const profileLimit = `Meshtastic registration reply must fit in ${maxReplyFrames} frames`;

export function assetProfileSizeError({ hash, description }: Profile) {
  // Budget for a resume with full-width IDs and counters as well as a fresh join.
  if (wireSize({
    kind: "profile", session: "17fc3895a6db042e", seq: Number.MAX_SAFE_INTEGER,
    boot: "adf032eb68914c75", hash, description,
    resume: { run: 8192164095374826, assetId: "X7KM", after: 7619230584610375, lastTaskId: 9999 },
  }) > maxReplyFrames * frameBytes) return profileLimit;
}

type GatewayTurn = Extract<Envelope, { kind: "register" | "registered" | "refused" | "poll" }>;
const rediscoverMs = meshtasticTiming.offlineMs + relayGapMs;

export async function openAsset({ openRadio, gateway, profile, signal: lifetime, offlineMs = meshtasticTiming.offlineMs, now = Date.now, onError, onRegister }: {
  openRadio(signal: AbortSignal): Promise<Radio>; gateway: string; profile: Profile;
  signal: AbortSignal; offlineMs?: number; now?: () => number; onError?: (error: unknown) => void;
  onRegister(registration: Registration, link: AssetLink): () => void;
}) {
  const controller = new AbortController();
  const failure = controller.signal;
  const signal = AbortSignal.any([lifetime, failure]);
  if (!/^(?!0{64}$)[a-f0-9]{64}$/.test(gateway)) throw new Error("Configure the gateway radio public key");
  if (!Number.isSafeInteger(offlineMs) || offlineMs <= 0) throw new Error("Invalid radio contact deadline");
  const protocol = await loadPackagedProtocol();
  signal.throwIfAborted();
  if (profile.hash !== protocol.hash || !isDescription(protocol, profile.description))
    throw new Error("Invalid radio Asset profile");
  const sizeError = assetProfileSizeError(profile);
  if (sizeError) throw new RangeError(sizeError);

  const boot = nonce();
  const ready = Promise.withResolvers<void>();
  const retired = new Set<string>();
  void ready.promise.catch(() => {});
  let session: string | undefined;
  let binding: { registration: Registration; stop?: () => void } | undefined;
  let sequence = 0, cursor = 0, submission = 0;
  let event: AssetEvent | undefined;
  let available = Promise.withResolvers<void>();
  let source: ReportSource | undefined;
  let pending: { id: number; batch: Batch } | undefined;
  let lastHeard: number | null = null;
  let expiry: NodeJS.Timeout | undefined;
  let discovery: NodeJS.Timeout | undefined;
  let retry = 5_000;
  let reopenDelay = 500;
  let inTurn: Promise<void> | undefined;
  let announcing: Promise<void> | undefined;
  const contacts = new Set<Parameters<AssetLink["onContact"]>[0]>();
  const contact = () => ({ open: !signal.aborted && expiry !== undefined, last_heard: lastHeard });
  const publish = () => { for (const listener of contacts) listener(contact()); };
  const reportError = (error: unknown) => { if (!signal.aborted) onError?.(error); };

  function endBinding() {
    pending?.batch.settle({ ok: false, error: "lost", explanation: "Fieldlink session ended" });
    pending = undefined;
    binding?.stop?.();
    binding = undefined;
    event = undefined;
    available.resolve();
    available = Promise.withResolvers<void>();
  }

  const link: AssetLink = {
    async *events(after) {
      const current = binding;
      cursor = Math.max(after, cursor);
      while (!signal.aborted && current === binding) {
        await available.promise;
        if (signal.aborted || current !== binding) break;
        const incoming = event;
        event = undefined;
        available = Promise.withResolvers<void>();
        if (incoming && incoming.event_id > cursor) {
          cursor = incoming.event_id;
          yield incoming;
        }
      }
      if (!lifetime.aborted) failure.throwIfAborted();
    },
    serve(reports) {
      source = reports;
      return () => { if (source === reports) source = undefined; };
    },
    onContact(listener) {
      contacts.add(listener);
      listener(contact());
      return () => { contacts.delete(listener); };
    },
    async storeFile() {
      return { ok: false, error: "unsupported", explanation: "Meshtastic does not carry Atlas files" };
    },
  };

  async function handle(radio: Radio, announce: () => void, transport: AbortSignal, packet: GatewayTurn) {
    const turn = { session: packet.session, seq: packet.seq, boot };
    sequence = packet.seq;
    if (packet.kind === "register") {
      if (session !== packet.session) {
        if (session) retired.add(session);
        session = packet.session;
      }
      clearTimeout(discovery);
      discovery = setTimeout(announce, rediscoverMs);
      const resume = binding && { ...binding.registration, after: cursor };
      const reply: Envelope = { kind: "profile", ...turn, ...profile, resume };
      if (wireSize(reply) > maxReplyFrames * frameBytes) {
        controller.abort(new RangeError(profileLimit));
        return;
      }
      await sendEnvelope(radio, gateway, reply, transport);
      return;
    }
    if (packet.kind === "refused") {
      controller.abort(new Error(packet.reason === "definitions" ?
        "Gateway refused incompatible Protocol definitions" : "Core removed the radio Asset"));
      return;
    }
    if (packet.kind === "registered") {
      const { registration } = packet;
      if (binding?.registration.run !== registration.run || binding.registration.assetId !== registration.assetId) {
        endBinding();
        submission = 0;
        binding = { registration };
        cursor = registration.after;
        binding.stop = onRegister(registration, link);
        ready.resolve();
      }
    }
    if (!binding) return;
    const reply: Extract<Envelope, { kind: "reply" }> = { kind: "reply", ...turn, cursor };
    if (packet.kind === "poll") {
      lastHeard = now();
      clearTimeout(expiry);
      clearTimeout(discovery);
      retry = 5_000;
      reopenDelay = 500;
      expiry = setTimeout(() => {
        expiry = undefined;
        publish();
      }, offlineMs);
      discovery = setTimeout(announce, rediscoverMs);
      publish();
      if (pending && packet.receipt?.id === pending.id) {
        pending.batch.settle(packet.receipt.kind === "stored" ? { ok: true } :
          { ok: false, error: "refused", explanation: "Gateway refused the report batch" });
        pending = undefined;
      }
      const incoming = packet.event;
      if (!event && isEvent(protocol, binding.registration.assetId, incoming) && incoming.event_id > cursor) {
        const applied = new AbortController();
        const stopWaiting = source?.onWaiting(added => {
          if (added?.some(report => incoming.kind === "tasks.requested"
            ? report.type === "report.status" && report.kind === "task" && report.task_state === "active" &&
              incoming.record.some(task => task.task_id === report.task_id)
            : "request_id" in report && report.request_id === incoming.event_id)) applied.abort();
        });
        event = incoming;
        available.resolve();
        await delay(eventReplyHoldMs, undefined, { signal: AbortSignal.any([applied.signal, transport]) }).catch(() => {});
        stopWaiting?.();
        // Core may drop unaccepted work before the next poll. Only the gateway
        // can deliver it again.
        if (event === incoming) {
          event = undefined;
          available = Promise.withResolvers<void>();
        }
        reply.cursor = cursor;
      }
      if (!pending) {
        const id = submission + 1;
        const batch = source?.take({ bytes: packet.roomBytes, size: reports => wireSize({ ...reply, waiting: true, submission: { id, reports } }) });
        if (batch) pending = { id: ++submission, batch };
      }
      if (source?.mustArriveWaiting) reply.waiting = true;
      if (pending) {
        reply.submission = { id: pending.id, reports: pending.batch.reports };
        if (wireSize(reply) > maxReplyFrames * frameBytes) {
          pending.batch.settle({ ok: false, error: "refused", explanation: "Report batch exceeds the Fieldlink transfer limit" });
          pending = undefined;
          delete reply.submission;
          if (!source?.mustArriveWaiting) delete reply.waiting;
        }
      }
    }
    await sendEnvelope(radio, gateway, reply, transport);
  }
  function disconnect() {
    clearTimeout(expiry);
    clearTimeout(discovery);
    expiry = undefined;
    publish();
  }
  signal.addEventListener("abort", () => {
    endBinding();
    ready.reject(signal.reason);
    disconnect();
  }, { once: true });

  async function listen(radio: Radio) {
    const transport = AbortSignal.any([signal, radio.failure]);
    function announce() {
      if (transport.aborted) return;
      if (inTurn || announcing) {
        discovery = setTimeout(announce, relayGapMs);
        return;
      }
      announcing = radio.announce(boot, gateway).catch(reportError).finally(() => { announcing = undefined; });
      discovery = setTimeout(announce, retry + Math.random() * 2_000);
      retry = Math.min(30_000, retry * 2);
    }
    const stop = receiveEnvelopes(radio, peer => peer === gateway, (_, packet) => {
      if (transport.aborted || inTurn || packet.boot !== boot || packet.kind === "profile" || packet.kind === "reply") return;
      if ((packet.kind === "register" ? retired.has(packet.session) : packet.session !== session) ||
          (packet.session === session && packet.seq <= sequence)) return;
      inTurn = Promise.resolve(announcing).then(() => {
        if (!transport.aborted) return handle(radio, announce, transport, packet);
      }).catch(reportError).finally(() => { inTurn = undefined; });
    });
    let beacon: string | undefined;
    const stopDiscovery = radio.discover((peer, nonce, kind) => {
      if (kind !== "beacon" || peer !== gateway || !binding || nonce === beacon || nonce.slice(0, -2) === session?.slice(0, -2)) return;
      beacon = nonce;
      retry = 5_000;
      clearTimeout(discovery);
      discovery = setTimeout(announce, relayGapMs * Math.random() * 3);
    });
    try {
      announce();
      if (!transport.aborted) await once(transport, "abort");
      radio.failure.throwIfAborted();
    } finally {
      stop();
      stopDiscovery();
      if (!signal.aborted) disconnect();
    }
  }

  async function reconnect(initial: Radio) {
    let radio: Radio | undefined = initial;
    while (true) {
      try {
        radio ??= await openRadio(signal);
        if (!signal.aborted) await listen(radio);
      } catch (error) {
        reportError(error);
      } finally {
        await radio?.close().catch(reportError);
        radio = undefined;
        await Promise.allSettled([inTurn, announcing]);
      }
      if (signal.aborted) return;
      await delay(reopenDelay, undefined, { signal }).catch(() => {});
      if (signal.aborted) return;
      reopenDelay = Math.min(8_000, reopenDelay * 2);
    }
  }

  const done = reconnect(await openRadio(signal));
  try {
    await ready.promise;
    return { link, failure, done };
  } catch (error) {
    await done;
    throw error;
  }
}
