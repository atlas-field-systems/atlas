import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { access, open, readdir, rename, rm } from "node:fs/promises";
import { join, basename } from "node:path";
import { createZip, readZip } from "./zip.ts";
import { redactConfig } from "../config.ts";
import { redact } from "../log.ts";
import { pageAfter, settlement } from "../store/events.ts";
import type { Env, StopResult } from "../core.ts";
import type { Store, TableDef } from "../store/db.ts";

type Run = {
  run_id: number;
  started_at: number;
  resumes: string;
  ended_at: number | null;
};
type Digest = { size: number; sha256: string };
export interface StopParts {
  closeServer(): Promise<void>;
  stopContact(): void;
  lastHeard(asset_id: string): number | undefined;
  drainFusion(): Promise<void>;
}

function runRow(store: Store, id?: number): Run {
  return store.read((tx) =>
    tx.get<Run>("SELECT * FROM runs WHERE run_id=?", id ?? tx.runId),
  )!;
}

export function clearRun(
  store: Store,
  tables: readonly TableDef[],
  runId: number,
  zipName: string,
): void {
  store.write((tx) => {
    for (const table of [...tables].reverse())
      if (table.runScoped)
        tx.run(`DELETE FROM "${table.name}" WHERE run_id=?`, runId);
    tx.run(
      "UPDATE runs SET ended_at=?,outcome='archived',zip_name=? WHERE run_id=?",
      tx.now,
      zipName,
      runId,
    );
  });
}

async function clearFiles(env: Env, runId: number) {
  await rm(env.paths.objectsDir(runId), { recursive: true, force: true });
  await rm(env.paths.logDir(runId), { recursive: true, force: true });
  await rm(join(env.config.data_directory, "diagnostic-gaps", `run-${runId}.json`), {force: true});
  await rm(join(env.config.data_directory, "diagnostic-gaps", `run-${runId}.json.partial`), {force: true});
}

export async function recoverReset(
  env: Env,
  store: Store,
  tables: readonly TableDef[],
) {
  // Committed clears may still have files if power failed during filesystem cleanup.
  const archived = store.read((tx) =>
    tx.all<{ run_id: number }>(
      "SELECT run_id FROM runs WHERE outcome='archived'",
    ),
  );
  for (const run of archived) await clearFiles(env, run.run_id);
  const run = store.read((tx) =>
    tx.get<Run>("SELECT * FROM runs WHERE ended_at IS NULL"),
  );
  if (!run) return;
  const final = env.paths.zipFinal(run.run_id, run.started_at);
  try {
    await access(final);
  } catch (error) {
    if (error instanceof Error && Reflect.get(error, "code") === "ENOENT")
      return;
    throw error;
  }
  const checked = await checkZip(final, run.run_id);
  if (checked.ok) {
    clearRun(store, tables, run.run_id, basename(final));
    await clearFiles(env, run.run_id);
  } else
    process.stderr.write(
      `Reset ZIP check failed; resuming run ${run.run_id}: ${checked.why}\n`,
    );
}

export async function stopRun(
  env: Env,
  store: Store,
  tables: readonly TableDef[],
  parts: StopParts,
): Promise<StopResult> {
  const run = runRow(store);
  const final = env.paths.zipFinal(run.run_id, run.started_at);
  const partial = env.paths.zipPartial(run.run_id, run.started_at);
  let published = false;
  let writer: Awaited<ReturnType<typeof createZip>> | undefined;
  try {
    await parts.closeServer();
    parts.stopContact();
    await parts.drainFusion();
    env.log.record({
      level: "info",
      area: "reset",
      msg: "run stopped",
      run_id: run.run_id,
    });
    await env.log.flush();
    try {
      await access(final);
      throw new Error("Refusing to overwrite final Reset ZIP");
    } catch (error) {
      if (!(error instanceof Error) || Reflect.get(error, "code") !== "ENOENT")
        throw error;
    }
    writer = await createZip(partial);
    const files: Record<string, Digest> = {};
    const add = async (
      name: string,
      data: AsyncIterable<Uint8Array> | string,
    ) => {
      files[name] = await writer!.add(name, data);
    };
    await add(
      "README.md",
      "# Core Reset archive\n\nsummary.md describes the run. events.jsonl is the ordered event log. state/ holds current table rows. objects/ holds Object files by ID, including deleted Objects. diagnostics/ holds Core diagnostics. config.json is resolved configuration without secrets. versions.json identifies the software and definitions. manifest.json checks every other file by size and SHA-256 and lists resumes and gaps.\n",
    );
    await add("summary.md", writeSummary(store, run.run_id, parts.lastHeard));
    async function* eventLines() {
      let after = 0;
      while (true) {
        const page = store.read((tx) =>
          pageAfter(tx, { kind: "everything" }, after, 256),
        );
        for (const event of page) {
          yield Buffer.from(JSON.stringify(event) + "\n");
          after = event.event_id;
        }
        if (page.length < 256) return;
      }
    }
    await add("events.jsonl", eventLines());
    for (const table of tables) {
      if (table.name === "events") continue;
      if (!table.runScoped && !["gateways", "plugins"].includes(table.name))
        continue;
      async function* rows() {
        let offset = 0;
        while (true) {
          const page = store.read((tx) =>
            tx.all<Record<string, unknown>>(
              `SELECT * FROM "${table.name}" WHERE ${table.runScoped ? "run_id" : "contact_run_id"}=? ORDER BY rowid LIMIT 256 OFFSET ?`,
              run.run_id,
              offset,
            ),
          );
          for (const row of page)
            yield Buffer.from(
              JSON.stringify(
                redact({
                  ...row,
                  ...(Object.hasOwn(row, "fingerprint")
                    ? { fingerprint: "[redacted]" }
                    : {}),
                }),
              ) + "\n",
            );
          if (page.length < 256) return;
          offset += page.length;
        }
      }
      await add(`state/${table.name}.jsonl`, rows());
    }
    let objectAfter = "";
    while (true) {
      const page = store.read((tx) =>
        tx.all<{
          object_id: string;
          file: string;
          sha256: string;
          record: string;
        }>(
          "SELECT object_id,file,sha256,record FROM objects WHERE run_id=? AND object_id>? ORDER BY object_id LIMIT 256",
          run.run_id,
          objectAfter,
        ),
      );
      for (const object of page) {
        const name = `objects/${object.object_id}`;
        await add(
          name,
          createReadStream(join(env.paths.objectsDir(run.run_id), object.file)),
        );
        const record = JSON.parse(object.record);
        if (
          files[name]!.sha256 !== object.sha256 ||
          files[name]!.size !== record.size_bytes
        )
          throw new Error(
            `Object ${object.object_id} differs from stored evidence`,
          );
        objectAfter = object.object_id;
      }
      if (page.length < 256) break;
    }
    for (const name of await readdir(env.paths.logDir(run.run_id)))
      await add(
        `diagnostics/${name}`,
        createReadStream(join(env.paths.logDir(run.run_id), name)),
      );
    await add("config.json", JSON.stringify(redact(redactConfig(env.config))));
    await add("versions.json", JSON.stringify(env.versions));
    await writer.add(
      "manifest.json",
      JSON.stringify({
        run_id: run.run_id,
        started_at: run.started_at,
        ended_at: env.clock.now(),
        files,
        resumes: JSON.parse(run.resumes),
        gaps: [
          ...JSON.parse(run.resumes).map(
            (resume: { last_sign_of_life: number; resumed_at: number }) => ({
              why: "unexpected stop",
              ...resume,
            }),
          ),
          ...env.log.gaps(),
        ],
      }),
    );
    await writer.finish();
    const checked = await checkZip(partial, run.run_id);
    if (!checked.ok) throw new Error(checked.why);
    await rename(partial, final);
    published = true;
    const directory = await open(env.config.archive_directory, "r");
    try {
      await directory.sync();
    } finally {
      await directory.close();
    }
    clearRun(store, tables, run.run_id, basename(final));
    await clearFiles(env, run.run_id);
    return { archived: true, zip: final };
  } catch (error) {
    const explanation = error instanceof Error ? error.message : String(error);
    if (!published) {
      if (writer) {
        try {
          await writer.abort();
        } catch (cleanupError) {
          process.stderr.write(
            `Could not remove partial ZIP: ${String(cleanupError)}\n`,
          );
        }
      }
      env.log.record({
        level: "error",
        area: "reset",
        msg: "Reset ZIP failed",
        explanation,
      });
      await env.log.flush();
      store.write((tx) =>
        tx.run(
          "UPDATE runs SET ended_at=?,outcome='archive_failed' WHERE run_id=?",
          tx.now,
          run.run_id,
        ),
      );
    }
    process.stderr.write(`Reset failed: ${explanation}\n`);
    return { archived: false, explanation };
  } finally {
    store.close();
  }
}

export async function checkZip(
  path: string,
  runId?: number,
): Promise<{ ok: true } | { ok: false; why: string }> {
  try {
    const entries = await readZip(path);
    const manifestEntry = entries.find(
      (entry) => entry.name === "manifest.json",
    );
    if (!manifestEntry) throw new Error("Missing manifest");
    const chunks: Buffer[] = [];
    for await (const chunk of manifestEntry.open()) chunks.push(chunk);
    const manifest = JSON.parse(Buffer.concat(chunks).toString());
    if (
      (runId !== undefined && manifest.run_id !== runId) ||
      !manifest.files ||
      Object.keys(manifest.files).length !== entries.length - 1
    )
      throw new Error("Manifest does not match archive");
    for (const required of [
      "README.md",
      "summary.md",
      "events.jsonl",
      "config.json",
      "versions.json",
    ])
      if (!Object.hasOwn(manifest.files, required))
        throw new Error(`Missing ${required}`);
    for (const entry of entries) {
      if (entry === manifestEntry) continue;
      const expected = manifest.files[entry.name];
      if (!expected || expected.size !== entry.size)
        throw new Error(`Size mismatch: ${entry.name}`);
      const hash = createHash("sha256");
      for await (const chunk of entry.open()) hash.update(chunk);
      if (hash.digest("hex") !== expected.sha256)
        throw new Error(`SHA-256 mismatch: ${entry.name}`);
    }
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      why: error instanceof Error ? error.message : String(error),
    };
  }
}

export function writeSummary(
  store: Store,
  runId: number,
  lastHeard: (asset_id: string) => number | undefined,
): string {
  const run = runRow(store, runId);
  const lines = [
    `# Run ${runId}`,
    `Started ${new Date(run.started_at).toISOString()}. Ended ${new Date(store.read((tx) => tx.now)).toISOString()}.`,
  ];
  for (const resume of JSON.parse(run.resumes))
    lines.push(
      `Unexpected stop after ${new Date(resume.last_sign_of_life).toISOString()}; resumed ${new Date(resume.resumed_at).toISOString()}, estimated downtime ${resume.resumed_at - resume.last_sign_of_life} ms.`,
    );
  const assets = store.read((tx) =>
    tx.all<{
      asset_id: string;
      gateway_id: string | null;
      first: number;
      last: number;
    }>(
      "SELECT a.asset_id,a.gateway_id,MIN(e.time) first,MAX(e.time) last FROM assets a LEFT JOIN events e ON e.run_id=a.run_id AND e.asset_id=a.asset_id AND (e.kind IN ('asset.registered','asset.described','asset.contact') OR e.kind LIKE 'report.%') WHERE a.run_id=? GROUP BY a.asset_id",
      runId,
    ),
  );
  for (const asset of assets)
    lines.push(
      `Asset ${asset.asset_id}, gateway ${asset.gateway_id ?? "none"}, first heard ${asset.first}, last heard ${lastHeard(asset.asset_id) ?? asset.last}.`,
    );
  const tasks = store.read((tx) =>
    tx.all<{
      asset_id: string;
      task_id: number;
      state: string;
      state_time: number;
    }>(
      "SELECT asset_id,task_id,state,state_time FROM tasks WHERE run_id=? ORDER BY asset_id,task_id",
      runId,
    ),
  );
  for (const task of tasks)
    lines.push(
      `Asset ${task.asset_id} Task ${task.task_id}: ${["completed", "failed", "cancelled"].includes(task.state) ? task.state : `${task.state}; no reported outcome`} (${task.state_time}).`,
    );
  const calls = store.read((tx) =>
    tx.all<{ event_id: number; record: string }>(
      "SELECT event_id,record FROM events WHERE run_id=? AND kind='plugin.called' ORDER BY event_id",
      runId,
    ),
  );
  for (const call of calls) {
    const end = store.read((tx) => settlement(tx, call.event_id));
    lines.push(
      `Plugin call ${call.event_id}: ${end.state === "unsettled" ? "no reported outcome" : end.by.kind}.`,
    );
  }
  const gaps = store.read((tx) => tx.env.log.gaps());
  lines.push(`Diagnostic gaps: ${JSON.stringify(gaps)}.`);
  return lines.join("\n\n") + "\n";
}
