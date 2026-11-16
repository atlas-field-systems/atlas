import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { zipSync } from "fflate";
import { inventory, writeZip, verifyZip } from "../src/archive.ts";

test("docs/logging.md: ZIP verification treats embedded ZIP bytes as captured payload", async t => {
  const root = await mkdtemp(join(tmpdir(), "atlas-embedded-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(join(root, "capture.zip"), zipSync({ "inner.txt": Buffer.from("captured evidence") }));
  await writeFile(join(root, "manifest.json"), "{}");
  const files = await inventory(root);
  const { createHash } = await import("node:crypto");
  const expected = [...files, { path: "manifest.json", size: 2, sha256: createHash("sha256").update("{}").digest("hex") }];
  const path = join(root, "outer.zip");
  await writeZip(root, path, files);
  await verifyZip(path, expected);
  await assert.rejects(verifyZip(path, expected.map(file => ({ ...file, sha256: "0".repeat(64) }))));
});
