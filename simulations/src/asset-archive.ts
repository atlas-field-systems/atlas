import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { unzipSync, strFromU8 } from "fflate";

export async function checkAssetArchive(path: string, normal: boolean) {
  const zip = unzipSync(await readFile(path));
  for (const name of ["README.md", "summary.md", "manifest.json", "config.json", "versions.json", "reports/history.jsonl"])
    assert.ok(zip[name]?.length, `archive includes ${name}`);
  const manifest = JSON.parse(strFromU8(zip["manifest.json"]));
  assert.equal(manifest.normal, normal);
  assert.deepEqual(Object.keys(zip).sort(), [...manifest.files.map((file: { path: string }) => file.path), "manifest.json"].sort());
  for (const file of manifest.files) {
    assert.equal(zip[file.path].length, file.size, file.path);
    assert.equal(createHash("sha256").update(zip[file.path]).digest("hex"), file.sha256, file.path);
  }
  const summary = strFromU8(zip["summary.md"]);
  assert.match(summary, /Operation \d+ to \d+/);
  assert.match(summary, /task_state/);
  if (!normal) assert.match(summary, /the app stopped unexpectedly; this record may be incomplete/);
  for (const gap of manifest.gaps) {
    assert.equal(typeof gap.start, "number");
    assert.equal(typeof gap.end, "number");
    assert.ok(gap.end >= gap.start);
    assert.ok(summary.includes(gap.reason));
  }
  assert.ok(Object.keys(zip).some(name => name.startsWith("diagnostics/")));
  const versions = JSON.parse(strFromU8(zip["versions.json"]));
  assert.match(versions.definitions_hash, /^sha256:[a-f0-9]{64}$/);
  assert.equal(versions.app, "0.1.0");
  assert.equal(versions.sdk, "0.1.0");
  assert.equal(versions.protocol, "0.1.0");
  const lines = strFromU8(zip["reports/history.jsonl"]).split("\n");
  const reports = [];
  for (const [index, line] of lines.entries()) {
    if (!line && index === lines.length - 1) continue;
    try { reports.push(JSON.parse(line)); }
    catch (error) {
      if (normal || index !== lines.length - 1) throw error;
      assert.ok(manifest.gaps.some((gap: { reason: string; dropped: number }) =>
        gap.reason === "incomplete report line; original bytes retained" && gap.dropped >= 1),
      "torn final report has gap evidence");
    }
  }
  assert.ok(reports.some(report => report.type === "report.status" && report.kind === "task"));
  return { zip, manifest, reports };
}
