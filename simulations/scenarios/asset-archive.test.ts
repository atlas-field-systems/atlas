import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { unzipSync, zipSync, strFromU8 } from "fflate";
import { parseConfig } from "@atlas/asset";
import { createLog } from "../../asset/src/logging.ts";
import { checkAssetArchive } from "../src/asset-archive.ts";

test("asset/docs/logging.md: recovery checker accepts only a torn final report with gap evidence", async t => {
  const root = await mkdtemp(join(tmpdir(), "atlas-check-archive-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const config = parseConfig(JSON.parse(await readFile(new URL("../../asset/examples/copter.json", import.meta.url), "utf8")));
  config.log_directory = join(root, "logs");
  config.archive_directory = join(root, "archives");
  const log = await createLog(config, 1000);
  log.report({ type: "report.status", kind: "task", task_id: 1, task_state: "completed", time: 1500 });
  const base = unzipSync(await readFile(await log.close("A", "stopped")));
  const report = strFromU8(base["reports/history.jsonl"]);
  for (const variant of ["torn", "normal", "complete-malformed", "earlier-malformed", "missing-gap"]) {
    const zip = { ...base };
    const manifest = JSON.parse(strFromU8(zip["manifest.json"]));
    manifest.normal = variant === "normal";
    manifest.gaps = variant === "missing-gap" ? [] : [{ start: 1000, end: 2000, dropped: 1, reason: "incomplete report line; original bytes retained" }];
    zip["summary.md"] = Buffer.from(strFromU8(zip["summary.md"]) + "\nthe app stopped unexpectedly; this record may be incomplete\n" + manifest.gaps.map((g: { reason: string }) => g.reason).join("\n"));
    zip["reports/history.jsonl"] = Buffer.from(variant === "earlier-malformed" ? '{\n' + report : report + '{' + (variant === "complete-malformed" ? '\n' : ''));
    manifest.files = Object.entries(zip).filter(([path]) => path !== "manifest.json").map(([path, bytes]) => ({ path, size: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") }));
    zip["manifest.json"] = Buffer.from(JSON.stringify(manifest));
    const path = join(root, `${variant}.zip`);
    await writeFile(path, zipSync(zip));
    if (variant === "torn") assert.equal((await checkAssetArchive(path, false)).reports.length, 1);
    else await assert.rejects(checkAssetArchive(path, manifest.normal), variant);
  }
});
