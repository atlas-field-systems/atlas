/**
 * A minimal streaming ZIP writer and reader, with ZIP64, over node:zlib
 * (deflateRaw) and zlib.crc32. About 250 lines by hand instead of a
 * dependency (Core's only dependency stays @atlas/protocol). ZIP64 because a
 * run's ZIP can approach 1 GB and Objects are streamed, so sizes are only
 * known after each entry: data descriptors, then a ZIP64 central directory.
 *
 * Entries are written one at a time from async iterables, so no file is held
 * in memory whole. Each entry's SHA-256 is computed while writing, for the
 * manifest.
 */
import type { Readable } from "node:stream";

export interface ZipWriter {
  /** Adds one entry; resolves with its uncompressed size and SHA-256. */
  add(
    name: string,
    data: Readable | AsyncIterable<Uint8Array> | string,
    options?: { store?: boolean },
  ): Promise<{ size: number; sha256: string }>;
  /** Central directory, ZIP64 end records; fsync. */
  finish(): Promise<void>;
  /** Close and delete the partial file. */
  abort(): Promise<void>;
}

export async function createZip(path: string): Promise<ZipWriter> {
  throw new Error("not implemented");
}

export interface ZipEntry {
  name: string;
  size: number;
  open(): Readable; // decompressed bytes
}
export async function readZip(path: string): Promise<ZipEntry[]> {
  throw new Error("not implemented");
}
