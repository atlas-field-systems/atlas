// Validates messages against the pinned protocol definitions (protocol/ submodule).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import Ajv from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

const dir = new URL('../protocol/definitions/', import.meta.url).pathname;
const read = (f) => JSON.parse(readFileSync(join(dir, f), 'utf8'));
const ajv = new Ajv({ strict: false, allErrors: true });
addFormats(ajv);
const files = read('index.json').groups.flatMap((g) => g.files);
for (const f of files) ajv.addSchema(read(f));

const base = 'https://atlas-field-systems.github.io/protocol/definitions/';

// Returns null if the message is valid, or a short reason.
export function check(message) {
  const file = `messages/${String(message?.type).replace('.', '/')}.json`;
  if (!files.includes(file)) return `unknown type ${message?.type}`;
  const validate = ajv.getSchema(base + file);
  return validate(message) ? null : ajv.errorsText(validate.errors).slice(0, 500);
}
