import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const check = (defs) => spawnSync('node', ['scripts/check.mjs'], { env: { ...process.env, ATLAS_DEFINITIONS: defs }, encoding: 'utf8' });

const broken = (change) => {
  const defs = join(mkdtempSync(join(tmpdir(), 'atlas-check-')), 'definitions');
  cpSync('definitions', defs, { recursive: true });
  const file = join(defs, JSON.parse(readFileSync(join(defs, 'index.json'), 'utf8')).groups[0].files[0]);
  const s = JSON.parse(readFileSync(file, 'utf8'));
  change(s);
  writeFileSync(file, JSON.stringify(s));
  return check(defs);
};

test('the definitions pass', () => {
  assert.equal(check('definitions').status, 0);
});

test('a record without time fails', () => {
  const r = broken((s) => { s.required = s.required.filter((f) => f !== 'time'); });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /law 6: must require "time"/);
});

test('a record carrying a creator counter fails', () => {
  const r = broken((s) => { s.properties.seq = { $ref: '../variables/time.json' }; });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /law 6: records carry no "seq"/);
});

test('a record carrying a version fails', () => {
  const r = broken((s) => { s.properties.protocol_version = { $ref: '../variables/time.json' }; });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /law 14/);
});

test('a field defined inline fails', () => {
  const r = broken((s) => { s.properties.note = { type: 'string' }; });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /law 2: "note"/);
});
