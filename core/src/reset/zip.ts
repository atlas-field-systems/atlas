import { open, unlink } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { Readable } from "node:stream";
import { createHash } from "node:crypto";
import { crc32, createDeflateRaw, createInflateRaw } from "node:zlib";

export interface ZipWriter {
  add(
    name: string,
    data: AsyncIterable<Uint8Array> | string,
  ): Promise<{ size: number; sha256: string }>;
  finish(): Promise<void>;
  abort(): Promise<void>;
}

// ZIP64 data descriptors let input streams exceed 4 GiB without buffering or seeking.
export async function createZip(path: string): Promise<ZipWriter> {
  const file = await open(path, "wx");
  let offset = 0;
  const central: Buffer[] = [];
  async function write(bytes: Buffer) {
    let at = 0;
    while (at < bytes.length) at += (await file.write(bytes, at)).bytesWritten;
    offset += bytes.length;
  }
  return {
    async add(name, data) {
      const filename = Buffer.from(name);
      const start = offset;
      const local = Buffer.alloc(30);
      local.writeUInt32LE(0x04034b50);
      local.writeUInt16LE(45, 4);
      local.writeUInt16LE(0x808, 6);
      local.writeUInt16LE(8, 8);
      local.writeUInt16LE(0x21, 12);
      local.writeUInt32LE(0xffffffff, 18);
      local.writeUInt32LE(0xffffffff, 22);
      local.writeUInt16LE(filename.length, 26);
      local.writeUInt16LE(20, 28);
      const extra = Buffer.alloc(20);
      extra.writeUInt16LE(1);
      extra.writeUInt16LE(16, 2);
      await write(Buffer.concat([local, filename, extra]));
      let size = 0,
        crc = 0;
      const hash = createHash("sha256");
      async function* source() {
        const chunks = typeof data === "string" ? [Buffer.from(data)] : data;
        for await (const chunk of chunks) {
          size += chunk.length;
          crc = crc32(chunk, crc);
          hash.update(chunk);
          yield chunk;
        }
      }
      const compressedStart = offset;
      const input = Readable.from(source());
      const deflater = createDeflateRaw();
      input.on("error", (error) => deflater.destroy(error));
      try {
        for await (const chunk of input.pipe(deflater)) await write(chunk);
      } finally {
        input.destroy();
        deflater.destroy();
      }
      const compressed = offset - compressedStart;
      const descriptor = Buffer.alloc(24);
      descriptor.writeUInt32LE(0x08074b50);
      descriptor.writeUInt32LE(crc, 4);
      descriptor.writeBigUInt64LE(BigInt(compressed), 8);
      descriptor.writeBigUInt64LE(BigInt(size), 16);
      await write(descriptor);
      const header = Buffer.alloc(46);
      header.writeUInt32LE(0x02014b50);
      header.writeUInt16LE(45, 4);
      header.writeUInt16LE(45, 6);
      header.writeUInt16LE(0x808, 8);
      header.writeUInt16LE(8, 10);
      header.writeUInt16LE(0x21, 14);
      header.writeUInt32LE(crc, 16);
      header.writeUInt32LE(0xffffffff, 20);
      header.writeUInt32LE(0xffffffff, 24);
      header.writeUInt16LE(filename.length, 28);
      header.writeUInt16LE(28, 30);
      header.writeUInt32LE(0xffffffff, 42);
      const sizes = Buffer.alloc(28);
      sizes.writeUInt16LE(1);
      sizes.writeUInt16LE(24, 2);
      sizes.writeBigUInt64LE(BigInt(size), 4);
      sizes.writeBigUInt64LE(BigInt(compressed), 12);
      sizes.writeBigUInt64LE(BigInt(start), 20);
      central.push(Buffer.concat([header, filename, sizes]));
      return { size, sha256: hash.digest("hex") };
    },
    async finish() {
      try {
        const start = offset;
        for (const header of central) await write(header);
        const end = offset;
        const zip64 = Buffer.alloc(56);
        zip64.writeUInt32LE(0x06064b50);
        zip64.writeBigUInt64LE(44n, 4);
        zip64.writeUInt16LE(45, 12);
        zip64.writeUInt16LE(45, 14);
        zip64.writeBigUInt64LE(BigInt(central.length), 24);
        zip64.writeBigUInt64LE(BigInt(central.length), 32);
        zip64.writeBigUInt64LE(BigInt(end - start), 40);
        zip64.writeBigUInt64LE(BigInt(start), 48);
        const locator = Buffer.alloc(20);
        locator.writeUInt32LE(0x07064b50);
        locator.writeBigUInt64LE(BigInt(end), 8);
        locator.writeUInt32LE(1, 16);
        const eocd = Buffer.alloc(22);
        eocd.writeUInt32LE(0x06054b50);
        eocd.writeUInt16LE(0xffff, 8);
        eocd.writeUInt16LE(0xffff, 10);
        eocd.writeUInt32LE(0xffffffff, 12);
        eocd.writeUInt32LE(0xffffffff, 16);
        await write(Buffer.concat([zip64, locator, eocd]));
        await file.sync();
      } finally {
        await file.close();
      }
    },
    async abort() {
      await file.close();
      await unlink(path).catch((error) => {
        if (error.code !== "ENOENT") throw error;
      });
    },
  };
}

export interface ZipEntry {
  name: string;
  size: number;
  open(): Readable;
}

// Read only the central directory into memory; entry contents stay on disk.
export async function readZip(path: string): Promise<ZipEntry[]> {
  const file = await open(path, "r");
  try {
    const length = (await file.stat()).size;
    async function read(at: number, size: number) {
      if (!Number.isSafeInteger(at) || at < 0 || at + size > length)
        throw new Error("ZIP range outside file");
      const bytes = Buffer.alloc(size);
      let done = 0;
      while (done < size) {
        const n = (await file.read(bytes, done, size - done, at + done))
          .bytesRead;
        if (!n) throw new Error("Truncated ZIP");
        done += n;
      }
      return bytes;
    }
    const tail = await read(length - 42, 42);
    if (
      tail.readUInt32LE() !== 0x07064b50 ||
      tail.readUInt32LE(20) !== 0x06054b50
    )
      throw new Error("Missing ZIP64 end");
    const endAt = Number(tail.readBigUInt64LE(8));
    const end = await read(endAt, 56);
    if (end.readUInt32LE() !== 0x06064b50) throw new Error("Invalid ZIP64 end");
    const count = Number(end.readBigUInt64LE(32));
    let at = Number(end.readBigUInt64LE(48));
    const entries: ZipEntry[] = [];
    const names = new Set<string>();
    for (let i = 0; i < count; i++) {
      const header = await read(at, 46);
      if (header.readUInt32LE() !== 0x02014b50 || header.readUInt16LE(10) !== 8)
        throw new Error("Unsupported ZIP entry");
      const nameLength = header.readUInt16LE(28),
        extraLength = header.readUInt16LE(30);
      const fields = await read(at + 46, nameLength + extraLength);
      const name = fields.subarray(0, nameLength).toString("utf8");
      if (names.has(name)) throw new Error("Duplicate ZIP entry");
      names.add(name);
      const extra = fields.subarray(nameLength);
      if (
        extra.length !== 28 ||
        extra.readUInt16LE() !== 1 ||
        extra.readUInt16LE(2) !== 24
      )
        throw new Error("Invalid ZIP64 sizes");
      const size = Number(extra.readBigUInt64LE(4)),
        compressed = Number(extra.readBigUInt64LE(12));
      const localAt = Number(extra.readBigUInt64LE(20));
      const local = await read(localAt, 30);
      if (local.readUInt32LE() !== 0x04034b50)
        throw new Error("Invalid local ZIP header");
      const dataAt =
        localAt + 30 + local.readUInt16LE(26) + local.readUInt16LE(28);
      const localName = await read(localAt + 30, local.readUInt16LE(26));
      if (
        !localName.equals(fields.subarray(0, nameLength)) ||
        !Number.isSafeInteger(size) ||
        dataAt + compressed > at
      )
        throw new Error("Invalid ZIP entry bounds");
      const expectedCrc = header.readUInt32LE(16);
      entries.push({
        name,
        size,
        open() {
          return Readable.from(
            (async function* () {
              const input = createReadStream(path, {
                start: dataAt,
                end: dataAt + compressed - 1,
              });
              const inflater = createInflateRaw();
              input.on("error", (error) => inflater.destroy(error));
              let crc = 0,
                bytes = 0;
              try {
                for await (const chunk of input.pipe(inflater)) {
                  bytes += chunk.length;
                  crc = crc32(chunk, crc);
                  if (bytes > size)
                    throw new Error("ZIP entry exceeds declared size");
                  yield chunk;
                }
                if (bytes !== size || crc !== expectedCrc)
                  throw new Error("ZIP entry CRC or size mismatch");
              } finally {
                input.destroy();
                inflater.destroy();
              }
            })(),
          );
        },
      });
      at += 46 + nameLength + extraLength + header.readUInt16LE(32);
    }
    if (at !== endAt) throw new Error("Invalid central directory length");
    return entries;
  } finally {
    await file.close();
  }
}
