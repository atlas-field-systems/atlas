// Proves the CLI and the site have nothing hardcoded: add a brand-new definition
// in a temporary copy of definitions/, and both tools must pick it up unchanged.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';

const tmp = mkdtempSync(join(tmpdir(), 'atlas-'));
const defs = join(tmp, 'definitions');
cpSync('definitions', defs, { recursive: true });
// A new group (zz_probe) with a new type (dummy) that has one kind (ping).
mkdirSync(join(defs, 'records/zz_probe/dummy'), { recursive: true });
writeFileSync(join(defs, 'records/zz_probe/dummy.json'), JSON.stringify({
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'https://atlas-field-systems.github.io/protocol/definitions/records/zz_probe/dummy.json',
  title: 'Dummy Probe',
  description: 'Exists only in this test.',
  type: 'object',
  required: ['type', 'time', 'kind'],
  oneOf: [{ $ref: 'dummy/ping.json' }],
  unevaluatedProperties: false,
  properties: { type: { $ref: '../../variables/type.json', const: 'zz_probe.dummy' }, time: { $ref: '../../variables/time.json' }, kind: { $ref: '../../variables/kind.json' } },
}));
writeFileSync(join(defs, 'records/zz_probe/dummy/ping.json'), JSON.stringify({
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'https://atlas-field-systems.github.io/protocol/definitions/records/zz_probe/dummy/ping.json',
  title: 'ping', description: 'Test only.', type: 'object', required: ['kind', 'probe_level'],
  properties: { kind: { $ref: '../../../variables/kind.json', const: 'ping' }, probe_level: { $ref: '../../../variables/zz_probe_level.json' } },
}));
writeFileSync(join(defs, 'variables/zz_probe_level.json'), JSON.stringify({
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'https://atlas-field-systems.github.io/protocol/definitions/variables/zz_probe_level.json',
  title: 'zz_probe_level', description: 'Test only.', type: 'integer', minimum: 7,
}));
const index = JSON.parse(readFileSync(join(defs, 'index.json'), 'utf8'));
index.groups[0].files.push('records/zz_probe/dummy.json');
index.groups[1].files.push('records/zz_probe/dummy/ping.json');
index.groups.at(-1).files.push('variables/zz_probe_level.json');
writeFileSync(join(defs, 'index.json'), JSON.stringify(index));
const env = { ...process.env, ATLAS_DEFINITIONS: defs };

test('CLI lists and renders the new definition', () => {
  const list = execFileSync('node', ['cli/cli.mjs', '--list'], { env, encoding: 'utf8' });
  assert.match(list, /records\/zz_probe\/dummy\.json@ping\tzz_probe › dummy › ping/);
  const shown = JSON.parse(execFileSync('node', ['cli/cli.mjs', '--show', 'records/zz_probe/dummy.json@ping'], { env, encoding: 'utf8' }));
  assert.equal(shown.value.probe_level, 7);
  assert.equal(shown.value.type, 'zz_probe.dummy');
  assert.equal(shown.value.kind, 'ping');
  assert.ok(shown.size.hex.length > 0 && shown.size.base64.length > 0);
  assert.equal(shown.validation.ok, true);
  assert.ok(shown.size.bytes > 0);
});

test('site bundle renders and validates the new definition without external imports', async () => {
  const out = join(tmp, '_site');
  execFileSync('node', ['scripts/build-site.mjs'], { env: { ...env, SITE_OUT: out, SITE_PULL_REQUESTS: '' } });
  assert.equal(existsSync(join(out, 'lib')), false);
  assert.deepEqual(JSON.parse(readFileSync(join(out, 'pull-requests.json'), 'utf8')), []);
  const elements = {};
  const requests = [];
  const bundle = readFileSync(join(out, 'app.mjs'), 'utf8');
  await runInNewContext(`(async () => { ${bundle}\n })()`, {
    document: {
      getElementById: (id) => elements[id] ??= {},
      querySelectorAll: () => [],
    },
    location: { pathname: '/', hash: '#records/zz_probe/dummy.json@ping' },
    window: {},
    TextEncoder,
    TextDecoder,
    structuredClone,
    btoa,
    fetch: async (path) => {
      requests.push(path);
      const body = readFileSync(join(out, path), 'utf8');
      return { json: async () => JSON.parse(body), text: async () => body };
    },
  });
  assert.ok(requests.every((path) => !/^https?:/.test(path)), 'site must load local files only');
  assert.match(elements.nav.innerHTML, /records\/zz_probe\/dummy\.json@ping/);
  const value = JSON.parse(elements.json.value);
  assert.equal(value.type, 'zz_probe.dummy');
  assert.equal(value.kind, 'ping');
  assert.equal(value.probe_level, 7);
  assert.match(elements.verdict.innerHTML, /\bValid\b/);
  elements.json.value = JSON.stringify({ ...value, extra: 1 });
  elements.json.oninput();
  assert.match(elements.verdict.innerHTML, /\bInvalid\b/);
});

test('no tool source names any definition', () => {
  const names = readdirSync('definitions', { recursive: true }).filter((f) => f.endsWith('.json') && f !== 'index.json')
    .map((f) => f.split('/').pop().replace('.json', ''))
    // type and kind are the two fields that say which record this is, so the tools may use them.
    .filter((n) => !['type', 'kind'].includes(n));
  for (const dir of ['lib', 'cli', 'site']) {
    for (const f of readdirSync(dir)) {
      const src = readFileSync(join(dir, f), 'utf8');
      for (const n of names) assert.ok(!new RegExp(`['"\`/]${n}[.'"\`]`).test(src), `${dir}/${f} mentions ${n}`);
    }
  }
});

