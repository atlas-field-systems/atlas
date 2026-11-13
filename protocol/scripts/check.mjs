// Checks every definition: valid JSON Schema, listed in index.json, examples pass,
// records, kinds and components only reference variables, components or records, and the laws below.
import { posix } from 'node:path';
import { readDefinitionFiles } from '../lib/node-definitions.mjs';
import { isKindFile, loadDefinitions, protocolNames, resolveRef as resolve } from '../lib/definitions.mjs';

const root = process.env.ATLAS_DEFINITIONS ?? 'definitions';
const { index, schemas, checkFile } = await loadDefinitions(await readDefinitionFiles(root));

const errors = [];
// A record, kind or component may only point at definitions: a $ref, a $ref fixed to one
// value (const), or a list of a $ref. It never defines a field itself.
const onlyReferences = (d) => {
  const keys = Object.keys(d).sort().join();
  if (keys === '$ref' || keys === '$ref,const') return true;
  const list = Object.keys(d).filter((k) => !['minItems', 'maxItems'].includes(k)).sort().join();
  return d.type === 'array' && list === 'items,type' && Object.keys(d.items).join() === '$ref';
};
const files = Object.keys(schemas).sort();

const listed = index.groups.flatMap((g) => g.files);
for (const f of files) if (!listed.includes(f)) errors.push(`${f}: not listed in index.json`);
for (const f of listed) if (!schemas[f]) errors.push(`index.json: ${f} does not exist`);

const isKind = (f) => isKindFile(f, (parent) => parent in schemas);
const isRecord = (f) => f.startsWith('records/') && !isKind(f);
const base = (f) => f.split('/').pop().replace('.json', '');
const names = new Map([...protocolNames(files)].map(([name, file]) => [file, name]));
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
    for (const [i, ex] of (s.examples ?? []).entries()) {
      const result = checkFile(file, ex);
      if (!result.ok) errors.push(`${file}: example ${i + 1} fails: ${result.problems.map((p) => `${p.path} ${p.message}`).join(', ')}`);
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
    const name = names.get(file);
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
  // A component with kinds follows the record rules for kinds. A component that takes the Task kinds
  // (failsafe_response) is checked against the command list below instead.
  if (file.startsWith('components/') && s.oneOf) {
    if (s.unevaluatedProperties !== false || s.additionalProperties !== undefined) errors.push(`${file}: law 5: a component with kinds sets unevaluatedProperties to false (and no additionalProperties)`);
    if (!s.required?.includes('kind') || !refTo(file, props.kind, 'variables/kind.json') || props.kind.const !== undefined) errors.push(`${file}: law 5: a component with kinds requires "kind" from variables/kind.json, left open`);
    const targets = s.oneOf.map((b) => b.$ref && resolve(file, b.$ref));
    if (new Set(targets).size !== targets.length) errors.push(`${file}: law 5: kinds must be unique`);
    for (const b of s.oneOf) {
      const target = b.$ref && resolve(file, b.$ref);
      if (Object.keys(b).join() !== '$ref' || !isKind(target)) { errors.push(`${file}: law 5: each oneOf branch is only a $ref to a kind`); continue; }
      if (posix.dirname(target) === file.replace('.json', '')) {
        usedKinds.add(target);
        if (!s.examples?.some((e) => e.kind === base(target))) errors.push(`${file}: needs an example of kind "${base(target)}"`);
      }
    }
  }
  // Requests are bodies, not records: Core stamps the record fields, so a request carries none of them.
  if (file.startsWith('requests/')) {
    for (const f of ['type', 'time', 'asset_id', 'task_id', 'send_last', 'requested_by', 'geofeature_id', 'track_id']) if (props[f] && !(file === 'requests/attach.json' && f === 'geofeature_id')) errors.push(`${file}: law 1: "${f}" is stamped by Core, not sent in a request`);
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
for (const f of files) if (isKind(f) && !usedKinds.has(f)) errors.push(`${f}: law 5: no record or component uses this kind`);

// A variable that lists kinds or records by name lists exactly the files that exist.
const sameNames = (a, b) => a.length === b.length && a.every((n) => b.includes(n));
const mirrors = [
  ['variables/command.json', 'law 12', 'the kinds in records/task/ except settings',
    files.filter((f) => isKind(f) && posix.dirname(f) === 'records/task' && base(f) !== 'settings')],
  ['variables/report.json', 'law 11', 'the records in records/report/',
    files.filter((f) => /^records\/report\/[a-z_]+\.json$/.test(f))],
  ['variables/input_kind.json', 'law 2', 'the kinds in components/input_value/',
    files.filter((f) => isKind(f) && posix.dirname(f) === 'components/input_value')],
];
for (const [file, law, what, named] of mirrors) {
  const names = named.map(base);
  if (schemas[file] && !sameNames(schemas[file].enum ?? [], names)) errors.push(`${file}: ${law}: its values must be ${what}: ${names.join(', ')}`);
}
const settingNames = Object.keys(schemas['components/settings.json']?.properties ?? {});
if (schemas['variables/setting.json'] && !sameNames(schemas['variables/setting.json'].enum ?? [], settingNames)) errors.push(`variables/setting.json: law 12: its values must be the settings in components/settings.json: ${settingNames.join(', ')}`);
// A Task request takes exactly the Task record's kinds.
const kindTargets = (file) => (schemas[file]?.oneOf ?? []).map((b) => b.$ref && resolve(file, b.$ref));
// A failsafe response takes exactly the command kinds, except failsafe itself: the Task kinds except settings and failsafe.
const responseKinds = files.filter((f) => isKind(f) && posix.dirname(f) === 'records/task' && !['settings', 'failsafe'].includes(base(f)));
if (schemas['components/failsafe_response.json'] && !sameNames(kindTargets('components/failsafe_response.json'), responseKinds)) errors.push(`components/failsafe_response.json: law 12: its kinds must be the command kinds except failsafe: ${responseKinds.map(base).join(', ')}`);
// A request with kinds, such as a Task or a geo feature, takes exactly its record's kinds.
for (const name of ['task', 'geofeature']) {
  const request = `requests/${name}.json`, record = `records/${name}.json`;
  if (schemas[request] && !sameNames(kindTargets(request), kindTargets(record))) errors.push(`${request}: ${name === 'task' ? 'law 12' : 'law 1'}: its kinds must be exactly the kinds of ${record}`);
}
// The registration request takes exactly the description record's fields, with the same definitions,
// except time and asset_id, which Core stamps.
const description = schemas['records/description.json'], registration = schemas['requests/asset.json'];
if (description && registration) {
  const own = (s) => Object.fromEntries(Object.entries(s.properties ?? {}).filter(([k]) => !['time', 'asset_id'].includes(k)));
  const req = (s) => (s.required ?? []).filter((k) => !['time', 'asset_id'].includes(k)).sort().join();
  if (JSON.stringify(own(description)) !== JSON.stringify(registration.properties ?? {}) || req(description) !== req(registration)) errors.push('requests/asset.json: law 1: it takes exactly the fields of records/description.json, with the same definitions, except time and asset_id');
  // The command list must be able to hold every command.
  const commands = description.properties?.commands;
  const count = schemas['variables/command.json']?.enum?.length ?? 0;
  if (commands && !(commands.maxItems >= count)) errors.push(`records/description.json: law 9: the command list must hold every command: maxItems at least ${count}`);
}
for (const k of kindTargets('requests/task.json')) for (const f of ['task_id', 'send_last', 'now', 'requested_by']) if (schemas[k]?.properties?.[f]) errors.push(`${k}: law 1: "${f}" is stamped by Core, not sent in a request`);

if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(1);
}
console.log(`OK: ${files.length} definitions checked.`);
