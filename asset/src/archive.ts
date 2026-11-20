import { createReadStream, createWriteStream } from "node:fs";
import { readdir, stat, open } from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { finished } from "node:stream/promises";
import { Zip, ZipPassThrough } from "fflate";

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
  const done = Promise.allSettled([finished(output)]);
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
        if (output.destroyed) {
          const [result] = await done;
          if (result.status === "rejected") throw result.reason;
        }
      }
      entry.push(new Uint8Array(), true);
    }
    zip.end();
    const [result] = await done;
    if (result.status === "rejected") throw result.reason;
  } finally {
    if (!output.writableFinished) output.destroy();
    await done;
  }
}
export async function verifyZip(path: string, files: ArchiveFile[]) {
  const expected = new Map(files.map(file => [file.path, file]));
  const seen = new Set<string>();
  const input = await open(path, "r");
  try {
    async function read(offset: number, size: number) {
      const buffer = Buffer.alloc(size);
      const { bytesRead } = await input.read(buffer, 0, size, offset);
      if (bytesRead !== size) throw new Error("Truncated ZIP");
      return buffer;
    }
    const length = (await input.stat()).size;
    const end = await read(length - 22, 22);
    if (end.readUInt32LE(0) !== 0x06054b50 || end.readUInt16LE(20) !== 0)
      throw new Error("Invalid ZIP directory end");
    const count = end.readUInt16LE(10);
    const directory = end.readUInt32LE(16);
    if (directory + end.readUInt32LE(12) !== length - 22 || count !== files.length)
      throw new Error("Invalid ZIP directory size");
    let offset = directory;
    for (let index = 0; index < count; index++) {
      const entry = await read(offset, 46);
      if (entry.readUInt32LE(0) !== 0x02014b50 || entry.readUInt16LE(10) !== 0)
        throw new Error("Invalid stored ZIP entry");
      const nameSize = entry.readUInt16LE(28);
      const name = (await read(offset + 46, nameSize)).toString("utf8");
      const wanted = expected.get(name);
      const size = entry.readUInt32LE(24);
      if (!wanted || seen.has(name) || size !== wanted.size || entry.readUInt32LE(20) !== size)
        throw new Error(`ZIP verification failed: ${name}`);
      const localOffset = entry.readUInt32LE(42);
      const local = await read(localOffset, 30);
      if (local.readUInt32LE(0) !== 0x04034b50 || local.readUInt16LE(8) !== 0 ||
          local.readUInt16LE(26) !== nameSize || (await read(localOffset + 30, nameSize)).toString("utf8") !== name)
        throw new Error(`Invalid ZIP local entry: ${name}`);
      const start = localOffset + 30 + nameSize + local.readUInt16LE(28);
      if (start + size > directory) throw new Error(`Invalid ZIP payload bounds: ${name}`);
      const hash = createHash("sha256");
      if (size) for await (const chunk of createReadStream(path, { start, end: start + size - 1 })) hash.update(chunk);
      if (hash.digest("hex") !== wanted.sha256) throw new Error(`ZIP verification failed: ${name}`);
      seen.add(name);
      offset += 46 + nameSize + entry.readUInt16LE(30) + entry.readUInt16LE(32);
    }
    if (offset !== length - 22 || seen.size !== expected.size) throw new Error("ZIP verification missing files");
  } finally {
    await input.close();
  }
}
