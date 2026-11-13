import { readFile, writeFile } from 'node:fs/promises';
import { compile } from 'json-schema-to-typescript';

const definitions = new URL('../definitions/', import.meta.url);
const output = new URL('../types.d.ts', import.meta.url);
const index = JSON.parse(await readFile(new URL('index.json', definitions), 'utf8'));
const files = index.groups.flatMap(group => group.files).sort();
const keys = new Map(files.map(file => [file, file.replace(/\.json$/, '').replaceAll('/', '_')]));

function schemaForTypes(value, file) {
  if (Array.isArray(value)) return value.map(item => schemaForTypes(item, file));
  if (!value || typeof value !== 'object') return value;
  const schema = Object.fromEntries(Object.entries(value)
    .filter(([key]) => !['$id', '$schema', 'title', 'description', 'examples', 'if', 'then', 'else', 'not'].includes(key))
    .map(([key, child]) => [key, schemaForTypes(child, file)]));
  if (schema.$ref) {
    const target = new URL(schema.$ref, new URL(file, definitions));
    const relative = target.href.slice(definitions.href.length);
    if (!target.href.startsWith(definitions.href) || !keys.has(relative)) {
      throw new Error(`Unsupported type reference ${schema.$ref} in ${file}`);
    }
    schema.$ref = `#/$defs/${keys.get(relative)}`;
  }
  // Kind schemas are open so JSON Schema can compose them with their record.
  // TypeScript intersections compose closed object shapes without index signatures.
  if (schema.type === 'object' || schema.required) schema.additionalProperties = false;
  return schema;
}

const schemas = Object.fromEntries(await Promise.all(files.map(async file => [
  keys.get(file), schemaForTypes(JSON.parse(await readFile(new URL(file, definitions), 'utf8')), file),
])));
const properties = Object.fromEntries(index.groups
  .filter(group => ['Records', 'Requests'].includes(group.name))
  .flatMap(group => group.files.map(file => [
    file.replace(/^records\//, '').replace(/\.json$/, '').replaceAll('/', '.'),
    { $ref: `#/$defs/${keys.get(file)}` },
  ])).sort(([a], [b]) => a.localeCompare(b, 'en')));
const declaration = await compile({
  type: 'object', properties, required: Object.keys(properties), additionalProperties: false, $defs: schemas,
}, 'ProtocolTypes', {
  bannerComment: '/* Generated from definitions/. Run npm run types to update. */',
  additionalProperties: false,
  ignoreMinAndMaxItems: true,
  unknownAny: true,
});
if (process.argv.includes('--check')) {
  if (await readFile(output, 'utf8') !== declaration) {
    console.error('types.d.ts is stale. Run npm run types and commit the result.');
    process.exitCode = 1;
  }
} else {
  await writeFile(output, declaration);
}
