// Bundle the shared validator and package the original UTF-8 definitions as data.
import { build } from "../../protocol/node_modules/esbuild/lib/main.js";
import { readDefinitionFiles } from "../../protocol/lib/node-definitions.mjs";
import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

const files = [...await readDefinitionFiles()].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
const definitions = files.map(([name, bytes]) => [name, Buffer.from(bytes).toString("utf8")]);
const { outputFiles } = await build({
  entryPoints: [fileURLToPath(new URL("protocol.mjs", import.meta.url))],
  write: false, platform: "browser", format: "iife", bundle: true, target: "es2020", minify: true,
});
const output = new URL("../internal/protocol/", import.meta.url);
await Promise.all([
  writeFile(new URL("validator.js.gz", output), gzipSync(outputFiles[0].contents)),
  writeFile(new URL("definitions.json.gz", output), gzipSync(JSON.stringify(definitions))),
]);
