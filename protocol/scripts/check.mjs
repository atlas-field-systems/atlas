// Checks every definition: valid JSON Schema, listed in index.json, examples pass,
// records, kinds and components only reference variables, components or records, and the laws below.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, posix } from 'node:path';
import Ajv from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

const root = process.env.ATLAS_DEFINITIONS ?? 'definitions';
const ajv = new Ajv({ strict: true, strictRequired: false, allowUnionTypes: true, allErrors: true });
addFormats(ajv);

const errors = [];
// A record, kind or component may only point at definitions: a $ref, a $ref fixed to one
// value (const), or a list of a $ref. It never defines a field itself.
const onlyReferences = (d) => {
  const keys = Object.keys(d).sort().join();
  if (keys === '$ref' || keys === '$ref,const') return true;
  const list = Object.keys(d).filter((k) => !['minItems', 'maxItems'].includes(k)).sort().join();
  return d.type === 'array' && list === 'items,type' && Object.keys(d.items).join() === '$ref';
};
const files = ['variables', 'components', 'records', 'requests'].flatMap((k) =>
  readdirSync(join(root, k), { recursive: true }).filter((f) => f.endsWith('.json')).map((f) => `${k}/${f}`)).sort();
const schemas = Object.fromEntries(files.map((f) => [f, JSON.parse(readFileSync(join(root, f), 'utf8'))]));

const resolve = (file, ref) => posix.normalize(posix.join(posix.dirname(file), ref));

for (const s of Object.values(schemas)) ajv.addSchema(s);

const index = JSON.parse(readFileSync(join(root, 'index.json'), 'utf8'));
const listed = index.groups.flatMap((g) => g.files);
for (const f of files) if (!listed.includes(f)) errors.push(`${f}: not listed in index.json`);
for (const f of listed) if (!schemas[f]) errors.push(`index.json: ${f} does not exist`);

// records/<name>.json and records/<group>/<name>.json are records; records/<...>/<record>/<kind>.json,
// beside records/<...>/<record>.json, is a kind of that record.
const isKind = (f) => f.startsWith('records/') && existsSync(join(root, `${posix.dirname(f)}.json`));
const isRecord = (f) => f.startsWith('records/') && !isKind(f);
const base = (f) => f.split('/').pop().replace('.json', '');
const nameOf = (f) => f.replace(/^records\//, '').replace('.json', '').replaceAll('/', '.');
const refTo = (file, def, target) => def?.$ref && resolve(file, def.$ref) === target;

for (const [file, s] of Object.entries(schemas)) {
  if (isRecord(file) && !/^records\/([a-z_]+\/)?[a-z_]+\.json$/.test(file)) errors.push(`${file}: law 5: records live at records/<name>.json or records/<group>/<name>.json`);
  if (!s.description) errors.push(`${file}: needs a description`);
  if ((file.startsWith('variables/') || isKind(file)) && s.title !== base(file)) errors.push(`${file}: title must be "${base(file)}"`);
  if (!s.examples?.length) errors.push(`${file}: needs at least one example`);
  if (!file.startsWith('variables/')) {
    for (const [prop, def] of Object.entries(s.properties ?? {})) {
      if (!onlyReferences(def)) errors.push(`${file}: law 2: "${prop}" must be a $ref, a $ref with a fixed const, or a list of a $ref (define fields once, in variables/)`);
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
const usedKinds = new Set();
for (const [file, s] of Object.entries(schemas)) {
  const props = s.properties ?? {};
  for (const prop of Object.keys(props)) {
    if (/^(header|sender|payload|data|body)$/.test(prop)) errors.push(`${file}: law 6: no "${prop}" wrapper field; fields sit directly in the record`);
    if (/^(seq|from)$/.test(prop)) errors.push(`${file}: law 6: records carry no "${prop}"`);
    if (/(^|_)version$/.test(prop)) errors.push(`${file}: law 14: definitions carry no version field ("${prop}")`);
  }
  if (isRecord(file)) {
    const name = nameOf(file);
    if (!s.required?.includes('time') || !refTo(file, props.time, 'variables/time.json')) errors.push(`${file}: law 6: must require "time" from variables/time.json`);
    if (props.asset_id && !refTo(file, props.asset_id, 'variables/asset_id.json')) errors.push(`${file}: law 6: asset_id must come from variables/asset_id.json`);
    if (name.includes('.')) {
      if (!s.required?.includes('type') || !refTo(file, props.type, 'variables/type.json') || props.type.const !== name) errors.push(`${file}: law 5: a grouped record requires "type" from variables/type.json fixed to "${name}"`);
    } else if (props.type) errors.push(`${file}: law 5: only grouped records carry "type"`);
    if (s.oneOf) {
      if (s.unevaluatedProperties !== false || s.additionalProperties !== undefined) errors.push(`${file}: law 6: a record with kinds sets unevaluatedProperties to false (and no additionalProperties)`);
      if (!s.required.includes('kind') || !refTo(file, props.kind, 'variables/kind.json') || props.kind.const !== undefined) errors.push(`${file}: law 5: a record with kinds requires "kind" from variables/kind.json, left open`);
      const kinds = [];
      for (const b of s.oneOf) {
        const target = b.$ref && resolve(file, b.$ref);
        if (Object.keys(b).join() !== '$ref' || !isKind(target) || posix.dirname(target) !== file.replace('.json', '')) { errors.push(`${file}: law 5: each oneOf branch is only a $ref to a kind in ${file.replace('.json', '')}/`); continue; }
        usedKinds.add(target);
        kinds.push(base(target));
      }
      if (new Set(kinds).size !== kinds.length) errors.push(`${file}: law 5: kinds must be unique`);
      for (const k of kinds) if (!s.examples?.some((e) => e.kind === k)) errors.push(`${file}: needs an example of kind "${k}"`);
    } else {
      if (s.additionalProperties !== false) errors.push(`${file}: law 6: must set additionalProperties to false`);
      if (props.kind) errors.push(`${file}: law 5: "kind" only appears on records that have kinds (oneOf)`);
    }
  }
  // Requests are bodies, not records: Core stamps the record fields, so a request carries none of them.
  if (file.startsWith('requests/')) {
    for (const f of ['type', 'time', 'asset_id', 'task_id', 'clear_count', 'send_last', 'requested_by']) if (props[f]) errors.push(`${file}: law 1: "${f}" is stamped by Core, not sent in a request`);
    if (s.additionalProperties !== false && s.unevaluatedProperties !== false) errors.push(`${file}: law 1: a request sets additionalProperties or unevaluatedProperties to false`);
  }
  if (isKind(file)) {
    if (props.kind?.const !== base(file) || !refTo(file, props.kind, 'variables/kind.json') || !s.required?.includes('kind')) errors.push(`${file}: law 5: must require "kind" from variables/kind.json fixed to "${base(file)}"`);
    for (const h of ['type', 'time', 'asset_id']) if (props[h]) errors.push(`${file}: law 5: "${h}" belongs to the record, not the kind`);
    if (s.additionalProperties !== undefined || s.unevaluatedProperties !== undefined) errors.push(`${file}: a kind leaves extra-field checks to its record`);
  }
  if (/^variables\/.*_id\.json$/.test(file) && s.type !== 'integer' && s.pattern !== '^[A-Za-z0-9]{1,4}$') {
    errors.push(`${file}: law 10: IDs are 1 to 4 letters or digits (pattern ^[A-Za-z0-9]{1,4}$), or integers for event IDs`);
  }
  if (file.startsWith('variables/') && [s.type].flat().includes('string') && !s.enum && s.maxLength === undefined) {
    errors.push(`${file}: law 9: text needs a maxLength`);
  }
  for (const [prop, def] of Object.entries(props)) {
    if (def.type === 'array' && def.maxItems === undefined) errors.push(`${file}: law 9: list "${prop}" needs a maxItems`);
  }
}
for (const f of files) if (isKind(f) && !usedKinds.has(f)) errors.push(`${f}: law 5: no record uses this kind`);

// A variable that lists kinds or records by name lists exactly the files that exist.
const sameNames = (a, b) => a.length === b.length && a.every((n) => b.includes(n));
const mirrors = [
  ['variables/command.json', 'law 12', 'the kinds in records/task/ except settings',
    files.filter((f) => isKind(f) && posix.dirname(f) === 'records/task' && base(f) !== 'settings')],
  ['variables/report.json', 'law 11', 'the records in records/report/',
    files.filter((f) => /^records\/report\/[a-z_]+\.json$/.test(f))],
];
for (const [file, law, what, named] of mirrors) {
  const names = named.map(base);
  if (schemas[file] && !sameNames(schemas[file].enum ?? [], names)) errors.push(`${file}: ${law}: its values must be ${what}: ${names.join(', ')}`);
}
const settingNames = Object.keys(schemas['components/settings.json']?.properties ?? {});
if (schemas['variables/setting.json'] && !sameNames(schemas['variables/setting.json'].enum ?? [], settingNames)) errors.push(`variables/setting.json: law 12: its values must be the settings in components/settings.json: ${settingNames.join(', ')}`);
// A Task request takes exactly the Task record's kinds.
const kindTargets = (file) => (schemas[file]?.oneOf ?? []).map((b) => b.$ref && resolve(file, b.$ref));
if (schemas['requests/task.json'] && !sameNames(kindTargets('requests/task.json'), kindTargets('records/task.json'))) errors.push('requests/task.json: law 12: its kinds must be exactly the kinds of records/task.json');
for (const k of kindTargets('requests/task.json')) for (const f of ['task_id', 'clear_count', 'send_last', 'now', 'requested_by']) if (schemas[k]?.properties?.[f]) errors.push(`${k}: law 1: "${f}" is stamped by Core, not sent in a request`);

if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(1);
}
console.log(`OK: ${files.length} definitions checked.`);
