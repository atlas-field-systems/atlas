import { mkdir, readFile } from "node:fs/promises";
import { loadPackagedProtocol } from "@atlas/protocol";
import { resolveConfig, pathsFor, redactConfig } from "./config.ts";
import { recoverReset, stopRun } from "./reset/reset.ts";
import { startLog } from "./log.ts";
import { openStore } from "./store/db.ts";
import * as events from "./store/events.ts";
import * as runs from "./store/runs.ts";
import * as idempotency from "./store/idempotency.ts";
import * as admin from "./pillars/administration.ts";
import * as entities from "./pillars/entities.ts";
import * as tasks from "./pillars/tasks.ts";
import * as objects from "./pillars/objects.ts";
import * as fusion from "./pillars/fusion.ts";
import { startContact } from "./contact.ts";
import { startStreams } from "./api/stream.ts";
import { startServer } from "./api/server.ts";
import type { Protocol } from "@atlas/protocol";
import type { Clock } from "./clock.ts";
import type { CoreConfig, Paths } from "./config.ts";
import type { DiagnosticLog } from "./log.ts";

export interface CoreOptions {
  clock: Clock;
  config: Partial<CoreConfig>;
}

export interface RunningCore {
  readonly url: string;
  readonly runId: number;
  readonly debugUrl: string | null;
  stop(): Promise<StopResult>;
}

export type StopResult =
  { archived: true; zip: string } | { archived: false; explanation: string }; // reset.md#when-the-zip-fails: nothing cleared

export interface Env {
  readonly protocol: Protocol; // loadPackagedProtocol(), loaded once
  readonly config: CoreConfig;
  readonly paths: Paths;
  readonly clock: Clock;
  readonly log: DiagnosticLog;
  readonly versions: {
    core_version: string;
    protocol_version: string;
    definitions_hash: string;
  };
}

export async function startCore(options: CoreOptions): Promise<RunningCore> {
  const resolved = resolveConfig(options.config);
  if (!resolved.ok)
    throw new Error(
      resolved.problems.map((p) => `${p.key}: ${p.explanation}`).join("; "),
    );
  const config = resolved.config;
  const paths = pathsFor(config);
  for (const dir of [
    config.data_directory,
    config.archive_directory,
    paths.uploadsDir,
  ])
    await mkdir(dir, { recursive: true });
  const protocol = await loadPackagedProtocol();
  events.assertKindsMatchProtocol(protocol.names);
  const protocolPackage = JSON.parse(
    await readFile(
      new URL("../../protocol/package.json", import.meta.url),
      "utf8",
    ),
  );
  const versions = {
    core_version: "0.1.0",
    protocol_version: protocolPackage.version as string,
    definitions_hash: protocol.hash,
  };
  const log = startLog(options.clock, {
    directory: config.log_directory,
    level: config.log_level,
    content: config.log_message_content,
    fileLimit: config.log_file_limit_bytes,
    totalLimit: config.log_total_limit_bytes,
  });
  const env: Env = {
    protocol,
    config,
    paths,
    clock: options.clock,
    log,
    versions,
  };
  const tables = [
    ...runs.TABLES,
    ...events.TABLES,
    ...idempotency.TABLES,
    ...admin.TABLES,
    ...entities.TABLES,
    ...tasks.TABLES,
    ...objects.TABLES,
    ...fusion.TABLES,
  ];
  const store = openStore(env, tables);
  try {
    await recoverReset(env, store, tables);
    const run = runs.beginOrResume(env, store);
    await log.openRun(run.runId);
    if (
      config.first_admin &&
      !store.read((tx) => tx.get("SELECT 1 FROM accounts LIMIT 1"))
    ) {
      const password = (
        await readFile(config.first_admin.password_file, "utf8")
      ).trimEnd();
      const hash = await admin.hashPassword(password);
      store.write((tx) =>
        admin.ensureFirstAdmin(tx, config.first_admin!.operator_id, hash),
      );
    }
    log.record({
      level: "info",
      area: "core",
      msg: run.kind === "resumed" ? "run resumed" : "run started",
      run_id: run.runId,
      config: redactConfig(config),
    });
    const contact = startContact(
      store,
      options.clock,
      config.offline_after_s * 1000,
    );
    contact.resume();
    const follower = fusion.startFusion(store, fusion.onePerObservation);
    const streams = startStreams(store, options.clock);
    const server = await startServer(env, store, contact, streams);
    const closeServer = server.close.bind(server);
    server.close = async () => {
      await closeServer();
      contact.stop();
      await follower.drain();
      follower.stop();
    };
    process.stdout.write(
      JSON.stringify({
        url: server.url,
        run_id: run.runId,
        debug_url: server.debugUrl,
      }) + "\n",
    );
    let stopped: Promise<StopResult> | undefined;
    return {
      url: server.url,
      runId: run.runId,
      debugUrl: server.debugUrl,
      stop() {
        return (stopped ??= stopRun(env, store, tables, {
          closeServer: () => server.close(),
          stopContact() {},
          async drainFusion() {},
        }));
      },
    };
  } catch (error) {
    store.close();
    await log.flush();
    throw error;
  }
}
