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
  uniqueBy: ({ schema }) => `must have distinct ${schema} values`,
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
    ajv.addKeyword({
      keyword: 'uniqueBy', schemaType: 'string', type: 'array',
      validate(field, entries) {
        const keys = entries.map((entry) => entry?.[field]).filter((key) => key !== undefined);
        return new Set(keys).size === keys.length;
      },
    });
    addFormats(ajv);
    return ajv;
  };
  // The verdict uses every constraint in the definitions. Its problems for a record with kinds list
  // every kind's failures, so a second validator explains a failure using only the kind the
  // value names. Mixed batches choose records by "type".
  const verdict = newAjv();
  const explainer = newAjv({ discriminator: true, verbose: true });
  // Ajv's discriminator does not pass on which fields the chosen kind evaluated, so the
  // explainer would call them unevaluated. Keep, per schema, the fields each kind may carry.
  const variantFields = new Map();
  for (const [file, schema] of Object.entries(schemas)) {
    verdict.addSchema(schema, file);
    const branches = schema.oneOf?.map(({ $ref }) => $ref && schemas[resolveRef(file, $ref)]);
    const tag = ['kind', 'type'].find((key) =>
      branches?.length && branches.every((branch) => typeof branch?.properties?.[key]?.const === 'string'));
    if (!tag) { explainer.addSchema(schema, file); continue; }
    const tagged = { ...schema, type: 'object', required: [...new Set([...(schema.required ?? []), tag])],
      discriminator: { propertyName: tag } };
    variantFields.set(tagged, new Map(branches.map((branch) =>
      [branch.properties[tag].const, new Set([...Object.keys(schema.properties ?? {}), ...Object.keys(branch.properties)])])));
    explainer.addSchema(tagged, file);
  }
  const problemOf = (error) => {
    const kinds = variantFields.get(error.parentSchema);
    if (error.keyword === 'if') return [];
    if (error.keyword === 'discriminator') {
      const tag = error.params.tag;
      return error.data[tag] === undefined ? [] : [{
        path: `${error.instancePath}/${tag}`,
        message: `must be one of ${[...kinds.keys()].map((kind) => JSON.stringify(kind)).join(', ')}`,
        unknownKind: true,
      }];
    }
    if (error.keyword === 'unevaluatedProperties' && kinds) {
      // With an unknown kind, a field any kind allows is not the problem; the kind is.
      const tag = error.data[error.parentSchema.discriminator.propertyName];
      const allowed = kinds.has(tag) ? [kinds.get(tag)] : [...kinds.values()];
      if (allowed.some((fields) => fields.has(error.params.unevaluatedProperty))) return [];
    }
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
    const explained = (explain.errors ?? []).flatMap(problemOf);
    // An unknown kind is one problem: the list of kinds replaces the kind's other problems.
    const unknownKinds = new Set(explained.filter((p) => p.unknownKind).map((p) => p.path));
    const problems = explained.filter((p) => p.unknownKind || !unknownKinds.has(p.path)).map(({ path, message }) => ({ path, message }));
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
