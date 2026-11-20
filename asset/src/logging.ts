import { mkdir, appendFile, writeFile, readFile, rename, rm, readdir, access } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { z } from "zod";
import { loadPackagedProtocol } from "@atlas/protocol";
import { systemClock, type Clock } from "@atlas/sdk";
import { inspectConfig, type Config } from "./config.ts";
import { inventory, writeZip, verifyZip } from "./archive.ts";

const operationSchema = z.object({ start: z.number(), asset_id: z.string(), archive_directory: z.string() });
const gapSchema = z.object({ start: z.number(), end: z.number(), dropped: z.number(), reason: z.string() });
type Gap = z.infer<typeof gapSchema>;
const levels = { trace: 0, debug: 1, info: 2, warn: 3, error: 4 };
async function exists(path: string) {
  try { await access(path); return true; } catch { return false; }
}
async function lines(path: string, consume: (line: string) => Promise<void>) {
  if (!await exists(path)) return;
  const reader = createInterface({ input: createReadStream(path), crlfDelay: Infinity });
  for await (const line of reader) if (line) await consume(line);
}
async function replaceFile(path: string, data: string | Uint8Array) {
  const temporary = `${path}.partial`;
  try {
    await writeFile(temporary, data);
    await rename(temporary, path);
  } catch (error) {
    await rm(temporary, { force: true }).catch(cleanupError => {
      process.stderr.write(`Asset evidence cleanup failed: ${cleanupError}\n`);
    });
    throw error;
  }
}
async function archive(directory: string, end: number, reason: string, normal: boolean) {
  const operation = operationSchema.parse(JSON.parse(await readFile(join(directory, "operation.json"), "utf8")));
  const gaps: Gap[] = [];
  await lines(join(directory, "gaps.jsonl"), async line => {
    try { gaps.push(gapSchema.parse(JSON.parse(line))); }
    catch { gaps.push({ start: operation.start, end, dropped: 0, reason: "incomplete gap record; original bytes retained" }); }
  });
  if (await exists(join(directory, "gap.json"))) gaps.push(gapSchema.parse(JSON.parse(await readFile(join(directory, "gap.json"), "utf8"))));
  if (!normal) gaps.push({ start: operation.start, end, dropped: 0, reason: "the app stopped unexpectedly; this record may be incomplete" });
  const stamp = new Date(operation.start).toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
  const path = join(operation.archive_directory, `asset-${operation.asset_id}-${stamp}.zip`);
  try {
    // Persist the attempt before writing, so interruption cannot turn failure into a retry.
    await writeFile(join(directory, "archive-failed.json"), JSON.stringify({ time: end, reason: "archive attempt did not complete" }));
    await writeFile(join(directory, "summary.md"), `Operation ${operation.start} to ${end}. ${reason}.\n${normal ? "Ended normally." : "the app stopped unexpectedly; this record may be incomplete"}\n\nTasks, failsafes, overrides and contact changes follow in local order.\n`);
    await lines(join(directory, "history.jsonl"), async line => { await appendFile(join(directory, "summary.md"), `${line}\n`); });
    await lines(join(directory, "reports/history.jsonl"), async line => {
      let report;
      try { report = JSON.parse(line); }
      catch {
        gaps.push({ start: operation.start, end, dropped: 1, reason: "incomplete report line; original bytes retained" });
        return;
      }
      if (report.type === "report.failsafe" || report.type === "report.status")
        await appendFile(join(directory, "summary.md"), `Report ${line}\n`);
    });
    for (const gap of gaps) await appendFile(join(directory, "summary.md"), `Gap ${gap.start} to ${gap.end}: ${gap.dropped} records, ${gap.reason}.\n`);
    await writeFile(join(directory, "README.md"), "Asset operation evidence.\n\nsummary.md records start, end, outcome, Tasks, failsafes, overrides, contact and gaps.\nmanifest.json lists payload file sizes and SHA-256 hashes, normal completion and gaps. It excludes itself.\ndiagnostics/ contains app, equipment and SDK diagnostics as written.\nreports/ contains recorded reports, including unsent reports.\nfiles/ contains captured files, uploaded or not.\nconfig.json contains configuration without credentials.\nversions.json records software versions and the definitions hash.\nhistory.jsonl contains the operation timeline. gaps.jsonl and gap.json contain diagnostic gap evidence.\n");
    if (gaps.length) await writeFile(join(directory, "diagnostics", "gaps.jsonl"), gaps.map(gap => JSON.stringify({ kind: "gap", ...gap }) + "\n").join(""));
    const files = await inventory(directory);
    const manifest = Buffer.from(JSON.stringify({ ...operation, end, reason, normal, gaps, files }));
    await writeFile(join(directory, "manifest.json"), manifest);
    await mkdir(operation.archive_directory, { recursive: true });
    if (await exists(path)) throw new Error(`Archive already exists: ${path}`);
    await writeZip(directory, `${path}.partial`, files);
    await verifyZip(`${path}.partial`, [...files, { path: "manifest.json", size: manifest.length, sha256: createHash("sha256").update(manifest).digest("hex") }]);
    await rename(`${path}.partial`, path);
    await rm(directory, { recursive: true });
    return path;
  } catch (error) {
    await rm(`${path}.partial`, { force: true }).catch(cleanupError => {
      process.stderr.write(`Asset incomplete archive cleanup failed: ${cleanupError}\n`);
    });
    const explanation = String(error);
    await writeFile(join(directory, "archive-failed.json"), JSON.stringify({ time: end, reason: explanation })).catch(markerError => {
      process.stderr.write(`Asset archive failure marker could not be written: ${markerError}\n`);
    });
    process.stderr.write(`Asset archive failed; local records retained, no retry: ${explanation}\n`);
    throw error;
  }
}
export async function createLog(config: Config, start: number, clock: Clock = systemClock) {
  await mkdir(config.log_directory, { recursive: true });
  const earlier = (await readdir(config.log_directory, { withFileTypes: true })).filter(e => e.isDirectory()).map(e => join(config.log_directory, e.name));
  const recovery = (async () => {
    for (const directory of earlier) {
      if (await exists(join(directory, "archive-failed.json")) || !await exists(join(directory, "operation.json"))) continue;
      await archive(directory, clock.now(), "unexpected stop", false).catch(error => {
        process.stderr.write(`Asset recovery failed; local records retained: ${error}\n`);
      });
    }
  })();
  const directory = join(config.log_directory, String(start));
  await mkdir(directory);
  await mkdir(join(directory, "diagnostics"));
  await mkdir(join(directory, "reports"));
  const operation = { start, asset_id: "unregistered", archive_directory: config.archive_directory };
  await replaceFile(join(directory, "operation.json"), JSON.stringify(operation));
  await writeFile(join(directory, "config.json"), JSON.stringify(inspectConfig(config), null, 2));
  const packageVersion = async (url: URL) => JSON.parse(await readFile(url, "utf8")).version;
  await writeFile(join(directory, "versions.json"), JSON.stringify({
    app: await packageVersion(new URL("../package.json", import.meta.url)),
    sdk: await packageVersion(new URL("../../sdk/package.json", import.meta.url)),
    fieldlink: null,
    protocol: await packageVersion(new URL("../../protocol/package.json", import.meta.url)),
    definitions_hash: (await loadPackagedProtocol()).hash,
  }));
  const pending: Array<{ line: string; time: number }> = [];
  let sealed = false;
  let writing: Promise<void> | undefined;
  let evidence = Promise.resolve();
  let evidencePending = 0;
  const gaps = new Map<string, Gap>();
  let bytes = 0, part = 0, fileBytes = 0, captureId = 0;
  const sanitize = (value: unknown) => JSON.parse(JSON.stringify(value, (key, item) => {
    if (/password|credential|authorization|cookie|token|asset_key|secret|api.?key/i.test(key)) return "[removed]";
    if (typeof item === "string" && config.asset_key) return item.replaceAll(config.asset_key, "[removed]");
    return item;
  }));
  function retain(path: string, value: unknown) {
    if (evidencePending >= config.log_queue_limit) { drop(clock.now(), path === "history.jsonl" ? "history queue full" : "report history queue full"); return; }
    const line = JSON.stringify(sanitize(value)) + "\n";
    if (path === "history.jsonl") {
      const size = Buffer.byteLength(line);
      if (bytes + size > config.log_total_limit_bytes) { drop(clock.now(), "total limit"); return; }
      bytes += size;
    }
    evidencePending++;
    evidence = evidence.then(() => appendFile(join(directory, path), line)).catch(error => {
      process.stderr.write(`Asset evidence write failed: ${error}\n`);
      drop(clock.now(), "evidence write failure");
    }).finally(() => { evidencePending--; });
  }
  function drop(time: number, reason: string, count = 1) {
    const gap = gaps.get(reason) ?? { start: time, end: time, reason, dropped: 0 };
    gap.end = time;
    gap.dropped += count;
    gaps.set(reason, gap);
  }
  function record(value: unknown) {
    if (sealed) return;
    try { recordDiagnostic(value); }
    catch { drop(clock.now(), "diagnostic serialization failure"); }
  }
  function recordDiagnostic(value: unknown) {
    if (sealed) return;
    const safe = sanitize(value);
    const kind = String(safe.kind ?? safe.name ?? "diagnostic");
    const time = safe.time ?? safe.at ?? clock.now();
    if (kind === "reports.gap") drop(time, "SDK report queue full", safe.detail.dropped);
    if (kind === "diagnostics.gap") drop(time, "SDK diagnostics lost", safe.detail.dropped);
    if (kind === "effect" || (kind === "input" && ["task", "contact", "settings", "cancel", "update"].includes(safe.event?.kind))) retain("history.jsonl", { time, ...safe });
    const level = safe.level ?? (/failed|error|blocked/.test(kind) ? "error" : /lost|gap|closed/.test(kind) ? "warn" : ["input", "effect", "observation", "report"].includes(kind) ? "trace" : "info");
    if (levels[z.enum(["trace", "debug", "info", "warn", "error"]).parse(level)] < levels[config.log_level]) return;
    if (!config.log_message_content) {
      for (const key of ["event", "effect", "report", "reports", "observation", "body", "content", "request", "response"]) delete safe[key];
    }
    if (pending.length >= config.log_queue_limit) { drop(time, "queue full"); return; }
    pending.push({ line: JSON.stringify({ time, ...safe }) + "\n", time });
    if (!writing) schedule();
  }
  function schedule() {
    writing = drain().finally(() => { writing = undefined; if (pending.length) schedule(); });
  }
  async function persistGap() {
    await evidence;
    if (gaps.size) await replaceFile(join(directory, "gaps.jsonl"), [...gaps.values()].map(gap => JSON.stringify(gap) + "\n").join(""));
  }
  async function drain() {
    while (pending.length) {
      const item = pending.shift()!;
      const size = Buffer.byteLength(item.line);
      if (bytes + size > config.log_total_limit_bytes) { drop(item.time, "total limit"); continue; }
      if (fileBytes + size > config.log_file_limit_bytes) { part++; fileBytes = 0; }
      bytes += size;
      try {
        await appendFile(join(directory, "diagnostics", `diagnostics-${part}.jsonl`), item.line);
        fileBytes += size;
      } catch { bytes -= size; drop(item.time, "diagnostic write failure"); }
    }
    await persistGap().catch(error => {
      process.stderr.write(`Asset diagnostic loss accounting failed: ${error}\n`);
    });
  }
  record({ kind: "startup", time: start, config: inspectConfig(config) });
  return {
    record,
    gap: drop,
    identify(asset_id: string) {
      operation.asset_id = asset_id;
      evidence = evidence.then(() => replaceFile(join(directory, "operation.json"), JSON.stringify(operation))).catch(error => {
        process.stderr.write(`Asset identity evidence write failed: ${error}\n`);
        drop(clock.now(), "evidence write failure");
      });
      return evidence;
    },
    report(value: unknown) {
      if (sealed) return;
      try { retain("reports/history.jsonl", value); }
      catch { drop(clock.now(), "report serialization failure"); }
    },
    async capture(file: { name: string; bytes: Uint8Array }) {
      const name = `files/${++captureId}-${file.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
      try {
        await mkdir(join(directory, "files"), { recursive: true });
        await replaceFile(join(directory, name), file.bytes);
        return join(directory, name);
      } catch (error) {
        drop(clock.now(), "capture write failure");
        throw error;
      }
    },
    async close(asset_id: string, reason: string) {
      while (writing) await writing;
      sealed = true;
      await evidence;
      operation.asset_id = asset_id;
      await replaceFile(join(directory, "operation.json"), JSON.stringify(operation));
      await persistGap();
      await recovery;
      return archive(directory, clock.now(), reason, true);
    },
  };
}
