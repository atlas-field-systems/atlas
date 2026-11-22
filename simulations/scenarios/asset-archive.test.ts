import assert from "node:assert/strict";
import { copyFile, mkdir, readFile, writeFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { unzipSync, zipSync, strFromU8 } from "fflate";
import { assetApp } from "../src/asset-app.ts";
import { scenario } from "../src/scenario.ts";
import { checkAssetArchive } from "../src/asset-archive.ts";

scenario({
  name: "recovery checker accepts only a torn final report with gap evidence",
  checks: ["asset/docs/logging.md#export-the-assets-reset-zip"],
  async run(w) {
    const app = await assetApp(w);
    const { log_directory, archive_directory } = app.config;
    const [live] = await readdir(log_directory);

    // Seed the files an interrupted operation would leave on disk.
    const earlier = join(log_directory, "1000");
    await mkdir(join(earlier, "reports"), { recursive: true });
    await mkdir(join(earlier, "diagnostics"));
    for (const file of ["config.json", "versions.json"])
      await copyFile(join(log_directory, live, file), join(earlier, file));
    await writeFile(join(earlier, "operation.json"),
      JSON.stringify({ start: 1000, asset_id: "unregistered", archive_directory }));
    const report = JSON.stringify({ type: "report.status", kind: "task", task_id: 1, task_state: "completed", time: 1500 }) + "\n";
    await writeFile(join(earlier, "reports/history.jsonl"), report + "{");
    await w.advance(1000);
    await app.restart();
    await app.stop();
    const names = await readdir(archive_directory);
    const recovered = join(archive_directory, names.find(name => name.includes("unregistered"))!);
    assert.equal((await checkAssetArchive(recovered, false)).reports.length, 1);
    const base = unzipSync(await readFile(recovered));
    for (const variant of ["torn", "normal", "complete-malformed", "earlier-malformed", "missing-gap"]) {
      const zip = { ...base };
      const manifest = JSON.parse(strFromU8(zip["manifest.json"]));
      manifest.normal = variant === "normal";
      manifest.gaps = variant === "missing-gap" ? [] : [{ start: 1000, end: 2000, dropped: 1, reason: "incomplete report line; original bytes retained" }];
      zip["summary.md"] = Buffer.from(strFromU8(zip["summary.md"]) + "\nthe app stopped unexpectedly; this record may be incomplete\n" + manifest.gaps.map((g: { reason: string }) => g.reason).join("\n"));
      zip["reports/history.jsonl"] = Buffer.from(variant === "earlier-malformed" ? '{\n' + report : report + '{' + (variant === "complete-malformed" ? '\n' : ''));
      manifest.files = Object.entries(zip).filter(([path]) => path !== "manifest.json").map(([path, bytes]) => ({ path, size: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") }));
      zip["manifest.json"] = Buffer.from(JSON.stringify(manifest));
      const path = join(w.root, `${variant}.zip`);
      await writeFile(path, zipSync(zip));
      if (variant === "torn") assert.equal((await checkAssetArchive(path, false)).reports.length, 1);
      else await assert.rejects(checkAssetArchive(path, manifest.normal), variant);
    }
  },
});
