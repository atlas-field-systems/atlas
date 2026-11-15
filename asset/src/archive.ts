import { createReadStream, createWriteStream } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { finished } from "node:stream/promises";
import { Zip, ZipPassThrough, Unzip } from "fflate";

export type ArchiveFile = { path: string; size: number; sha256: string };
export async function inventory(directory: string, prefix = ""): Promise<ArchiveFile[]> {
  const files: ArchiveFile[] = [];
  for (const entry of await readdir(join(directory, prefix), { withFileTypes: true })) {
    const path = prefix + entry.name;
    if (entry.isDirectory()) files.push(...await inventory(directory, path + "/"));
    else if (entry.isFile() && !["operation.json", "archive-failed.json", "manifest.json"].includes(path)) {
      const hash = createHash("sha256");
      for await (const chunk of createReadStream(join(directory, path))) hash.update(chunk);
      files.push({ path, size: (await stat(join(directory, path))).size, sha256: hash.digest("hex") });
    }
  }
  return files;
}
export async function writeZip(directory: string, path: string, files: ArchiveFile[]) {
  const output = createWriteStream(path, { flags: "wx" });
  const done = finished(output);
  void done.catch(() => {});
  const zip = new Zip((error, chunk, final) => {
    if (error) output.destroy(error);
    else if (final) output.end(chunk);
    else output.write(chunk);
  });
  try {
    for (const file of [...files, { path: "manifest.json" }]) {
      const entry = new ZipPassThrough(file.path);
      zip.add(entry);
      for await (const chunk of createReadStream(join(directory, file.path))) {
        entry.push(chunk, false);
        if (output.writableNeedDrain) await once(output, "drain");
        if (output.destroyed) await done;
      }
      entry.push(new Uint8Array(), true);
    }
    zip.end();
    await done;
  } catch (error) {
    output.destroy();
    await done.catch(() => {});
    throw error;
  }
}
export async function verifyZip(path: string, files: ArchiveFile[]) {
  const expected = new Map(files.map(file => [file.path, file]));
  const seen = new Set<string>();
  const unzip = new Unzip(file => {
    const wanted = expected.get(file.name);
    if (!wanted) throw new Error(`Unexpected ZIP entry: ${file.name}`);
    const hash = createHash("sha256");
    let size = 0;
    file.ondata = (error, chunk, final) => {
      if (error) throw error;
      hash.update(chunk);
      size += chunk.length;
      if (final) {
        if (seen.has(file.name) || size !== wanted.size || hash.digest("hex") !== wanted.sha256)
          throw new Error(`ZIP verification failed: ${file.name}`);
        seen.add(file.name);
      }
    };
    file.start();
  });
  for await (const chunk of createReadStream(path)) unzip.push(chunk, false);
  unzip.push(new Uint8Array(), true);
  if (seen.size !== expected.size) throw new Error("ZIP verification missing files");
}
