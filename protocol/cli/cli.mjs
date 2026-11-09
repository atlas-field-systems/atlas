#!/usr/bin/env node
// Atlas Protocol viewer for the terminal. Everything shown comes from definitions/.
import { select, input } from '@inquirer/prompts';
import { load, compress } from '../lib/node-protocol.mjs';
import { fieldTree, leaves, example, generate, setPath, parseInput, validate, measure, describeType, recordTree, splitId } from '../lib/protocol.mjs';

const protocol = await load();
const dim = (s) => `\x1b[2m${s}\x1b[0m`;
const bold = (s) => `\x1b[1m${s}\x1b[0m`;

function printFields(n, depth = 0) {
  const pad = '  '.repeat(depth);
  if (depth > 0) {
    console.log(`${pad}${bold(n.name)}${n.required ? '' : dim(' (optional)')}  ${dim(describeType(n))}`);
    if (n.description) console.log(`${pad}  ${dim(n.description)}`);
  }
  if (n.kind === 'object') n.children.forEach((c) => printFields(c, depth + 1));
  if (n.kind === 'array') printFields(n.item, depth + 1);
}

function report(file, value) {
  const v = validate(protocol, file, value);
  const m = measure(value, compress);
  const left = ['Record JSON', ...JSON.stringify(value, null, 2).split('\n')];
  const right = [`Compact JSON (sent minified on one line: ${m.bytes} bytes)`, ...m.aligned.split('\n'), '', `Compressed (deflate, ${m.compressed} bytes)`, ...m.hex.split('\n'), '', 'Base64:', ...(m.base64.match(/.{1,64}/g) ?? [])];
  const width = Math.max(...left.map((l) => l.length)) + 3;
  console.log();
  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    console.log((left[i] ?? '').padEnd(width) + dim(right[i] ?? ''));
  }
  console.log(v.ok ? '\x1b[32mValid\x1b[0m' : '\x1b[31mInvalid\x1b[0m\n  ' + v.errors.join('\n  '));
  console.log(`Size: ${m.bytes} bytes as compact JSON, ${m.compressed} bytes compressed (deflate)`);
  console.log('Largest fields:');
  m.fields.slice(0, 5).forEach((f) => console.log(`  ${String(f.bytes).padStart(4)} B  ${f.path}`));
  console.log();
}

// Every definition to pick from: records as group › record › kind, then the other groups.
// Kinds are shown under their records, so the group listing kind files is not repeated.
function entries() {
  const out = [];
  const records = recordTree(protocol).flatMap((g) => g.records);
  for (const r of records) {
    const path = r.name.replaceAll('.', ' › ');
    if (!r.kinds.length) out.push({ group: 'Records', id: r.file, name: path, description: protocol.schemas[r.file].description });
    for (const k of r.kinds) out.push({ group: 'Records', id: `${r.file}@${k.name}`, name: `${path} › ${k.name}`, description: protocol.schemas[k.file].description });
  }
  const shown = new Set(records.flatMap((r) => [r.file, ...r.kinds.map((k) => k.file)]));
  for (const g of protocol.index.groups) for (const f of g.files) if (!shown.has(f)) out.push({ group: g.name, id: f, name: protocol.schemas[f].title, description: protocol.schemas[f].description });
  return out;
}

async function viewFile(id) {
  const tree = fieldTree(protocol, id);
  const { file, kind } = splitId(id);
  const s = protocol.schemas[file];
  const k = kind && entries().find((e) => e.id === id);
  console.log(`\n${bold(k ? k.name : s.title ?? file)}  ${dim(id)}\n${s.description ?? ''}${k ? `\n${k.description}` : ''}\n`);
  printFields(tree);
  let value = example(protocol, id);
  report(id, value);
  for (;;) {
    const action = await select({
      message: 'What next?',
      choices: [
        { name: 'Edit a field', value: 'edit' },
        { name: 'Use the example from the definition', value: 'example' },
        { name: 'Generate a minimal record (required fields only)', value: 'generate' },
        { name: 'Back', value: 'back' },
      ],
    });
    if (action === 'back') return;
    if (action === 'example') value = example(protocol, id);
    if (action === 'generate') value = generate({ ...tree, schema: {} });
    if (action === 'edit') {
      const rows = leaves(tree, value);
      const row = await select({
        message: 'Which field?',
        choices: rows.map((r) => ({
          name: `${r.path.join('.')} = ${JSON.stringify(r.value) ?? dim('(empty)')}`,
          value: r,
          description: r.node.description,
        })),
        pageSize: 20,
      });
      const next = row.node.kind === 'enum'
        ? await select({ message: row.path.join('.'), choices: [...row.node.options, '(remove)'].map((o) => ({ value: o })) })
        : await input({ message: `${row.path.join('.')} (${describeType(row.node)}, empty to remove)`, default: row.value === undefined ? '' : String(row.value) });
      value = setPath(value, row.path, next === '(remove)' ? undefined : parseInput(row.node, next));
    }
    report(id, value);
  }
}

if (process.argv[2] === '--list') {
  for (const e of entries()) console.log(`${e.group}\t${e.id}\t${e.name}`);
} else if (process.argv[2] === '--show') {
  const file = process.argv[3];
  const value = example(protocol, file);
  console.log(JSON.stringify({ file, value, validation: validate(protocol, file, value), size: measure(value, compress) }));
} else {
  console.log(bold(protocol.index.title));
  try {
    for (;;) {
      const file = await select({
        message: 'Pick a definition',
        pageSize: 25,
        choices: entries().map((e) => ({ name: `${e.group.padEnd(11)} ${e.name}`, value: e.id, description: e.description })),
      });
      await viewFile(file);
    }
  } catch (e) {
    if (e.name !== 'ExitPromptError') throw e;
  }
}
