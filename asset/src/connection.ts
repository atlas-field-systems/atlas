import { loadPackagedProtocol } from "@atlas/protocol";
import { createClient, diagnostics, runAsset, startAsset, type AssetLink, type AssetOptions, type Clock, type FollowEnd, type Observer } from "@atlas/sdk";
import { openAsset } from "@atlas/meshtastic-fieldlink";
import { openMeshtasticRadio } from "@atlas/meshtastic-fieldlink/radio";
import type { Config } from "./config.ts";

type Session = Pick<ReturnType<typeof runAsset>, "asset_id" | "queue" | "outbox" | "done" | "stop"> & {
  link: AssetLink;
};

interface AssetConnection {
  register(options: AssetOptions, onRejoin?: (assetId: string, outbox: Session["outbox"]) => void): Promise<Session>;
  close(): void | Promise<void>;
}

export async function createAssetConnection(
  config: Config,
  options: { clock: Clock; fetch: typeof fetch; observer: Observer; openRadio?: typeof openMeshtasticRadio },
): Promise<AssetConnection> {
  const protocol = await loadPackagedProtocol();
  if (config.asset_key !== undefined) {
    const client = createClient({
      ...options,
      baseUrl: config.link.core_url,
      credential: { kind: "asset", key: config.asset_key },
      protocol,
    });
    return {
      async register(options) {
        const result = await startAsset(client, { ...options, description: config.description });
        if (!result.ok) throw new Error(result.explanation);
        return result.value;
      },
      close: () => client.close(),
    };
  }

  const controller = new AbortController();
  const { signal } = controller;
  let opening: ReturnType<typeof openAsset> | undefined;
  return {
    async register(operations, onRejoin) {
      signal.throwIfAborted();
      const { gateway, port, python, discovery_channel } = config.link;
      const lossAfter = operations.settings().link_loss_after_s;
      const emit = diagnostics(options.clock, options.observer);
      const first = Promise.withResolvers<ReturnType<typeof runAsset>>();
      const ended = Promise.withResolvers<FollowEnd>();
      void ended.promise.catch(error => emit("meshtastic.session_failed", { explanation: String(error) }));
      let current: ReturnType<typeof runAsset> | undefined;
      opening = openAsset({
        openRadio: signal => (options.openRadio ?? openMeshtasticRadio)({ port, python, signal, discoveryChannel: discovery_channel }),
        gateway, profile: { hash: protocol.hash, description: config.description },
        offlineMs: lossAfter === undefined ? undefined : Math.ceil(lossAfter * 1000),
        signal, now: () => options.clock.now(),
        onError: error => emit("meshtastic.exchange_failed", { explanation: String(error) }),
        onRegister({ assetId, after, lastTaskId }, link) {
          const session = runAsset(link, { asset_id: assetId, after, last_task_id: lastTaskId }, operations, emit);
          if (current) onRejoin?.(assetId, session.outbox);
          current = session;
          first.resolve(session);
          let replaced = false;
          void session.done.then(end => {
            if (!replaced) ended.resolve(end);
          }, error => { if (!replaced) ended.reject(error); });
          return () => {
            replaced = true;
            session.stop();
          };
        },
      });
      const { link, failure } = await opening;
      const finish = () => signal.aborted ? ended.resolve({ reason: "stopped" }) : ended.reject(failure.reason);
      const finished = AbortSignal.any([signal, failure]);
      finished.addEventListener("abort", finish, { once: true });
      if (finished.aborted) finish();
      const initial = await first.promise;
      const ready = await Promise.race([initial.ready, ended.promise.then(() => { throw new Error("Radio session closed"); })]);
      finished.throwIfAborted();
      if (!ready.ok) throw new Error(ready.explanation);
      return {
        get asset_id() { return (current ?? initial).asset_id; },
        get queue() { return (current ?? initial).queue; },
        get outbox() { return (current ?? initial).outbox; },
        done: ended.promise, stop: () => controller.abort(), link,
      };
    },
    async close() {
      controller.abort();
      // Startup owns an open failure. Closing still waits for its cleanup.
      const [result] = await Promise.allSettled([opening]);
      if (result.status === "fulfilled") await result.value?.done;
    },
  };
}
