import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadPackagedProtocol, loadProtocol } from '@atlas/protocol';
import { loadProtocol as loadBrowserProtocol } from '@atlas/protocol/browser';
import { readDefinitionFiles } from '../lib/node-definitions.mjs';
import { hashDefinitions } from '../lib/definitions.mjs';

const protocol = await loadPackagedProtocol();

test('docs/decisions.md Definitions hash: exact documented byte vector', async () => {
  const encode = (text) => new TextEncoder().encode(text);
  const files = new Map([
    ['variables/a_id.json', encode('{"title":"a_id"}\n')],
    ['index.json', encode('{"title":"T"}\n')],
  ]);
  assert.equal(await hashDefinitions(files),
    'sha256:b393b32791af143e2e3f7b210546be519504aca5204b2bf1ecad03303c640209');
});

test('docs/decisions.md Definitions hash: packaged and browser loaders use the same exact bytes', async () => {
  const files = await readDefinitionFiles();
  const browser = await loadBrowserProtocol(files);
  assert.equal(browser.hash, protocol.hash);
  assert.deepEqual(browser.names, protocol.names);
  // Wording and index bytes count even though JSON parsing discards whitespace.
  const bytes = files.get('index.json');
  files.set('index.json', new Uint8Array([...bytes, 0x20]));
  assert.notEqual((await loadProtocol(files)).hash, protocol.hash);
});

const cases = [
  ['docs/laws.md law 6: extra record fields are refused', 'cancel',
    { time: 1793667600000, asset_id: 'A1', task_id: 1, requested_by: 'OP1', extra: true }, '/extra'],
  ['docs/laws.md law 1: requests cannot carry Core-stamped time', 'requests.tasks',
    { time: 1793667600000, tasks: [{ kind: 'hold' }] }, '/time'],
  ['docs/decisions.md Tasks: a clip requires duration_s', 'requests.tasks',
    { tasks: [{ kind: 'capture', camera_id: 'C1', media: 'clip' }] }, '/tasks/0/duration_s'],
  ['docs/laws.md law 6: required time is reported at its JSON Pointer', 'cancel',
    { asset_id: 'A1', task_id: 1, requested_by: 'OP1' }, '/time'],
  ['docs/laws.md law 5: grouped records require their own type', 'report.status',
    { type: 'report.battery', time: 1793667600000, asset_id: 'A1', kind: 'queue', task_ids: [] }, '/type'],
  ['docs/laws.md law 1: problem paths escape JSON Pointer tokens', 'requests.tasks',
    { tasks: [{ kind: 'hold' }], 'a~/b': true }, '/a~0~1b'],
];
for (const [rule, name, value, path] of cases) {
  test(rule, () => {
    const result = protocol.check(name, value);
    assert.equal(result.ok, false);
    assert.ok(result.problems.some((problem) => problem.path === path && problem.message.length > 0), JSON.stringify(result));
  });
}

test('docs/laws.md law 5: names identify whole records and requests, never kind files', () => {
  assert.ok(protocol.names.includes('task'));
  assert.ok(protocol.names.includes('report.status'));
  assert.ok(protocol.names.includes('plugin.result'));
  assert.ok(protocol.names.includes('requests.tasks'));
  assert.ok(!protocol.names.includes('task.capture'));
  assert.throws(() => protocol.check('task.capture', {}), /Unknown Protocol name/);
  assert.throws(() => protocol.check('not_a_record', {}), /Unknown Protocol name/);
  assert.deepEqual(protocol.check('requests.tasks', { tasks: [{ kind: 'hold' }] }), { ok: true });
});

test('README Use the library: a kind reports only its own problems', () => {
  const result = protocol.check('requests.tasks', { tasks: [{ kind: 'capture', camera_id: 'C1', media: 'clip' }] });
  assert.deepEqual(result, { ok: false, problems: [{ path: '/tasks/0/duration_s', message: 'is required' }] });
});

test('README Use the library: an unknown kind is one problem that lists the kinds', () => {
  const { problems } = protocol.check('requests.task', { kind: 'fly', destination: { latitude: 1, longitude: 1 } });
  assert.equal(problems.length, 1, JSON.stringify(problems));
  assert.equal(problems[0].path, '/kind');
  assert.match(problems[0].message, /^must be one of .*"takeoff".*"capture"/);
});

test('README Use the library: the definition files must include index.json', async () => {
  await assert.rejects(loadProtocol(new Map()), /index\.json/);
});
