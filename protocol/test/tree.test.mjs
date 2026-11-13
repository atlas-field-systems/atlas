// A field shows what its own definition says, also when that definition points at another one.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadDefinitions } from '../lib/definitions.mjs';
import { fieldTree, leaves, generate, setPath, parseInput } from '../lib/protocol.mjs';

const id = (f) => `https://atlas-field-systems.github.io/protocol/definitions/${f}`;
const files = {
  'index.json': { title: 'Test', groups: [{ name: 'All', files: ['variables/zz_base.json', 'variables/zz_narrow.json', 'variables/zz_kind.json', 'variables/zz_size.json',
    'records/zz_probe.json', 'records/zz_list.json', 'components/zz_shape.json', 'components/zz_shape/zz_round.json', 'components/zz_shape/zz_square.json'] }] },
  'variables/zz_kind.json': { $id: id('variables/zz_kind.json'), title: 'zz_kind', description: 'Kind.', type: 'string', examples: ['zz_round'] },
  'variables/zz_size.json': { $id: id('variables/zz_size.json'), title: 'zz_size', description: 'Size.', type: 'integer', examples: [3] },
  'records/zz_list.json': { $id: id('records/zz_list.json'), title: 'List', description: 'Test only.', type: 'object',
    properties: { shapes: { type: 'array', items: { $ref: '../components/zz_shape.json' }, maxItems: 4 } } },
  'components/zz_shape.json': { $id: id('components/zz_shape.json'), title: 'zz_shape', description: 'Shape.', type: 'object', required: ['kind'],
    oneOf: [{ $ref: 'zz_shape/zz_round.json' }, { $ref: 'zz_shape/zz_square.json' }], unevaluatedProperties: false,
    properties: { kind: { $ref: '../variables/zz_kind.json' } } },
  'components/zz_shape/zz_round.json': { $id: id('components/zz_shape/zz_round.json'), title: 'zz_round', description: 'Round.', type: 'object', required: ['kind', 'radius'],
    properties: { kind: { $ref: '../../variables/zz_kind.json', const: 'zz_round' }, radius: { $ref: '../../variables/zz_size.json' } } },
  'components/zz_shape/zz_square.json': { $id: id('components/zz_shape/zz_square.json'), title: 'zz_square', description: 'Square.', type: 'object', required: ['kind', 'side'],
    properties: { kind: { $ref: '../../variables/zz_kind.json', const: 'zz_square' }, side: { $ref: '../../variables/zz_size.json' } } },
  'variables/zz_base.json': { $id: id('variables/zz_base.json'), title: 'zz_base', description: 'Base text.', enum: ['a', 'b', 'c'], examples: ['a'] },
  'variables/zz_narrow.json': { $id: id('variables/zz_narrow.json'), title: 'zz_narrow', description: 'Narrow text.', $ref: 'zz_base.json', not: { const: 'a' }, examples: ['c'] },
  'records/zz_probe.json': { $id: id('records/zz_probe.json'), title: 'Probe', description: 'Test only.', type: 'object', required: ['plain', 'narrow'],
    properties: { plain: { $ref: '../variables/zz_base.json' }, narrow: { $ref: '../variables/zz_narrow.json' } } },
};
const protocol = await loadDefinitions(new Map(Object.entries(files).map(([path, value]) => [path, new TextEncoder().encode(JSON.stringify(value))])));
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

// README Try it: edit any field to see the effect.
test('an item in a list shows the fields of the kind it names, and offers every kind', () => {
  const rows = leaves(fieldTree(protocol, 'records/zz_list.json'), { shapes: [{ kind: 'zz_round' }, { kind: 'zz_square' }] });
  assert.deepEqual(rows.map((r) => r.path.join('.')), ['shapes.0.kind', 'shapes.0.radius', 'shapes.1.kind', 'shapes.1.side']);
  assert.deepEqual(rows[0].node.options, ['zz_round', 'zz_square']);
});

test('a definition that is a single value can be edited', () => {
  const [row] = leaves(fieldTree(protocol, 'variables/zz_size.json'), 3);
  assert.equal(setPath(3, row.path, 4), 4);
});

test('typed numbers reach the checker as typed', () => {
  assert.equal(parseInput({ kind: 'integer' }, '1.9'), 1.9);
  assert.equal(parseInput({ kind: 'integer' }, '12abc'), '12abc');
  assert.equal(parseInput({ kind: 'number' }, '1e3'), 1000);
  assert.equal(parseInput({ kind: 'boolean' }, 'yes'), 'yes');
});
