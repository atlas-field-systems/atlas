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
// A message or component may only point at definitions: a $ref, a $ref fixed to one
// value (const), or a list of a $ref. It never defines a field itself.
const onlyReferences = (d) => {
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

// Laws (docs/laws.md) that can be checked mechanically.
const header = ['type', 'time', 'seq', 'asset_id'];
for (const [file, s] of Object.entries(schemas)) {
  const name = file.split('/')[1].replace('.json', '');
  if (file.startsWith('messages/')) {
    for (const h of header) {
      if (!s.required?.includes(h) || s.properties?.[h]?.$ref !== `../variables/${h}.json`) errors.push(`${file}: law 3: must require "${h}" from variables/${h}.json`);
    }
    if (s.properties?.type?.const !== name) errors.push(`${file}: law 7: type must be fixed to "${name}"`);
    if (s.additionalProperties !== false) errors.push(`${file}: law 2: must set additionalProperties to false`);
    for (const [prop, def] of Object.entries(s.properties ?? {})) {
      if (/^(header|sender|payload|data|body)$/.test(prop)) errors.push(`${file}: law 2: no "${prop}" wrapper or sender field`);
      if (def.$ref?.startsWith('../messages/')) errors.push(`${file}: law 2: messages never nest messages`);
    }
  }
  if (/^variables\/.*_id\.json$/.test(file) && s.pattern !== '^[A-Za-z0-9]{1,4}$') {
    errors.push(`${file}: IDs are 1 to 4 letters or digits (pattern ^[A-Za-z0-9]{1,4}$)`);
  }
  if (file.startsWith('variables/') && s.type === 'string' && !s.enum && s.maxLength === undefined) {
    errors.push(`${file}: law 13: text needs a maxLength`);
  }
  for (const [prop, def] of Object.entries(s.properties ?? {})) {
    if (def.type === 'array' && def.maxItems === undefined) errors.push(`${file}: law 13: list "${prop}" needs a maxItems`);
  }
}

if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(1);
}
console.log(`OK: ${files.length} definitions checked.`);
