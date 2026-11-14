import { createInterface } from "node:readline";
import {
  mkdirSync,
  writeFileSync,
  renameSync,
  readdirSync,
  readFileSync,
  createReadStream,
  statSync,
} from "node:fs";
import { appendFile } from "node:fs/promises";
import { join } from "node:path";
import type { Clock } from "./clock.ts";

export type Level = "error" | "warn" | "info" | "debug" | "trace";
export type DiagRecord = { level: Level; area: string; msg: string } & Record<
  string,
  unknown
>;

export interface DiagnosticLog {
  record(r: DiagRecord): void;
  openRun(runId: number): Promise<void>;
  readAfter(n: number, limit: number): Promise<string[]>;
  gaps(): {
    lost: number;
    from_n: number;
    to_n: number;
    at: number;
    why: string;
  }[];
  flush(): Promise<void>;
  lastRecordTime(runId: number): number | null;
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
  const gaps: {
    lost: number;
    from_n: number;
    to_n: number;
    at: number;
    why: string;
  }[] = [];
  let gapVersion = 0,
    writtenGapVersion = 0,
    writtenThrough = 0,
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
    } catch {
      return;
    }
    for (const name of names)
      for (const line of readFileSync(join(dir, name), "utf8").split("\n"))
        if (line) yield line;
  }
  const gap = (number: number, why: string) => {
    gapVersion++;
    const last = gaps.at(-1);
    if (last && last.why === why && last.to_n === number - 1) {
      last.lost++;
      last.to_n = number;
    } else
      gaps.push({
        lost: 1,
        from_n: number,
        to_n: number,
        at: clock.now(),
        why,
      });
    if (gapFile) {
      try {
        writeFileSync(gapFile + ".partial", JSON.stringify(gaps), {flush: true});
        renameSync(gapFile + ".partial", gapFile);
      } catch (error) {
        process.stderr.write(`Diagnostic loss accounting failed: ${String(error)}\n`);
      }
    }
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
      if (!atLimit && gapVersion !== writtenGapVersion) {
        const version = gapVersion;
        const pending = gaps
          .filter((g) => g.to_n > writtenThrough)
          .map((g) => ({
            ...g,
            from_n: Math.max(g.from_n, writtenThrough + 1),
            lost: g.to_n - Math.max(g.from_n, writtenThrough + 1) + 1,
          }));
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
          try {
            await appendFile(join(directory, `core-${file}.jsonl`), line);
            total += bytes;
            fileBytes += bytes;
            writtenGapVersion = version;
            writtenThrough = pending.at(-1)?.to_n ?? writtenThrough;
          } catch {}
        }
      }
    })().finally(() => {
      writing = null;
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
      for (const line of lines(id)) {
        try {
          const record = JSON.parse(line);
          n = Math.max(n, record.n);
          if (record.area === "log" && Array.isArray(record.gaps)) {
            gaps.push(...record.gaps);
            writtenThrough = record.gaps.at(-1)?.to_n ?? writtenThrough;
          }
        } catch {}
      }
      mkdirSync(options.gapDirectory, {recursive: true});
      gapFile = join(options.gapDirectory, `run-${id}.json`);
      try {
        const saved = JSON.parse(readFileSync(gapFile, "utf8"));
        gaps.splice(0, gaps.length, ...saved);
      } catch (error) {
        if (!(error instanceof Error && Reflect.get(error, "code") === "ENOENT")) throw error;
      }
      n = Math.max(n, ...gaps.map(g => g.to_n));
      atLimit = gaps.some(g => g.why === "total limit");
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
      const result: string[] = [];
      for (const name of files(directory)) {
        const input = createReadStream(join(directory, name));
        const reader = createInterface({ input, crlfDelay: Infinity });
        try {
          for await (const line of reader) {
            try {
              if (JSON.parse(line).n > after) result.push(line);
            } catch {}
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
    },
    lastRecordTime(id) {
      let at: number | null = null;
      for (const line of lines(id)) {
        try {
          at = Math.max(at ?? 0, JSON.parse(line).at);
        } catch {}
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
