// Sets the protocol version everywhere it is written. Run: npm run bump -- <major.minor>
// variables/protocol_version.json holds it; every example copies it; npm run check rejects a copy that differs.
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { render } from './scenarios.mjs';

const version = process.argv[2];
if (!/^\d+\.\d+$/.test(version ?? '')) {
  console.error('Usage: npm run bump -- <major.minor>, such as 0.8');
  process.exit(1);
}

const source = 'definitions/variables/protocol_version.json';
const files = ['definitions', 'examples'].flatMap((dir) =>
  readdirSync(dir, { recursive: true }).filter((f) => f.endsWith('.json')).map((f) => join(dir, f)));
let copies = 0;
for (const file of files) {
  const text = readFileSync(file, 'utf8');
  const next = file === source
    ? text.replace(/"examples": \[\s*"[^"]*"\s*\]/, `"examples": [\n    "${version}"\n  ]`)
    : text.replace(/"protocol_version": "[^"]*"/g, () => { copies++; return `"protocol_version": "${version}"`; });
  if (next !== text) writeFileSync(file, next);
}
for (const name of JSON.parse(readFileSync('examples/index.json', 'utf8'))) {
  writeFileSync(`docs/${name}-messages.md`, await render(name));
}
console.log(`Protocol version is now ${version}: ${source} and ${copies} copies in examples. Add docs/changelog.md ## ${version}.`);
