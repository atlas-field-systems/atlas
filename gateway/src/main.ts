import { readFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import { z } from "zod";
import { maxReplyTimeoutMs, meshtasticTiming, serveGateway } from "@atlas/meshtastic-fieldlink";
import { openMeshtasticRadio } from "@atlas/meshtastic-fieldlink/radio";
import { createGatewayCore, createGatewayHost, requireValue } from "./core-host.ts";

const configSchema = z.strictObject({
  core_url: z.url({ protocol: /^https?$/ }).refine(value => {
    const url = URL.parse(value);
    return !url?.username && !url?.password;
  }, { message: "Use the Core URL without embedded credentials" }),
  fieldlink: z.literal("meshtastic"),
  python: z.string().min(1).default("python3"),
  port: z.string().min(1),
  timeout_ms: z.number().int().positive().max(maxReplyTimeoutMs(meshtasticTiming)).default(meshtasticTiming.timeoutMs),
  discovery_channel: z.number().int().min(0).max(7).default(0),
});

function logFailure(error: unknown) {
  process.stderr.write(`${error instanceof Error ? error.message : "Gateway operation failed"}\n`);
}

async function main(signal: AbortSignal) {
  const [path, ...extra] = process.argv.slice(2);
  if (!path || extra.length) throw new Error("Usage: node gateway/src/main.ts <config.json>");
  const key = process.env.ATLAS_GATEWAY_KEY;
  if (!key) throw new Error("Set ATLAS_GATEWAY_KEY to the provisioned Core gateway key");
  delete process.env.ATLAS_GATEWAY_KEY;
  const config = configSchema.parse(JSON.parse(await readFile(path, "utf8")));
  const core = await createGatewayCore({ url: config.core_url, key });
  const { client } = core;
  const close = () => client.close();
  signal.addEventListener("abort", close, { once: true });
  try {
    const radio = await openMeshtasticRadio({
      python: config.python, port: config.port, discoveryChannel: config.discovery_channel, signal,
    });
    try {
      const connectedSignal = AbortSignal.any([signal, radio.failure]);
      while (!connectedSignal.aborted) {
        const connected = await client.connect();
        if (signal.aborted) break;
        if (!connected.ok && (connected.error === "unknown" || (connected.status ?? 0) >= 500)) {
          await delay(1000, undefined, { signal: connectedSignal }).catch(() => {});
          continue;
        }
        const { run_id } = requireValue(connected);
        const run = new AbortController();
        const unsubscribe = client.onStatus(status => {
          if (status.phase !== "connected") run.abort();
        });
        const host = createGatewayHost(core, run_id);
        const heartbeat = client.holdContact();
        process.stdout.write(`${JSON.stringify({ fieldlink: config.fieldlink, run_id })}\n`);
        try {
          await serveGateway({
            radio, host, signal: AbortSignal.any([signal, run.signal]), onError: logFailure,
            timing: { ...meshtasticTiming, timeoutMs: config.timeout_ms },
          });
        } finally {
          heartbeat.stop();
          unsubscribe();
          host.close();
        }
        if (!signal.aborted && client.status.phase !== "run_ended")
          throw new Error(`Core connection ended (${client.status.phase})`);
      }
      if (!signal.aborted) radio.failure.throwIfAborted();
    } finally {
      await radio.close();
    }
  } finally {
    signal.removeEventListener("abort", close);
    close();
  }
}

const shutdown = new AbortController();
process.once("SIGINT", () => shutdown.abort());
process.once("SIGTERM", () => shutdown.abort());
try {
  await main(shutdown.signal);
} catch (error) {
  if (!shutdown.signal.aborted) {
    logFailure(error);
    process.exitCode = 1;
  }
}
