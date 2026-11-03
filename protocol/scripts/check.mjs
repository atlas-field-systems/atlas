// Checks every definition: valid JSON Schema, listed in index.json,
// examples pass, and messages/components only reference variables or components.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import Ajv from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

const root = 'definitions';
const kinds = ['variables', 'components', 'messages'];
const ajv = new Ajv({ strict: true, allErrors: true });
addFormats(ajv);
ajv.addKeyword('short_name');

const errors = [];
// A message or component may only point at definitions: a $ref, a $ref fixed to one
// value (const), or a list of a $ref. It never defines a field itself.
const onlyReferences = (full) => {
  const { short_name, ...d } = full;
  const keys = Object.keys(d).sort().join();
  if (keys === '$ref' || keys === '$ref,const') return true;
  const list = Object.keys(d).filter((k) => !['minItems', 'maxItems'].includes(k)).sort().join();
  return d.type === 'array' && list === 'items,type' && Object.keys(d.items).join() === '$ref';
};
const files = kinds.flatMap((k) =>
  readdirSync(join(root, k)).filter((f) => f.endsWith('.json')).map((f) => `${k}/${f}`));
const schemas = Object.fromEntries(
  files.map((f) => [f, JSON.parse(readFileSync(join(root, f), 'utf8'))]));
for (const s of Object.values(schemas)) ajv.addSchema(s);

const index = JSON.parse(readFileSync(join(root, 'index.json'), 'utf8'));
const listed = index.groups.flatMap((g) => g.files);
for (const f of files) if (!listed.includes(f)) errors.push(`${f}: not listed in index.json`);
for (const f of listed) if (!schemas[f]) errors.push(`index.json: ${f} does not exist`);

for (const [file, s] of Object.entries(schemas)) {
  const name = file.split('/')[1].replace('.json', '');
  if (!s.description) errors.push(`${file}: needs a description`);
  if (file.startsWith('variables/') && s.title !== name) errors.push(`${file}: title must be "${name}"`);
  if (!s.examples?.length) errors.push(`${file}: needs at least one example`);
  if (!file.startsWith('variables/')) {
    for (const [prop, def] of Object.entries(s.properties ?? {})) {
      if (!onlyReferences(def)) errors.push(`${file}: "${prop}" must be a $ref, a $ref with a fixed const, or a list of a $ref (define fields once, in variables/)`);
    }
  }
  try {
    const validate = ajv.getSchema(s.$id);
    for (const [i, ex] of (s.examples ?? []).entries()) {
      if (!validate(ex)) errors.push(`${file}: example ${i + 1} fails: ${ajv.errorsText(validate.errors)}`);
    }
  } catch (e) {
    errors.push(`${file}: ${e.message}`);
  }
}

// Short keys: each variable's short_name is unique, and inside every object the
// compact keys (short_name, else the full name) never collide.
const shortOwner = {};
for (const [file, s] of Object.entries(schemas)) {
  if (!file.startsWith('variables/') || !s.short_name) continue;
  if (shortOwner[s.short_name]) errors.push(`${file}: short_name "${s.short_name}" already used by ${shortOwner[s.short_name]}`);
  shortOwner[s.short_name] = file;
}
const shortOf = (file, def) => {
  if (def.short_name) return def.short_name;
  const ref = def.$ref ?? def.items?.$ref;
  if (!ref || def.items) return undefined;
  const target = join(file, '..', ref).replace(/^definitions\//, '');
  return schemas[target]?.short_name;
};
for (const [file, s] of Object.entries(schemas)) {
  const seen = {};
  for (const [prop, def] of Object.entries(s.properties ?? {})) {
    const key = shortOf(file, def) ?? prop;
    if (seen[key]) errors.push(`${file}: compact key "${key}" used by both "${seen[key]}" and "${prop}"`);
    seen[key] = prop;
  }
}

if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(1);
}
console.log(`OK: ${files.length} definitions checked.`);
