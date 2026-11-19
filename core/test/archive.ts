// Read the public Reset format independently of the Go archive writer.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { Readable } from "node:stream";
import { unzipSync } from "fflate";

export async function readZip(path: string) {
  const entries = unzipSync(await readFile(path));
  return Object.entries(entries).map(([name, bytes]) => ({
    name, size: bytes.length, open: () => Readable.from([Buffer.from(bytes)]),
  }));
}
export async function checkZip(path: string, runId?: number) {
  try {
    await promisify(execFile)("unzip", ["-tqq", path]);
    const entries = unzipSync(await readFile(path));
    const manifest = JSON.parse(Buffer.from(entries["manifest.json"]).toString());
    if (runId !== undefined && runId !== manifest.run_id) throw Error("Wrong run");
    delete entries["manifest.json"];
    if (Object.keys(entries).length !== Object.keys(manifest.files).length) throw Error("Wrong entry count");
    for (const [name, bytes] of Object.entries(entries)) {
      const digest = createHash("sha256").update(bytes).digest("hex");
      if (manifest.files[name]?.size !== bytes.length || manifest.files[name]?.sha256 !== digest) throw Error(name);
    }
    return {ok:true};
  } catch (e) { return {ok:false, why:String(e)}; }
}
