import { AsyncLocalStorage } from "node:async_hooks";
import { createHash, randomUUID } from "node:crypto";
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
  refreshing: number;
  removed?: true;
  queue: AssetEvent[];
  stream?: Follow;
  streamError?: Error;
  contact?: Contact;
};
type ContactWrite = {
  contact: Contact;
  asset?: Asset;
  result: ReturnType<typeof Promise.withResolvers<void>>;
};
type ContactWriter = { pending?: ContactWrite; done: Promise<void> };
type Signup = {
  session: string;
  operation: string;
  replaced?: string;
  assetId?: string;
  time: number;
};
type Core = Awaited<ReturnType<typeof createGatewayCore>>;

export function createGatewayHost(core: Core, run: number): GatewayHost & { close(): void } {
  const { client, hash: coreHash, withKey } = core;
  const assets = new Map<string, Asset>();
  const peers = new Map<string, Asset>();
  const carried = new Set<string>();
  const signups = new Map<string, Signup>();
  const events = new Set<(assetId: string) => void>();
  const contactWrites = new Map<string, ContactWriter>();

  function assetFor(assetId: string): Asset {
    const asset = assets.get(assetId);
    if (!asset || asset.removed) throw new AssetRemoved(`Core removed radio Asset ${assetId}`);
    return asset;
  }

  function stop(asset: Asset) {
    asset.stream?.stop();
    asset.stream = undefined;
  }

  function checkRemoval<T>(asset: Asset, result: Result<T>) {
    if (!result.ok && (result.status === 403 || result.status === 404)) {
      asset.removed = true;
      carried.delete(asset.binding.assetId);
      stop(asset);
      throw new AssetRemoved(`Core removed radio Asset ${asset.binding.assetId}`);
    }
  }

  function writeContact(assetId: string, contact: Contact, asset = assets.get(assetId)) {
    const result = Promise.withResolvers<void>();
    const pending = { contact, asset, result };
    const active = contactWrites.get(assetId);
    if (active) {
      active.pending?.result.resolve();
      active.pending = pending;
      return result.promise;
    }
    const writer: ContactWriter = {
      pending,
      done: Promise.resolve().then(async () => {
        while (writer.pending) {
          const { contact, asset, result } = writer.pending;
          writer.pending = undefined;
          try {
            if (asset && (asset.removed || assets.get(assetId) !== asset)) {
              result.resolve();
              continue;
            }
            const response = await client.call("putContact", {
              retry: false,
              params: { asset_id: assetId },
              body: { asset_id: assetId, contact: contact.open ? "online" : "offline", time: contact.lastHeard },
            });
            if (asset) checkRemoval(asset, response);
            if (asset || response.ok || (response.status !== 403 && response.status !== 404)) requireValue(response);
            result.resolve();
          } catch (error) {
            result.reject(error);
          }
        }
        contactWrites.delete(assetId);
      }),
    };
    contactWrites.set(assetId, writer);
    return result.promise;
  }

  function start(asset: Asset, replayContact = false) {
    const { assetId } = asset.binding;
    const stream = follow(client, {
      after: asset.after,
      async beforeOpen() {
        asset.queue.length = 0;
        const contact = asset.contact;
        const refresh = replayContact;
        replayContact = true;
        if (refresh && contact) await writeContact(assetId, contact, asset);
        return asset.after;
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
    asset.streamError = undefined;
    void stream.done.then(end => {
      if (asset.stream === stream && end.reason !== "stopped")
        asset.streamError = new Error(`Core event stream for Asset ${assetId} ended (${end.reason})`);
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
      if (prior && !prior.removed && prior.session === profile.session) return prior.binding;
      let signup = signups.get(peer);
      if (!signup || signup.session !== profile.session) {
        signup = { session: profile.session, operation: randomUUID(), time: Date.now() };
        signups.set(peer, signup);
      }
      if (prior) {
        stop(prior);
        peers.delete(peer);
        assets.delete(prior.binding.assetId);
        await contactWrites.get(prior.binding.assetId)?.done;
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
          await writeContact(assetId, { open: false, lastHeard: time });
          const tasks = requireValue(await client.call("tasks", { params: { asset_id: assetId } }));
          binding = { run, assetId, after: tasks.as_of, lastTaskId: tasks.items.at(-1)?.task.task_id ?? 0 };
          break;
        }
        if (description.status !== 403 && description.status !== 404) requireValue(description);
        signup.replaced = assetId;
        signup.assetId = undefined;
      }
      const { assetId } = binding;
      carried.add(assetId);
      const asset: Asset = {
        binding,
        session: profile.session,
        after: binding.after,
        refreshing: 0,
        queue: [],
      };
      peers.set(peer, asset);
      assets.set(assetId, asset);
      signups.delete(peer);
      start(asset);
      return binding;
    },
    next(assetId, after) {
      const asset = assetFor(assetId);
      asset.after = Math.max(asset.after, after);
      if (asset.streamError) throw asset.streamError;
      if (asset.refreshing || asset.stream?.stale !== false) return;
      while (asset.queue[0] && asset.queue[0].event_id <= asset.after) asset.queue.shift();
      return asset.queue[0];
    },
    async store(assetId, submission, reports) {
      const asset = assetFor(assetId);
      const result = await withKey(keyFor("reports", run, assetId, asset.session, submission), () =>
        client.call("sendReports", { params: { asset_id: assetId }, body: { reports } }));
      checkRemoval(asset, result);
      if (!result.ok && result.status !== undefined && result.status >= 400 && result.status < 500 && result.status !== 401)
        throw new ReportRefused(`${result.error}: ${result.explanation}`);
      const { stored } = requireValue(result);
      if (stored !== reports.length) throw new Error("Core did not confirm the complete report batch");
    },
    async contact(assetId, open, lastHeard) {
      const contact = { open, lastHeard };
      const asset = assets.get(assetId);
      if (!asset) return writeContact(assetId, contact);
      if (asset.removed) throw new AssetRemoved(`Core removed radio Asset ${assetId}`);
      asset.contact = contact;
      if (open) return writeContact(assetId, contact, asset);
      // Core drops requests in the offline transaction. Discard prefetched work
      // while that write is pending, then replay from the radio's cursor.
      if (asset.refreshing++ === 0) {
        stop(asset);
        asset.queue.length = 0;
        asset.streamError = undefined;
      }
      let failed = true;
      try {
        await writeContact(assetId, contact, asset);
        failed = false;
      } finally {
        if (--asset.refreshing === 0 && assets.get(assetId) === asset && !asset.removed)
          start(asset, failed && asset.contact === contact);
      }
    },
    close() {
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
