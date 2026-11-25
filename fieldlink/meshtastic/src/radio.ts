import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { decodeFrames, encodeFrames, frameBytes, readFrame, type Envelope } from "./wire.ts";

export interface Radio {
  readonly failure: AbortSignal;
  send(peer: string, bytes: Uint8Array): Promise<void>;
  receive(handler: (peer: string, bytes: Uint8Array) => void): () => void;
  announce(nonce: string, gateway?: string): Promise<void>;
  discover(handler: (peer: string, nonce: string, kind: "discovery" | "beacon") => void): () => void;
  close(): Promise<void>;
}

export const nonce = () => randomBytes(8).toString("hex");

export async function sendEnvelope(radio: Radio, peer: string, message: Envelope, signal: AbortSignal) {
  for (const frame of encodeFrames(message, randomBytes(8))) {
    signal.throwIfAborted();
    await radio.send(peer, frame);
  }
}

export function receiveEnvelopes(radio: Radio, allowed: (peer: string) => boolean,
  accept: (peer: string, data: Envelope) => void, allowFragments?: (count: number) => boolean) {
  type Transfer = { total: number; parts: Map<number, Buffer> };
  const pending = new Map<string, Transfer>();
  return radio.receive((peer, raw) => {
    if (!allowed(peer)) return;
    const frame = readFrame(raw);
    if (!frame || allowFragments?.(frame.total) === false) return;
    const { id, total, index, body } = frame;
    const key = `${peer}:${id}`;
    let transfer = pending.get(key);
    if (!transfer) {
      const oldest = pending.keys().next();
      if (pending.size >= 16 && !oldest.done) pending.delete(oldest.value);
      pending.set(key, transfer = { total, parts: new Map() });
    }
    if (total !== transfer.total) return;
    const prior = transfer.parts.get(index);
    if (prior && !prior.equals(body)) {
      pending.delete(key);
      return;
    }
    transfer.parts.set(index, Buffer.from(body));
    if (transfer.parts.size !== total) return;
    pending.delete(key);
    const chunks = [...transfer.parts].sort(([a], [b]) => a - b).map(([, chunk]) => chunk);
    const decoded = decodeFrames(chunks);
    if (decoded) accept(peer, decoded);
  });
}

const PEER_KEY = /^(?!0{64}$)[a-f0-9]{64}$/;
const bridge = fileURLToPath(new URL("./radio_bridge.py", import.meta.url));

type PendingSend = {
  id: number;
  resolve: () => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
};

export async function openMeshtasticRadio(options: {
  python: string;
  port: string;
  discoveryChannel?: number;
  signal?: AbortSignal;
}): Promise<Radio> {
  if (!options.python || !options.port) {
    throw new Error("Specify a Python executable and a Meshtastic serial device");
  }
  options.signal?.throwIfAborted();

  const channel = options.discoveryChannel ?? 0;
  if (!Number.isInteger(channel) || channel < 0 || channel > 7) {
    throw new Error("Meshtastic discovery channel must be a local index from 0 to 7");
  }
  const child = spawn(options.python, ["-u", bridge, options.port, String(channel)], {
    stdio: ["pipe", "pipe", "inherit"],
  });
  const lines = createInterface({ input: child.stdout, crlfDelay: Infinity });
  const ready = Promise.withResolvers<void>();
  const exited = Promise.withResolvers<void>();
  const listeners = new Set<Parameters<Radio["receive"]>[0]>();
  const discoveries = new Set<Parameters<Radio["discover"]>[0]>();
  const failed = new AbortController();
  let pending: PendingSend | undefined;
  let nextId = 0;
  let closeTimer: NodeJS.Timeout | undefined;
  const openTimer = setTimeout(() => stop(new Error("Meshtastic serial handshake timed out")), 35_000);
  const abort = () => stop(new Error("Meshtastic serial bridge aborted"));

  function finishSend(error?: Error): void {
    const send = pending;
    pending = undefined;
    if (!send) return;
    clearTimeout(send.timer);
    if (error) send.reject(error);
    else send.resolve();
  }

  function stop(error: Error): void {
    if (failed.signal.aborted) return;
    failed.abort(error);
    options.signal?.removeEventListener("abort", abort);
    clearTimeout(openTimer);
    finishSend(error);
    ready.reject(error);
    listeners.clear();
    discoveries.clear();
    lines.close();
    child.stdin.end();
    closeTimer = setTimeout(() => child.kill("SIGKILL"), 2_000);
  }

  child.on("error", () => stop(new Error("Could not start the Meshtastic serial bridge")));
  options.signal?.addEventListener("abort", abort, { once: true });
  child.stdin.on("error", () => stop(new Error("Meshtastic serial bridge input closed")));
  child.stdout.on("error", () => stop(new Error("Meshtastic serial bridge output closed")));
  child.on("close", () => {
    stop(new Error("Meshtastic serial bridge exited"));
    clearTimeout(closeTimer);
    exited.resolve();
  });

  lines.on("line", (line: string) => {
    let message: unknown;
    try {
      message = JSON.parse(line);
    } catch {
      stop(new Error("Invalid response from the Meshtastic serial bridge"));
      return;
    }
    if (typeof message !== "object" || message === null || !("type" in message)) {
      stop(new Error("Invalid response from the Meshtastic serial bridge"));
      return;
    }

    switch (message.type) {
      case "ready":
        clearTimeout(openTimer);
        ready.resolve();
        return;
      case "fatal":
        if ("error" in message && typeof message.error === "string") {
          stop(new Error(message.error));
          return;
        }
        break;
      case "submission":
        if ("id" in message && pending && pending.id === message.id && "error" in message) {
          if (message.error === null) {
            finishSend();
            return;
          }
          if (typeof message.error === "string") {
            finishSend(new Error(message.error));
            return;
          }
        }
        break;
      case "packet":
        if ("peer" in message && typeof message.peer === "string" && PEER_KEY.test(message.peer) &&
            "body" in message && typeof message.body === "string" && message.body.length <= frameBytes * 4 / 3) {
          const bytes = Buffer.from(message.body, "base64");
          if (bytes.length > 0 && bytes.toString("base64") === message.body) {
            for (const listener of listeners) listener(message.peer, Buffer.from(bytes));
            return;
          }
        }
        break;
      case "discovery":
      case "beacon":
        if ("peer" in message && typeof message.peer === "string" && PEER_KEY.test(message.peer) &&
            "nonce" in message && typeof message.nonce === "string" && /^[a-f0-9]{16}$/.test(message.nonce)) {
          for (const listener of discoveries) listener(message.peer, message.nonce, message.type);
          return;
        }
        break;
    }
    stop(new Error("Invalid response from the Meshtastic serial bridge"));
  });

  try {
    await ready.promise;
  } catch (error) {
    await exited.promise;
    throw error;
  }
  async function submit(request: { peer: string; body: string } | { peer?: string; nonce: string }) {
    failed.signal.throwIfAborted();
    if (request.peer !== undefined && !PEER_KEY.test(request.peer)) throw new Error("Meshtastic peer key must be 64 lowercase hex digits");
    if (pending) throw new Error("Meshtastic serial bridge already has a submission in progress");
    const id = ++nextId;
    const submission = Promise.withResolvers<void>();
    const timer = setTimeout(() => stop(new Error("Meshtastic serial bridge timed out during submission")), 5_000);
    pending = { id, resolve: submission.resolve, reject: submission.reject, timer };
    child.stdin.write(`${JSON.stringify({ id, ...request })}\n`);
    await submission.promise;
  }
  return {
    failure: failed.signal,
    async send(peer, bytes) {
      if (bytes.length === 0 || bytes.length > frameBytes) {
        throw new Error(`Meshtastic body must be between 1 and ${frameBytes} bytes`);
      }
      await submit({ peer, body: Buffer.from(bytes).toString("base64") });
    },
    async announce(nonce, peer) {
      if (!/^[a-f0-9]{16}$/.test(nonce)) throw new Error("Invalid Meshtastic discovery nonce");
      await submit({ peer, nonce });
    },
    discover(handler) {
      failed.signal.throwIfAborted();
      discoveries.add(handler);
      return () => { discoveries.delete(handler); };
    },
    receive(handler) {
      failed.signal.throwIfAborted();
      listeners.add(handler);
      return () => { listeners.delete(handler); };
    },
    async close() {
      stop(new Error("Meshtastic serial bridge closed"));
      await exited.promise;
    },
  };
}
