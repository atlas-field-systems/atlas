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

const errors = [];
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
      if (Object.keys(def).join() !== '$ref') errors.push(`${file}: "${prop}" must only be a $ref (define fields once, in variables/)`);
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

if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(1);
}
console.log(`OK: ${files.length} definitions checked.`);
