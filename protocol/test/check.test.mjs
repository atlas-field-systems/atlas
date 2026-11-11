import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

const check = (defs) => spawnSync('node', ['scripts/check.mjs'], { env: { ...process.env, ATLAS_DEFINITIONS: defs }, encoding: 'utf8' });

// Runs the check on a temporary copy of definitions/ after one change to it.
// edit(file, change) rewrites one definition; add(file, schema) writes a new one and lists it
// in index.json; write(file, value) writes any JSON file as given.
const broken = (change) => {
  const dir = mkdtempSync(join(tmpdir(), 'atlas-check-'));
  const defs = join(dir, 'definitions');
  cpSync('definitions', defs, { recursive: true });
  const read = (file) => JSON.parse(readFileSync(join(defs, file), 'utf8'));
  const write = (file, value) => { mkdirSync(dirname(join(defs, file)), { recursive: true }); writeFileSync(join(defs, file), JSON.stringify(value)); };
  const edit = (file, fn) => { const s = read(file); fn(s); write(file, s); };
  const add = (file, schema) => { write(file, schema); edit('index.json', (i) => i.groups[0].files.push(file)); };
  change({ read, write, edit, add });
  const result = check(defs);
  rmSync(dir, { recursive: true, force: true });
  return result;
};

const record = 'records/cancel.json';
const grouped = 'records/report/battery.json';
const withKinds = 'records/task.json';
const kind = 'records/task/takeoff.json';
const text = 'variables/explanation.json';
const id = 'variables/asset_id.json';
const base = 'https://atlas-field-systems.github.io/protocol/definitions/';

const cases = [
  ['a definition missing from index.json', ({ edit }) => edit('index.json', (i) => { i.groups[0].files = i.groups[0].files.filter((f) => f !== record); }), /records\/cancel\.json: not listed in index\.json/],
  ['an index.json entry with no file', ({ edit }) => edit('index.json', (i) => i.groups[0].files.push('records/zz_missing.json')), /index\.json: records\/zz_missing\.json does not exist/],
  ['a record nested too deep', ({ read, add }) => add('records/zz_a/zz_b/zz_c.json', { ...read(record), $id: `${base}records/zz_a/zz_b/zz_c.json` }), /law 5: records live at/],
  ['a definition without a description', ({ edit }) => edit(record, (s) => { delete s.description; }), /records\/cancel\.json: needs a description/],
  ['a variable whose title is not its file name', ({ edit }) => edit(text, (s) => { s.title = 'Explanation'; }), /variables\/explanation\.json: title must be "explanation"/],
  ['a definition without an example', ({ edit }) => edit(record, (s) => { s.examples = []; }), /records\/cancel\.json: needs at least one example/],
  ['an example that breaks its definition', ({ edit }) => edit(record, (s) => { s.examples[0].asset_id = 'TOOLONG'; }), /records\/cancel\.json: example 1 fails/],
  ['a reference to a definition that does not exist', ({ edit }) => edit(record, (s) => { s.properties.task_id.$ref = '../variables/zz_missing.json'; }), /records\/cancel\.json: .*zz_missing/],
  ['a record without time', ({ edit }) => edit(record, (s) => { s.required = s.required.filter((f) => f !== 'time'); }), /law 6: must require "time"/],
  ['a record carrying a creator counter', ({ edit }) => edit(record, (s) => { s.properties.seq = { $ref: '../variables/time.json' }; }), /law 6: records carry no "seq"/],
  ['a record with a wrapper field', ({ edit }) => edit(record, (s) => { s.properties.payload = { $ref: '../variables/time.json' }; }), /law 6: no "payload" wrapper field/],
  ['a record carrying a version', ({ edit }) => edit(record, (s) => { s.properties.protocol_version = { $ref: '../variables/time.json' }; }), /law 14/],
  ['a field defined inline', ({ edit }) => edit(record, (s) => { s.properties.note = { type: 'string' }; }), /law 2: "note"/],
  ['an asset_id that is not the shared variable', ({ edit }) => edit(record, (s) => { s.properties.asset_id.$ref = '../variables/task_id.json'; }), /law 6: asset_id must come from variables\/asset_id\.json/],
  ['a record that allows extra fields', ({ edit }) => edit(record, (s) => { delete s.additionalProperties; }), /law 6: must set additionalProperties to false/],
  ['a grouped record whose type is not its name', ({ edit }) => edit(grouped, (s) => { s.properties.type.const = 'report.power'; s.examples[0].type = 'report.power'; }), /law 5: a grouped record requires "type" from variables\/type\.json fixed to "report\.battery"/],
  ['an ungrouped record carrying type', ({ edit }) => edit(record, (s) => { s.properties.type = { $ref: '../variables/type.json' }; }), /law 5: only grouped records carry "type"/],
  ['a record without kinds carrying kind', ({ edit }) => edit(record, (s) => { s.properties.kind = { $ref: '../variables/kind.json' }; }), /law 5: "kind" only appears on records that have kinds/],
  ['a record with kinds that allows extra fields', ({ edit }) => edit(withKinds, (s) => { delete s.unevaluatedProperties; }), /law 6: a record with kinds sets unevaluatedProperties to false/],
  ['a record with kinds that does not require kind', ({ edit }) => edit(withKinds, (s) => { s.required = s.required.filter((f) => f !== 'kind'); }), /law 5: a record with kinds requires "kind"/],
  ['a kind defined inside its record', ({ edit }) => edit(withKinds, (s) => { s.oneOf.push({ type: 'object' }); }), /law 5: each oneOf branch is only a \$ref to a kind in records\/task\//],
  ['a kind listed twice', ({ edit }) => edit(withKinds, (s) => { s.oneOf.push(s.oneOf[0]); }), /law 5: kinds must be unique/],
  ['a kind without an example in its record', ({ edit }) => edit(withKinds, (s) => { s.examples = s.examples.filter((e) => e.kind !== 'takeoff'); }), /records\/task\.json: needs an example of kind "takeoff"/],
  ['a kind that no record uses', ({ edit }) => edit(withKinds, (s) => { s.oneOf = s.oneOf.filter((b) => b.$ref !== 'task/takeoff.json'); s.examples = s.examples.filter((e) => e.kind !== 'takeoff'); }), /records\/task\/takeoff\.json: law 5: no record uses this kind/],
  ['a kind whose kind value is not its file name', ({ edit }) => edit(kind, (s) => { s.properties.kind.const = 'launch'; s.examples[0].kind = 'launch'; }), /records\/task\/takeoff\.json: law 5: must require "kind" from variables\/kind\.json fixed to "takeoff"/],
  ['a kind carrying a field that belongs to its record', ({ edit }) => edit(kind, (s) => { s.properties.time = { $ref: '../../variables/time.json' }; }), /law 5: "time" belongs to the record, not the kind/],
  ['a kind that checks extra fields itself', ({ edit }) => edit(kind, (s) => { s.additionalProperties = false; }), /a kind leaves extra-field checks to its record/],
  ['an ID longer than 4 characters', ({ edit }) => edit(id, (s) => { s.pattern = '^[A-Za-z0-9]{1,8}$'; s.maxLength = 8; }), /variables\/asset_id\.json: law 10/],
  ['text without a length limit', ({ edit }) => edit(text, (s) => { delete s.maxLength; }), /variables\/explanation\.json: law 9: text needs a maxLength/],
  ['a Task kind missing from the command list', ({ edit }) => edit('variables/command.json', (s) => { s.enum = s.enum.filter((c) => c !== 'land'); }), /variables\/command\.json: law 12: its values must be the kinds in records\/task\/ except settings: land, move_to, return_to_home, takeoff/],
  ['a command in the list with no Task kind', ({ edit }) => edit('variables/command.json', (s) => { s.enum.push('hover'); }), /variables\/command\.json: law 12/],
  ['a report missing from the report list', ({ edit }) => edit('variables/report.json', (s) => { s.enum = s.enum.filter((r) => r !== 'battery'); s.examples = ['status']; }), /variables\/report\.json: law 11: its values must be the records in records\/report\/: battery, failsafe, settings, status, telemetry/],
  ['a setting missing from the setting list', ({ edit }) => edit('variables/setting.json', (s) => { s.enum = s.enum.filter((v) => v !== 'lights'); }), /variables\/setting\.json: law 12: its values must be the settings in components\/settings\.json/],
  ['a Task request kind the Task record lacks', ({ edit }) => edit('requests/task.json', (s) => { s.oneOf = s.oneOf.filter((b) => b.$ref !== '../records/task/land.json'); s.examples = s.examples.filter((e) => e.kind !== 'land'); }), /requests\/task\.json: law 12: its kinds must be exactly the kinds of records\/task\.json/],
  ['a request carrying a field Core stamps', ({ edit }) => edit('requests/settings.json', (s) => { s.properties.requested_by = { $ref: '../variables/requested_by.json' }; }), /requests\/settings\.json: law 1: "requested_by" is stamped by Core/],
  ['a Task kind carrying a field Core stamps', ({ edit }) => edit(kind, (s) => { s.properties.task_id = { $ref: '../../variables/task_id.json' }; }), /records\/task\/takeoff\.json: law 1: "task_id" is stamped by Core/],
  ['a request that allows extra fields', ({ edit }) => edit('requests/settings.json', (s) => { delete s.additionalProperties; }), /requests\/settings\.json: law 1: a request sets additionalProperties/],
  ['a list without a length limit', ({ edit }) => edit('records/report/status/queue.json', (s) => { delete s.properties.task_ids.maxItems; }), /law 9: list "task_ids" needs a maxItems/],
];

test('the definitions pass', () => {
  const r = check('definitions');
  assert.equal(r.status, 0, r.stderr);
});

for (const [name, change, message] of cases) {
  test(`${name} fails`, () => {
    const r = broken(change);
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, message);
  });
}
