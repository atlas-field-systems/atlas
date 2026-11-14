import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
export async function bytesUnder(path: string): Promise<Uint8Array[]> {
  const entries = await readdir(path, { withFileTypes: true }).catch(() => []);
  const result: Uint8Array[] = [];
  for (const e of entries)
    result.push(
      ...(e.isDirectory()
        ? await bytesUnder(join(path, e.name))
        : e.name.endsWith(".zip")
          ? [
              (
                await promisify(execFile)("unzip", ["-p", join(path, e.name)], {
                  encoding: "buffer",
                  maxBuffer: 16 * 1024 * 1024,
                })
              ).stdout,
            ]
          : [await readFile(join(path, e.name))]),
    );
  return result;
}
