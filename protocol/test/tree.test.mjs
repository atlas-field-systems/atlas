// A field shows what its own definition says, also when that definition points at another one.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import Ajv from 'ajv/dist/2020.js';
import { loadProtocol, fieldTree, leaves, generate } from '../lib/protocol.mjs';

const id = (f) => `https://atlas-field-systems.github.io/protocol/definitions/${f}`;
const files = {
  'index.json': { title: 'Test', groups: [{ name: 'All', files: ['variables/zz_base.json', 'variables/zz_narrow.json', 'records/zz_probe.json'] }] },
  'variables/zz_base.json': { $id: id('variables/zz_base.json'), title: 'zz_base', description: 'Base text.', enum: ['a', 'b', 'c'], examples: ['a'] },
  'variables/zz_narrow.json': { $id: id('variables/zz_narrow.json'), title: 'zz_narrow', description: 'Narrow text.', $ref: 'zz_base.json', not: { const: 'a' }, examples: ['c'] },
  'records/zz_probe.json': { $id: id('records/zz_probe.json'), title: 'Probe', description: 'Test only.', type: 'object', required: ['plain', 'narrow'],
    properties: { plain: { $ref: '../variables/zz_base.json' }, narrow: { $ref: '../variables/zz_narrow.json' } } },
};
const protocol = await loadProtocol(async (f) => files[f], Ajv);
const tree = fieldTree(protocol, 'records/zz_probe.json');
const field = (name) => leaves(tree, {}).find((r) => r.path[0] === name).node;

test('a field keeps the description, examples and narrowing of the definition it points at', () => {
  const narrow = field('narrow');
  assert.equal(narrow.description, 'Narrow text.');
  assert.deepEqual(narrow.options, ['b', 'c']);
  assert.equal(narrow.source, 'variables/zz_narrow.json');
  assert.equal(generate(tree).narrow, 'c');
});

test('a field that points straight at a definition is unchanged', () => {
  const plain = field('plain');
  assert.equal(plain.description, 'Base text.');
  assert.deepEqual(plain.options, ['a', 'b', 'c']);
  assert.equal(generate(tree).plain, 'a');
});
