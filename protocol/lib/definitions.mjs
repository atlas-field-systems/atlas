import Ajv from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

const encoder = new TextEncoder();

export async function hashDefinitions(files) {
  const entries = [...files].filter(([path]) => path.endsWith('.json'))
    .map(([path, bytes]) => ({ path, bytes, key: encoder.encode(path) }));
  entries.sort((a, b) => {
    for (let i = 0; i < Math.min(a.key.length, b.key.length); i++) {
      if (a.key[i] !== b.key[i]) return a.key[i] - b.key[i];
    }
    return a.key.length - b.key.length;
  });
  const chunks = entries.flatMap(({ path, bytes }) => [encoder.encode(`${path}\n${bytes.length}\n`), bytes]);
  const input = new Uint8Array(chunks.reduce((size, bytes) => size + bytes.length, 0));
  let offset = 0;
  for (const bytes of chunks) { input.set(bytes, offset); offset += bytes.length; }
  const digest = await globalThis.crypto.subtle.digest('SHA-256', input);
  return `sha256:${[...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')}`;
}

// The definition file a $ref in another definition file points at.
export function resolveRef(file, ref) {
  const parts = file.split('/').slice(0, -1);
  for (const part of ref.split('/')) {
    if (part === '..') parts.pop();
    else if (part !== '.') parts.push(part);
  }
  return parts.join('/');
}

const parentOf = (file) => `${file.slice(0, file.lastIndexOf('/'))}.json`;

// Law 5: <dir>/<kind>.json beside <dir>.json is a kind of that record or component.
export const isKindFile = (file, exists) => /^(records|components)\//.test(file) && exists(parentOf(file));

// Law 5 names: records/report/status.json is report.status; requests/tasks.json is requests.tasks.
export function protocolNames(files) {
  const exists = (file) => files.includes(file);
  return new Map(files.flatMap((file) => {
    if (file.startsWith('requests/')) return [[file.slice(0, -5).replaceAll('/', '.'), file]];
    if (file.startsWith('records/') && !isKindFile(file, exists)) return [[file.slice(8, -5).replaceAll('/', '.'), file]];
    return [];
  }));
}

const pointer = (key) => String(key).replaceAll('~', '~0').replaceAll('/', '~1');

const messages = {
  required: () => 'is required',
  additionalProperties: () => 'is not allowed',
  unevaluatedProperties: () => 'is not allowed',
  not: () => 'is not allowed',
  anyOf: () => 'must match one allowed shape',
  oneOf: () => 'must match one allowed shape',
  const: ({ params }) => `must be ${JSON.stringify(params.allowedValue)}`,
  enum: ({ params }) => `must be one of ${params.allowedValues.map((value) => JSON.stringify(value)).join(', ')}`,
};

export async function loadDefinitions(files) {
  // Snapshot bytes before yielding, so the hash and schemas describe the same files.
  files = new Map([...files].map(([path, bytes]) => [path, new Uint8Array(bytes)]));
  if (!files.has('index.json')) throw new Error('The definition files must include index.json');
  const decoder = new TextDecoder('utf-8', { fatal: true });
  const index = JSON.parse(decoder.decode(files.get('index.json')));
  const schemas = Object.fromEntries([...files]
    .filter(([path]) => path.endsWith('.json') && path !== 'index.json')
    .map(([path, bytes]) => [path, JSON.parse(decoder.decode(bytes))]));
  const newAjv = (options) => {
    const ajv = new Ajv({ strict: true, strictRequired: false, allowUnionTypes: true, allErrors: true, ...options });
    addFormats(ajv);
    return ajv;
  };
  // The verdict comes from plain JSON Schema. Its problems for a record with kinds list
  // every kind's failures, so a second validator explains a failure using only the kind the
  // value names. Law 5 makes every oneOf a choice of kinds by "kind".
  const verdict = newAjv();
  const explainer = newAjv({ discriminator: true, verbose: true });
  // Ajv's discriminator does not pass on which fields the chosen kind evaluated, so the
  // explainer would call them unevaluated. Keep, per schema, the fields each kind may carry.
  const kindFields = new Map();
  for (const [file, schema] of Object.entries(schemas)) {
    verdict.addSchema(schema, file);
    // A oneOf that breaks law 5 gets the plain explanation; the definition check reports it.
    const kinds = schema.oneOf?.map(({ $ref }) => $ref && schemas[resolveRef(file, $ref)]);
    if (!kinds?.every((kind) => kind?.properties?.kind?.const)) { explainer.addSchema(schema, file); continue; }
    const withKinds = { ...schema, discriminator: { propertyName: 'kind' } };
    kindFields.set(withKinds, new Map(kinds.map((kind) =>
      [kind.properties.kind.const, new Set([...Object.keys(schema.properties ?? {}), ...Object.keys(kind.properties)])])));
    explainer.addSchema(withKinds, file);
  }
  const problemOf = (error) => {
    const kinds = kindFields.get(error.parentSchema);
    if (error.keyword === 'if') return [];
    if (error.keyword === 'discriminator') {
      return error.data.kind === undefined ? [] : [{
        path: `${error.instancePath}/kind`,
        message: `must be one of ${[...kinds.keys()].map((kind) => JSON.stringify(kind)).join(', ')}`,
      }];
    }
    if (error.keyword === 'unevaluatedProperties' && kinds?.get(error.data.kind)?.has(error.params.unevaluatedProperty)) return [];
    const property = error.params.missingProperty ?? error.params.additionalProperty ?? error.params.unevaluatedProperty;
    const path = error.instancePath + (property === undefined ? '' : `/${pointer(property)}`);
    return [{ path, message: messages[error.keyword]?.(error) ?? error.message }];
  };
  const checkFile = (file, value) => {
    const validate = verdict.getSchema(file);
    if (!validate) throw new Error(`Unknown definition: ${file}`);
    if (validate(value)) return { ok: true };
    const explain = explainer.getSchema(file);
    explain(value);
    const problems = (explain.errors ?? []).flatMap(problemOf);
    return { ok: false, problems: problems.length ? problems : validate.errors.flatMap(problemOf) };
  };
  const listed = index.groups.flatMap((group) => group.files);
  for (const file of listed) if (!schemas[file]) throw new Error(`index.json: ${file} does not exist`);
  const registry = protocolNames(listed);
  const protocol = Object.freeze({
    hash: await hashDefinitions(files),
    names: Object.freeze([...registry.keys()]),
    check(name, value) {
      if (!registry.has(name)) throw new Error(`Unknown Protocol name: ${name}`);
      return checkFile(registry.get(name), value);
    },
  });
  return { index, schemas, checkFile, protocol };
}
