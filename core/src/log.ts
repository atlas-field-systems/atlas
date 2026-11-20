import { createInterface } from "node:readline";
import {
  mkdirSync,
  readdirSync,
  readFileSync,
  createReadStream,
  statSync,
} from "node:fs";
import { appendFile, writeFile, rename } from "node:fs/promises";
import { join } from "node:path";
import type { Clock } from "./clock.ts";

export type Level = "error" | "warn" | "info" | "debug" | "trace";
export type DiagRecord = { level: Level; area: string; msg: string } & Record<
  string,
  unknown
>;
type Gap = {
  lost: number;
  from_n: number;
  to_n: number;
  at: number;
  why: string;
};
const truncatedRecord = "truncated record; original bytes retained";

export interface DiagnosticLog {
  record(r: DiagRecord): void;
  openRun(runId: number): Promise<void>;
  readAfter(n: number, limit: number): Promise<string[]>;
  gaps(): Gap[];
  flush(): Promise<void>;
  lastRecordTime(runId: number): number | null;
}

function addGap(gaps: Gap[], entry: Gap) {
  const last = gaps.at(-1);
  if (last && last.why === entry.why && last.to_n + 1 === entry.from_n) {
    last.lost += entry.lost;
    last.to_n = entry.to_n;
  } else gaps.push(entry);
}

function unwrittenGaps(gaps: Gap[], written: Gap[]): Gap[] {
  written.sort((a, b) => a.from_n - b.from_n);
  const pending: Gap[] = [];
  for (const gap of gaps) {
    let from = gap.from_n;
    for (const reported of written) {
      if (reported.from_n > gap.to_n) break;
      if (reported.why !== gap.why || reported.to_n < from) continue;
      if (from < reported.from_n)
        pending.push({ ...gap, from_n: from, to_n: reported.from_n - 1, lost: reported.from_n - from });
      from = reported.to_n + 1;
      if (from > gap.to_n) break;
    }
    if (from <= gap.to_n)
      pending.push({ ...gap, from_n: from, lost: gap.to_n - from + 1 });
  }
  return pending;
}

export function startLog(
  clock: Clock,
  options: {
    directory: string;
    gapDirectory: string;
    level: Level;
    content: boolean;
    fileLimit: number;
    totalLimit: number;
  },
): DiagnosticLog {
  let gapFile = "";
  let directory = "",
    n = 0,
    file = 0,
    fileBytes = 0,
    total = 0,
    queue: string[] = [],
    writing: Promise<void> | null = null;
  const gaps: Gap[] = [];
  let pendingGaps: Gap[] = [];
  let gapVersion = 0,
    atLimit = false;
  const levels: Level[] = ["error", "warn", "info", "debug", "trace"];
  const files = (dir: string) =>
    readdirSync(dir)
      .filter((name) => /^core-\d+\.jsonl$/.test(name))
      .sort((a, b) => Number(a.match(/\d+/)![0]) - Number(b.match(/\d+/)![0]));
  function* lines(id: number): Generator<string> {
    const dir = join(options.directory, `run-${id}`);
    let names: string[];
    try {
      names = files(dir);
    } catch (error) {
      if (!(error instanceof Error && Reflect.get(error, "code") === "ENOENT"))
        process.stderr.write(`Core could not list diagnostics for run ${id}: ${String(error)}\n`);
      return;
    }
    for (const name of names)
      for (const line of readFileSync(join(dir, name), "utf8").split("\n"))
        if (line) yield line;
  }
  const gap = (number: number, why: string) => {
    gapVersion++;
    const entry = { lost: 1, from_n: number, to_n: number, at: clock.now(), why };
    addGap(gaps, entry);
    if (!atLimit) addGap(pendingGaps, { ...entry });
    if (gapFile) void persistGaps();
  };
  let savingGaps: Promise<void> | null = null;
  let savedGapVersion = 0;
  const persistGaps = (): Promise<void> => {
    if (savingGaps) return savingGaps;
    savingGaps = (async () => {
      while (savedGapVersion !== gapVersion) {
        const version = gapVersion;
        await writeFile(gapFile + ".partial", JSON.stringify(gaps), { flush: true });
        await rename(gapFile + ".partial", gapFile);
        savedGapVersion = version;
      }
    })().catch((error) => {
      process.stderr.write(`Diagnostic loss accounting failed: ${String(error)}\n`);
    }).finally(() => { savingGaps = null; });
    return savingGaps;
  };
  const drain = () => {
    if (writing) return writing;
    writing = (async () => {
      while (queue.length) {
        const line = queue.shift()!;
        const bytes = Buffer.byteLength(line);
        if (atLimit || total + bytes > options.totalLimit) {
          atLimit = true;
          gap(JSON.parse(line).n, "total limit");
          continue;
        }
        if (fileBytes + bytes > options.fileLimit) {
          file++;
          fileBytes = 0;
        }
        try {
          await appendFile(join(directory, `core-${file}.jsonl`), line);
          total += bytes;
          fileBytes += bytes;
        } catch {
          gap(JSON.parse(line).n, "write failure");
        }
      }
      if (!atLimit && pendingGaps.length) {
        const pending = pendingGaps;
        const line =
          JSON.stringify({
            n: n + 1,
            at: clock.now(),
            level: "warn",
            area: "log",
            msg: "diagnostic gaps",
            gaps: pending,
          }) + "\n";
        const bytes = Buffer.byteLength(line);
        if (total + bytes <= options.totalLimit) {
          if (fileBytes + bytes > options.fileLimit) {
            file++;
            fileBytes = 0;
          }
          n++;
          pendingGaps = [];
          try {
            await appendFile(join(directory, `core-${file}.jsonl`), line);
            total += bytes;
            fileBytes += bytes;
          } catch (error) {
            pendingGaps = pending.concat(pendingGaps);
            process.stderr.write(`Core diagnostic gap record write failed: ${String(error)}\n`);
          }
        }
      }
    })().finally(() => {
      writing = null;
      if (queue.length) return drain();
    });
    return writing;
  };
  return {
    record(r) {
      if (levels.indexOf(r.level) > levels.indexOf(options.level)) return;
      const number = ++n;
      if (queue.length >= 10000) {
        gap(number, "queue full");
        return;
      }
      queue.push(
        JSON.stringify({
          n: number,
          at: clock.now(),
          ...(redact(r) as object),
        }) + "\n",
      );
      if (directory) void drain();
    },
    async openRun(id) {
      directory = join(options.directory, `run-${id}`);
      mkdirSync(directory, { recursive: true });
      const truncated = new Set<number>();
      const written: Gap[] = [];
      for (const line of lines(id)) {
        try {
          const record = JSON.parse(line);
          n = Math.max(n, record.n);
          if (record.area === "log" && Array.isArray(record.gaps))
            written.push(...record.gaps);
        } catch {
          const prefix = /^\{"n":(\d+)(?=[,}]|$)/.exec(line);
          const leading = Number(prefix?.[1]);
          const number = Number.isSafeInteger(leading) ? leading : n + 1;
          truncated.add(number);
          n = Math.max(n, number);
          // An append after a partial write can share the same physical line.
          for (const match of line.matchAll(/(?<!^)\{"n":(\d+),"at":[\d.e+-]+,"level":"(?:error|warn|info|debug|trace)"/g)) {
            const appended = Number(match[1]);
            if (Number.isSafeInteger(appended) && appended > n) {
              truncated.add(appended);
              n = appended;
            }
          }
          process.stderr.write(`Core could not recover a diagnostic record for run ${id}\n`);
        }
      }
      mkdirSync(options.gapDirectory, { recursive: true });
      gapFile = join(options.gapDirectory, `run-${id}.json`);
      try {
        const saved = JSON.parse(readFileSync(gapFile, "utf8"));
        gaps.push(...saved);
      } catch (error) {
        if (
          !(error instanceof Error && Reflect.get(error, "code") === "ENOENT")
        ) throw error;
        gaps.push(...written);
      }
      pendingGaps = unwrittenGaps(gaps, written);
      for (const number of truncated)
        if (!gaps.some((g) => g.why === truncatedRecord && g.from_n <= number && number <= g.to_n))
          gap(number, truncatedRecord);
      await persistGaps();
      n = Math.max(n, ...gaps.map((g) => g.to_n));
      atLimit = gaps.some((g) => g.why === "total limit");
      const names = files(directory);
      total = names.reduce(
        (sum, name) => sum + statSync(join(directory, name)).size,
        0,
      );
      file = names.length
        ? Math.max(...names.map((name) => Number(name.match(/\d+/)![0]))) + 1
        : 0;
      fileBytes = 0;
    },
    async readAfter(after, limit) {
      await drain();
      await persistGaps();
      const result: string[] = [];
      for (const name of files(directory)) {
        const input = createReadStream(join(directory, name));
        const reader = createInterface({ input, crlfDelay: Infinity });
        try {
          for await (const line of reader) {
            try {
              if (JSON.parse(line).n > after) result.push(line);
            } catch {
              process.stderr.write("Core skipped a malformed diagnostic record during debug read\n");
            }
            if (result.length >= limit) return result;
          }
        } finally {
          reader.close();
          input.destroy();
        }
      }
      return result;
    },
    gaps() {
      return gaps;
    },
    async flush() {
      await drain();
      await persistGaps();
    },
    lastRecordTime(id) {
      let at: number | null = null;
      for (const line of lines(id)) {
        try {
          at = Math.max(at ?? 0, JSON.parse(line).at);
        } catch {
          process.stderr.write(`Core could not read a diagnostic timestamp for run ${id}\n`);
        }
      }
      return at;
    },
  };
}

export function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([key, v]) => [
        key,
        /password|cookie|authorization|^key$|token|key_hash/i.test(key)
          ? "[redacted]"
          : redact(v),
      ]),
    );
  return value;
}
