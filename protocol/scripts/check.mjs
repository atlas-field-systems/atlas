// Checks every definition: valid JSON Schema, listed in index.json, examples pass,
// messages, kinds and components only reference variables or components, and the laws below.
import { readFileSync, readdirSync } from 'node:fs';
import { join, posix } from 'node:path';
import Ajv from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

const root = 'definitions';
const ajv = new Ajv({ strict: true, strictRequired: false, allErrors: true });
addFormats(ajv);

const errors = [];
// A message, kind or component may only point at definitions: a $ref, a $ref fixed to one
// value (const), or a list of a $ref. It never defines a field itself.
const onlyReferences = (d) => {
  const keys = Object.keys(d).sort().join();
  if (keys === '$ref' || keys === '$ref,const') return true;
  const list = Object.keys(d).filter((k) => !['minItems', 'maxItems'].includes(k)).sort().join();
  return d.type === 'array' && list === 'items,type' && Object.keys(d.items).join() === '$ref';
};
const files = ['variables', 'components', 'messages'].flatMap((k) =>
  readdirSync(join(root, k), { recursive: true }).filter((f) => f.endsWith('.json')).map((f) => `${k}/${f}`)).sort();
const schemas = Object.fromEntries(files.map((f) => [f, JSON.parse(readFileSync(join(root, f), 'utf8'))]));

const resolve = (file, ref) => posix.normalize(posix.join(posix.dirname(file), ref));

// Law 10: the version is written once, in variables/protocol_version.json. Every copy must match it.
const pv = schemas['variables/protocol_version.json'];
const version = pv.examples?.[0];
if (pv.examples?.length !== 1 || !/^\d+\.\d+$/.test(version) || pv.const !== undefined || pv.enum) errors.push('variables/protocol_version.json: law 10: exactly one example, the version as major.minor, and no const or enum');
const wrongCopy = (m) => m?.protocol_version !== undefined && m.protocol_version !== version;
for (const [file, s] of Object.entries(schemas)) {
  if (s.examples?.some(wrongCopy)) errors.push(`${file}: law 10: an example's protocol_version is not ${version}; run npm run bump -- ${version}`);
  const pvRef = s.properties?.protocol_version;
  if (pvRef && (Object.keys(pvRef).join() !== '$ref' || resolve(file, pvRef.$ref) !== 'variables/protocol_version.json')) errors.push(`${file}: law 10: "protocol_version" is only a $ref to variables/protocol_version.json`);
}
for (const f of readdirSync('examples', { recursive: true }).filter((f) => f.endsWith('.json'))) {
  if (wrongCopy(JSON.parse(readFileSync(join('examples', f), 'utf8')))) errors.push(`examples/${f}: law 10: protocol_version is not ${version}; run npm run bump -- ${version}`);
}
for (const s of Object.values(schemas)) ajv.addSchema(s);

const index = JSON.parse(readFileSync(join(root, 'index.json'), 'utf8'));
const listed = index.groups.flatMap((g) => g.files);
for (const f of files) if (!listed.includes(f)) errors.push(`${f}: not listed in index.json`);
for (const f of listed) if (!schemas[f]) errors.push(`index.json: ${f} does not exist`);

// messages/<group>/<type>.json is a message type; messages/<group>/<type>/<kind>.json is a kind.
const isType = (f) => /^messages\/[a-z_]+\/[a-z_]+\.json$/.test(f);
const isKind = (f) => /^messages\/[a-z_]+\/[a-z_]+\/[a-z_]+\.json$/.test(f);
const base = (f) => f.split('/').pop().replace('.json', '');

for (const [file, s] of Object.entries(schemas)) {
  if (file.startsWith('messages/') && !isType(file) && !isKind(file)) errors.push(`${file}: law 7: messages live at messages/<group>/<type>.json, kinds at messages/<group>/<type>/<kind>.json`);
  if (!s.description) errors.push(`${file}: needs a description`);
  if ((file.startsWith('variables/') || isKind(file)) && s.title !== base(file)) errors.push(`${file}: title must be "${base(file)}"`);
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
const header = ['type', 'time', 'seq', 'from'];
const usedKinds = new Set();
for (const [file, s] of Object.entries(schemas)) {
  const props = s.properties ?? {};
  for (const [prop, def] of Object.entries(props)) {
    if (/^(header|sender|payload|data|body)$/.test(prop)) errors.push(`${file}: law 2: no "${prop}" wrapper field (use from for the creator id)`);
    if (def.$ref && resolve(file, def.$ref).startsWith('messages/')) errors.push(`${file}: law 2: fields never point at messages`);
  }
  if (isType(file)) {
    const [, group, type] = file.replace('.json', '').split('/');
    for (const h of header) {
      if (!s.required?.includes(h) || !props[h]?.$ref || resolve(file, props[h].$ref) !== `variables/${h}.json`) errors.push(`${file}: law 3: must require "${h}" from variables/${h}.json`);
    }
    // Law 3: asset_id comes from its variable when present; required only when the message concerns a single Asset.
    if (props.asset_id && (!props.asset_id.$ref || resolve(file, props.asset_id.$ref) !== 'variables/asset_id.json')) errors.push(`${file}: law 3: asset_id must come from variables/asset_id.json`);
    if (props.type?.const !== `${group}.${type}`) errors.push(`${file}: law 7: type must be fixed to "${group}.${type}" (its folder and file name)`);
    if (s.oneOf) {
      if (s.unevaluatedProperties !== false || s.additionalProperties !== undefined) errors.push(`${file}: law 2: a type with kinds sets unevaluatedProperties to false (and no additionalProperties)`);
      if (!s.required.includes('kind') || resolve(file, props.kind?.$ref ?? '') !== 'variables/kind.json' || props.kind.const !== undefined) errors.push(`${file}: law 7: a type with kinds requires "kind" from variables/kind.json, left open`);
      const kinds = [];
      for (const b of s.oneOf) {
        const target = b.$ref && resolve(file, b.$ref);
        if (Object.keys(b).join() !== '$ref' || !isKind(target) || !target.startsWith(`messages/${group}/`)) { errors.push(`${file}: law 7: each oneOf branch is only a $ref to a kind in messages/${group}/<type>/`); continue; }
        usedKinds.add(target);
        kinds.push(base(target));
      }
      if (new Set(kinds).size !== kinds.length) errors.push(`${file}: law 7: kinds must be unique`);
      for (const k of kinds) if (!s.examples?.some((e) => e.kind === k)) errors.push(`${file}: needs an example of kind "${k}"`);
    } else {
      if (s.additionalProperties !== false) errors.push(`${file}: law 2: must set additionalProperties to false`);
      if (props.kind) errors.push(`${file}: law 7: "kind" only appears on types that have kinds (oneOf)`);
    }
  }
  if (isKind(file)) {
    if (props.kind?.const !== base(file) || resolve(file, props.kind.$ref) !== 'variables/kind.json' || !s.required?.includes('kind')) errors.push(`${file}: law 7: must require "kind" from variables/kind.json fixed to "${base(file)}"`);
    for (const h of header) if (props[h]) errors.push(`${file}: law 3: the header belongs to the type, not the kind`);
    if (s.additionalProperties !== undefined || s.unevaluatedProperties !== undefined) errors.push(`${file}: a kind leaves extra-field checks to its type`);
  }
  if (/^variables\/.*_id\.json$/.test(file) && s.pattern !== '^[A-Za-z0-9]{1,4}$') {
    errors.push(`${file}: IDs are 1 to 4 letters or digits (pattern ^[A-Za-z0-9]{1,4}$)`);
  }
  if (file.startsWith('variables/') && s.type === 'string' && !s.enum && s.maxLength === undefined) {
    errors.push(`${file}: law 13: text needs a maxLength`);
  }
  for (const [prop, def] of Object.entries(props)) {
    if (def.type === 'array' && def.maxItems === undefined) errors.push(`${file}: law 13: list "${prop}" needs a maxItems`);
  }
}
for (const f of files) if (isKind(f) && !usedKinds.has(f)) errors.push(`${f}: law 7: no type uses this kind`);

if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(1);
}
console.log(`OK: ${files.length} definitions checked.`);
