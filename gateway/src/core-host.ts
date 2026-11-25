import { AsyncLocalStorage } from "node:async_hooks";
import { createHash, randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { loadPackagedProtocol } from "@atlas/protocol";
import { createClient, follow, systemClock } from "@atlas/sdk";
import type { AssetEvent, AtlasEvent, Follow, Result } from "@atlas/sdk";
import { AssetRemoved, ReportRefused, type GatewayHost } from "@atlas/meshtastic-fieldlink/gateway-host";

export async function createGatewayCore({
  url, key, fetch = globalThis.fetch,
}: { url: string; key: string; fetch?: typeof globalThis.fetch }) {
  // A radio retry can outlive an SDK call. Keep the same Core idempotency
  // key for the same submission across separate calls.
  const operation = new AsyncLocalStorage<string>();
  const protocol = await loadPackagedProtocol();
  const client = createClient({
    baseUrl: url,
    credential: { kind: "gateway", key },
    protocol,
    clock: systemClock,
    fetch(input, init) {
      const stable = operation.getStore();
      const headers = new Headers(init?.headers);
      if (stable && headers.has("Idempotency-Key")) headers.set("Idempotency-Key", stable);
      return fetch(input, { ...init, headers });
    },
  });
  return {
    client,
    hash: protocol.hash,
    withKey<T>(key: string, method: () => T): T {
      return operation.run(key, method);
    },
  };
}

export function requireValue<T>(result: Result<T>): T {
  if (result.ok) return result.value;
  throw new Error(`${result.error}: ${result.explanation}`);
}

type Binding = Awaited<ReturnType<GatewayHost["bind"]>>;
type Profile = Parameters<GatewayHost["bind"]>[1];
type Contact = { open: boolean; lastHeard: number };
type Asset = {
  binding: Binding;
  session: string;
  after: number;
  removed?: true;
  queue: AssetEvent[];
  reports: Map<number, () => Promise<void>>;
  stream?: Follow;
  streamError?: Error;
  streamRetry?: NodeJS.Timeout;
  streamBackoff: number;
  contact?: Contact;
};
type ContactWrite = {
  contact: Contact;
  result: ReturnType<typeof Promise.withResolvers<void>>;
};
type Signup = {
  session: string;
  operation: string;
  replaced?: string;
  assetId?: string;
  time: number;
};
type Core = Awaited<ReturnType<typeof createGatewayCore>>;

export function createGatewayHost(core: Core, run: number, lifetime?: AbortSignal): GatewayHost & { close(): void } {
  const closing = new AbortController();
  const signal = lifetime ? AbortSignal.any([lifetime, closing.signal]) : closing.signal;
  const { client, hash: coreHash, withKey } = core;
  const assets = new Map<string, Asset>();
  const peers = new Map<string, Asset>();
  const carried = new Set<string>();
  const signups = new Map<string, Signup>();
  const events = new Set<(assetId: string) => void>();
  const contactWrites = new Map<string, ContactWrite[]>();

  function assetFor(assetId: string): Asset {
    const asset = assets.get(assetId);
    if (!asset || asset.removed) throw new AssetRemoved(`Core removed radio Asset ${assetId}`);
    return asset;
  }

  function stop(asset: Asset) {
    asset.stream?.stop();
    asset.stream = undefined;
    clearTimeout(asset.streamRetry);
    asset.streamRetry = undefined;
  }

  function checkRemoval<T>(assetId: string, result: Result<T>) {
    if (!result.ok && (result.status === 403 || result.status === 404)) {
      const asset = assets.get(assetId);
      if (asset) {
        asset.removed = true;
        stop(asset);
      }
      carried.delete(assetId);
      throw new AssetRemoved(`Core removed radio Asset ${assetId}`);
    }
  }

  async function retry<T>(send: () => Promise<T>): Promise<T> {
    let backoff = 250;
    while (true) {
      signal.throwIfAborted();
      try {
        return await send();
      } catch (error) {
        if (error instanceof AssetRemoved || error instanceof ReportRefused) throw error;
      }
      await delay(backoff, undefined, { signal });
      backoff = Math.min(backoff * 2, 5_000);
    }
  }

  async function drainContacts(assetId: string, pending: ContactWrite[]) {
    try {
      while (pending[0]) {
        const write = pending[0];
        const contact = write.contact;
        // Core must dedupe a delayed attempt even if it arrives after the next state.
        const key = randomUUID();
        await retry(async () => {
          const result = await withKey(key, () => client.call("putContact", {
            retry: false,
            params: { asset_id: assetId },
            body: { asset_id: assetId, contact: contact.open ? "online" : "offline", time: contact.lastHeard },
          }));
          checkRemoval(assetId, result);
          requireValue(result);
        });
        // A newer reading may have joined this transition while it was in flight.
        if (contact !== write.contact) continue;
        pending.shift();
        write.result.resolve();
        const asset = assets.get(assetId);
        if (!contact.open && asset && !asset.stream) start(asset);
      }
    } catch (error) {
      for (const write of pending) write.result.reject(error);
    } finally {
      contactWrites.delete(assetId);
    }
  }

  function writeContact(assetId: string, contact: Contact, replay = false): Promise<void> {
    const asset = assets.get(assetId);
    if (asset?.removed) throw new AssetRemoved(`Core removed radio Asset ${assetId}`);
    const pending = contactWrites.get(assetId) ?? [];
    const latest = pending.at(-1);
    if (latest?.contact.open === contact.open) {
      if (latest.contact.lastHeard < contact.lastHeard) latest.contact = contact;
      if (asset) asset.contact = latest.contact;
      return latest.result.promise;
    }
    if (asset) {
      asset.contact = contact;
      if (!contact.open && !replay) {
        stop(asset);
        asset.queue.length = 0;
        asset.streamError = undefined;
      }
    }
    const result = Promise.withResolvers<void>();
    pending.push({ contact, result });
    if (!contactWrites.has(assetId)) {
      contactWrites.set(assetId, pending);
      void drainContacts(assetId, pending);
    }
    return result.promise;
  }

  function start(asset: Asset, replayContact = false) {
    const { assetId } = asset.binding;
    if (signal.aborted || asset.removed || contactWrites.get(assetId)?.some(write => !write.contact.open)) return;
    const stream = follow(client, {
      after: asset.after,
      async beforeOpen() {
        asset.queue.length = 0;
        const contact = asset.contact;
        const refresh = replayContact;
        replayContact = true;
        // This stream is already waiting to open and has no prefetched work.
        if (refresh && contact) await writeContact(assetId, contact, true);
        return asset.after;
      },
      onContact({ open }) {
        if (open) asset.streamError = undefined;
      },
    }, event => {
      if (!isAssetEvent(event)) return;
      const recipient = event.kind === "tasks.requested" || event.kind === "tasks.updated"
        ? event.record[0]?.asset_id : event.record.asset_id;
      if (recipient !== assetId) return;
      asset.queue.push(event);
      for (const listener of events) listener(assetId);
    });
    asset.stream = stream;
    void stream.done.then(end => {
      if (asset.stream !== stream || end.reason === "stopped") return;
      asset.streamError ??= new Error(`Core event stream for Asset ${assetId} ended (${end.reason})`);
      if (end.reason !== "invalid_event" && end.reason !== "handler_failed") return;
      asset.streamRetry = setTimeout(() => {
        asset.streamRetry = undefined;
        start(asset, true);
      }, asset.streamBackoff);
      asset.streamBackoff = Math.min(asset.streamBackoff * 2, 5_000);
    });
  }

  return {
    async carried() {
      const { assets } = requireValue(await client.call("carriedRadios"));
      for (const { asset_id } of assets) carried.add(asset_id);
      return assets.map(({ asset_id, last_heard }) => ({ assetId: asset_id, lastHeard: last_heard }));
    },
    onEvent(listener) {
      events.add(listener);
      return () => { events.delete(listener); };
    },
    async refuseDefinitions(peer, { hash, session }) {
      if (hash === coreHash) throw new Error("Cannot refuse matching Protocol definitions");
      const refusal = keyFor("definitions", run, peer, session, hash);
      const result = await withKey(refusal, () => client.call("registerRadio", {
        body: { definitions_hash: hash },
      }));
      if (!result.ok && result.error === "definitions_mismatch") return;
      requireValue(result);
      throw new Error("Core accepted a different definitions hash");
    },
    async bind(peer: string, profile: Profile): Promise<Binding> {
      if (profile.hash !== coreHash) throw new Error("Cannot bind incompatible Protocol definitions");
      const prior = peers.get(peer);
      if (prior && !prior.removed && prior.session === profile.session && assets.has(prior.binding.assetId))
        return prior.binding;
      let signup = signups.get(peer);
      if (!signup || signup.session !== profile.session) {
        signup = { session: profile.session, operation: randomUUID(), time: Date.now() };
        signups.set(peer, signup);
      }
      if (prior) {
        stop(prior);
        assets.delete(prior.binding.assetId);
        // An earlier SDK timeout can leave the old report's outcome unknown.
        await Promise.allSettled([...prior.reports.values()].map(send => retry(send)));
        signal.throwIfAborted();
      }
      const { operation, time } = signup;
      let binding: Binding;
      while (true) {
        signup.assetId ??= requireValue(await withKey(keyFor("register", run, peer, signup.replaced ?? ""), () =>
          client.call("registerRadio", { body: { definitions_hash: profile.hash } }))).asset_id;
        const { assetId } = signup;
        const resume = profile.resume;
        if (resume?.run === run && resume.assetId === assetId && carried.has(assetId)) {
          binding = resume;
          break;
        }
        const description = await withKey(keyFor("describe", operation, assetId), () => client.call("describeAsset", {
          params: { asset_id: assetId },
          body: { ...profile.description, asset_id: assetId, time },
        }));
        if (description.ok) {
          try {
            await writeContact(assetId, { open: false, lastHeard: time });
            const tasks = requireValue(await client.call("tasks", { params: { asset_id: assetId } }));
            binding = { run, assetId, after: tasks.as_of, lastTaskId: tasks.items.at(-1)?.task.task_id ?? 0 };
            break;
          } catch (error) {
            if (!(error instanceof AssetRemoved)) throw error;
          }
        } else if (description.status !== 403 && description.status !== 404) requireValue(description);
        signup.replaced = assetId;
        signup.assetId = undefined;
      }
      const { assetId } = binding;
      carried.add(assetId);
      const asset: Asset = {
        binding,
        session: profile.session,
        after: binding.after,
        queue: [],
        reports: new Map(),
        streamBackoff: 250,
      };
      peers.set(peer, asset);
      assets.set(assetId, asset);
      signups.delete(peer);
      start(asset);
      return binding;
    },
    next(assetId, after) {
      const asset = assetFor(assetId);
      if (after > asset.after) {
        asset.after = after;
        asset.streamBackoff = 250;
      }
      if (asset.streamError) {
        const error = asset.streamError;
        asset.streamError = undefined;
        throw error;
      }
      if (asset.stream?.stale !== false) return;
      while (asset.queue[0] && asset.queue[0].event_id <= asset.after) asset.queue.shift();
      return asset.queue[0];
    },
    async store(assetId, submission, reports) {
      const asset = assetFor(assetId);
      const pending = asset.reports.get(submission);
      if (pending) return pending();

      const key = keyFor("reports", run, assetId, asset.session, submission);
      let writing: Promise<void> | undefined;
      const send = () => writing ??= (async () => {
        const result = await withKey(key, () =>
          client.call("sendReports", { params: { asset_id: assetId }, body: { reports } }));
        if (!result.ok && result.status !== undefined && result.status >= 400 && result.status < 500 && result.status !== 401) {
          asset.reports.delete(submission);
          checkRemoval(assetId, result);
          throw new ReportRefused(`${result.error}: ${result.explanation}`);
        }
        const { stored } = requireValue(result);
        if (stored !== reports.length) throw new Error("Core did not confirm the complete report batch");
        asset.reports.delete(submission);
      })().finally(() => { writing = undefined; });
      asset.reports.set(submission, send);
      return send();
    },
    async contact(assetId, open, lastHeard) {
      return writeContact(assetId, { open, lastHeard });
    },
    close() {
      closing.abort();
      for (const asset of assets.values()) stop(asset);
      assets.clear();
    },
  };
}

function keyFor(...parts: (number | string)[]): string {
  return createHash("sha256").update(JSON.stringify(parts)).digest("hex");
}

function isAssetEvent(event: AtlasEvent): event is Extract<AtlasEvent, { kind: AssetEvent["kind"] }> {
  return event.kind === "tasks.requested" || event.kind === "tasks.updated" ||
    event.kind === "cancel.requested" || event.kind === "settings.requested" || event.kind === "task.dropped";
}
