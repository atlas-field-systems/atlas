// Proves the CLI and the site have nothing hardcoded: add a brand-new definition
// in a temporary copy of definitions/, and both tools must pick it up unchanged.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const tmp = mkdtempSync(join(tmpdir(), 'atlas-'));
const defs = join(tmp, 'definitions');
cpSync('definitions', defs, { recursive: true });
writeFileSync(join(defs, 'messages/zz_dummy.json'), JSON.stringify({
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'https://atlas-field-systems.github.io/protocol/definitions/messages/zz_dummy.json',
  title: 'Dummy Probe',
  description: 'Exists only in this test.',
  type: 'object',
  required: ['header', 'probe_level'],
  properties: { header: { $ref: '../components/header.json' }, probe_level: { $ref: '../variables/zz_probe_level.json' } },
}));
writeFileSync(join(defs, 'variables/zz_probe_level.json'), JSON.stringify({
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'https://atlas-field-systems.github.io/protocol/definitions/variables/zz_probe_level.json',
  title: 'zz_probe_level', description: 'Test only.', type: 'integer', minimum: 7,
}));
const index = JSON.parse(readFileSync(join(defs, 'index.json'), 'utf8'));
index.groups[0].files.push('messages/zz_dummy.json');
index.groups.at(-1).files.push('variables/zz_probe_level.json');
writeFileSync(join(defs, 'index.json'), JSON.stringify(index));
const env = { ...process.env, ATLAS_DEFINITIONS: defs };

test('CLI lists and renders the new definition', () => {
  const list = execFileSync('node', ['cli/cli.mjs', '--list'], { env, encoding: 'utf8' });
  assert.match(list, /messages\/zz_dummy\.json\tDummy Probe/);
  const shown = JSON.parse(execFileSync('node', ['cli/cli.mjs', '--show', 'messages/zz_dummy.json'], { env, encoding: 'utf8' }));
  assert.equal(shown.value.probe_level, 7);
  assert.equal(shown.validation.ok, true);
  assert.ok(shown.size.bytes > 0);
});

test('site build ships the new definition and its lib renders it', async () => {
  const out = join(tmp, '_site');
  execFileSync('node', ['scripts/build-site.mjs'], { env: { ...env, SITE_OUT: out } });
  const lib = await import(pathToFileURL(join(out, 'lib/protocol.mjs')));
  const { default: Ajv } = await import('ajv/dist/2020.js');
  const { default: addFormats } = await import('ajv-formats');
  const p = await lib.loadProtocol((f) => JSON.parse(readFileSync(join(out, 'definitions', f), 'utf8')), Ajv, addFormats);
  assert.equal(p.schemas['messages/zz_dummy.json'].title, 'Dummy Probe');
  const value = lib.example(p, 'messages/zz_dummy.json');
  assert.equal(lib.validate(p, 'messages/zz_dummy.json', value).ok, true);
});

test('no tool source names any definition', () => {
  const names = readdirSync('definitions', { recursive: true }).filter((f) => f.endsWith('.json') && f !== 'index.json')
    .map((f) => f.split('/').pop().replace('.json', ''));
  for (const dir of ['lib', 'cli', 'site']) {
    for (const f of readdirSync(dir)) {
      const src = readFileSync(join(dir, f), 'utf8');
      for (const n of names) assert.ok(!new RegExp(`['"\`/]${n}[.'"\`]`).test(src), `${dir}/${f} mentions ${n}`);
    }
  }
});
