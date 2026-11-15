import {
  mkdir,
  appendFile,
  writeFile,
  readFile,
  rename,
  rm,
} from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { zipSync, unzipSync, strToU8 } from "fflate";
import { systemClock, type Clock } from "@atlas/sdk";
import { inspectConfig, type Config } from "./config.ts";
export async function createLog(config: Config, start: number, clock: Clock = systemClock) {
  const directory = join(config.log_directory, String(start));
  await mkdir(directory, { recursive: true });
  const pending: string[] = [];
  let sealed = false;
  let writing: Promise<void> | undefined,
    dropped = 0,
    bytes = 0,
    part = 0,
    fileBytes = 0;
  const files = new Set<string>();
  function record(value: unknown) {
    if (sealed) return;
    if (pending.length >= config.log_queue_limit) {
      dropped++;
      return;
    }
    pending.push(JSON.stringify(value) + "\n");
    if (!writing)
      writing = drain().finally(() => {
        writing = undefined;
      });
  }
  async function drain() {
    while (pending.length) {
      const line = pending.shift()!;
      if (bytes + Buffer.byteLength(line) > config.log_total_limit_bytes) {
        dropped++;
        continue;
      }
      if (fileBytes + Buffer.byteLength(line) > config.log_file_limit_bytes) {
        part++;
        fileBytes = 0;
      }
      const name = `diagnostics-${part}.jsonl`;
      try {
        await appendFile(join(directory, name), line);
        files.add(name);
        bytes += Buffer.byteLength(line);
        fileBytes += Buffer.byteLength(line);
      } catch {
        dropped++;
      }
    }
  }
  record({ kind: "startup", time: start, config: inspectConfig(config) });
  return {
    record,
    async close(asset_id: string, reason: string) {
      await writing;
      sealed = true;
      const content: Record<string, Uint8Array> = {};
      for (const name of files)
        content[`diagnostics/${name}`] = await readFile(join(directory, name));
      content["config.json"] = strToU8(
        JSON.stringify(inspectConfig(config), null, 2),
      );
      content["README.md"] = strToU8(
        "Asset operation diagnostics and configuration.\n",
      );
      content["summary.md"] = strToU8(
        `Operation ${start} to ${clock.now()}. ${reason}. Dropped diagnostics: ${dropped}.\n`,
      );
      const manifest = Object.entries(content).map(([path, data]) => ({
        path,
        size: data.length,
        sha256: createHash("sha256").update(data).digest("hex"),
      }));
      content["manifest.json"] = strToU8(
        JSON.stringify({
          normal: true,
          gaps: dropped ? [{ dropped }] : [],
          files: manifest,
        }),
      );
      await mkdir(config.archive_directory, { recursive: true });
      const stamp = new Date(start)
        .toISOString()
        .replace(/[-:]/g, "")
        .replace(/\.\d+Z$/, "Z");
      const path = join(
        config.archive_directory,
        `asset-${asset_id}-${stamp}.zip`,
      );
      try {
        await writeFile(`${path}.partial`, zipSync(content));
        const checked = unzipSync(await readFile(`${path}.partial`));
        for (const f of manifest)
          if (
            !checked[f.path] ||
            checked[f.path].length !== f.size ||
            createHash("sha256").update(checked[f.path]).digest("hex") !==
              f.sha256
          )
            throw new Error(`ZIP verification failed: ${f.path}`);
        await rename(`${path}.partial`, path);
        await rm(directory, { recursive: true });
        return path;
      } catch (error) {
        await rm(`${path}.partial`, { force: true });
        throw error;
      }
    },
  };
}
