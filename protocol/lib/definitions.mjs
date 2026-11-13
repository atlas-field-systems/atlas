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

const pointer = (key) => String(key).replaceAll('~', '~0').replaceAll('/', '~1');

export async function loadDefinitions(files) {
  // Snapshot bytes before yielding, so the hash and schemas describe the same files.
  files = new Map([...files].map(([path, bytes]) => [path, new Uint8Array(bytes)]));
  const decoder = new TextDecoder('utf-8', { fatal: true });
  const index = JSON.parse(decoder.decode(files.get('index.json')));
  const schemas = Object.fromEntries([...files]
    .filter(([path]) => path.endsWith('.json') && path !== 'index.json')
    .map(([path, bytes]) => [path, JSON.parse(decoder.decode(bytes))]));
  const ajv = new Ajv({ strict: true, strictRequired: false, allowUnionTypes: true, allErrors: true });
  addFormats(ajv);
  for (const [file, schema] of Object.entries(schemas)) ajv.addSchema(schema, file);
  const checkFile = (file, value) => {
    const validate = ajv.getSchema(file);
    if (!validate) throw new Error(`Unknown definition: ${file}`);
    if (validate(value)) return { ok: true };
    return { ok: false, problems: validate.errors.map((error) => {
      const property = error.params.missingProperty ?? error.params.additionalProperty ?? error.params.unevaluatedProperty;
      const path = error.instancePath + (property === undefined ? '' : `/${pointer(property)}`);
      const message = error.keyword === 'required' ? 'is required'
        : ['additionalProperties', 'unevaluatedProperties'].includes(error.keyword) ? 'is not allowed'
        : error.keyword === 'const' ? `must be ${JSON.stringify(error.params.allowedValue)}`
        : error.keyword === 'enum' ? `must be one of ${error.params.allowedValues.map((value) => JSON.stringify(value)).join(', ')}`
        : error.keyword === 'oneOf' ? 'must match one allowed shape'
        : error.keyword === 'if' ? 'must satisfy the condition'
        : error.keyword === 'not' ? 'is not allowed'
        : error.message;
      return { path, message };
    }) };
  };
  const registry = new Map();
  for (const file of index.groups.flatMap((group) => group.files)) {
    if (!schemas[file]) throw new Error(`index.json: ${file} does not exist`);
    const parent = `${file.slice(0, file.lastIndexOf('/'))}.json`;
    if (file.startsWith('records/') && !schemas[parent]) {
      registry.set(file.slice('records/'.length, -5).replaceAll('/', '.'), file);
    } else if (file.startsWith('requests/')) {
      registry.set(file.slice(0, -5).replaceAll('/', '.'), file);
    }
  }
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
