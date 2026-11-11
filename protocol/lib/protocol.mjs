// Shared viewer logic. Runs in Node and the browser.
// Knows only JSON Schema, never any specific Atlas record.

export async function loadProtocol(readJson, Ajv, addFormats) {
  const index = await readJson('index.json');
  const files = index.groups.flatMap((g) => g.files);
  const schemas = {};
  for (const f of files) schemas[f] = await readJson(f);
  const ajv = new Ajv({ strict: false, allErrors: true });
  if (addFormats) addFormats(ajv);
  for (const s of Object.values(schemas)) ajv.addSchema(s);
  return { index, schemas, ajv };
}

function join(base, ref) {
  const parts = base.split('/').slice(0, -1);
  for (const p of ref.split('/')) {
    if (p === '..') parts.pop();
    else if (p !== '.') parts.push(p);
  }
  return parts.join('/');
}

// A record with kinds lists them in oneOf: records/<record>/<kind>.json.
export function kindsOf(protocol, file) {
  return (protocol.schemas[file].oneOf ?? []).filter((b) => b.$ref).map((b) => {
    const kindFile = join(file, b.$ref);
    return { name: kindFile.split('/').pop().replace('.json', ''), file: kindFile };
  });
}

// The records as a tree: group > record > kinds, from the folders under records/.
// A record is records/<name>.json or records/<group>/<name>.json; its group is '' or <group>.
export function recordTree(protocol) {
  const files = protocol.index.groups.flatMap((g) => g.files);
  const kindFiles = new Set(files.flatMap((f) => kindsOf(protocol, f).map((k) => k.file)));
  const groups = [];
  for (const f of files) {
    const m = f.match(/^records\/(?:([a-z_]+)\/)?([a-z_]+)\.json$/);
    if (!m || kindFiles.has(f)) continue;
    const group = m[1] ?? '';
    let g = groups.find((x) => x.name === group);
    if (!g) groups.push(g = { name: group, records: [] });
    g.records.push({ file: f, name: group ? `${group}.${m[2]}` : m[2], kinds: kindsOf(protocol, f) });
  }
  return groups;
}

// "records/<record>.json@<kind>" names one kind of a record; the part before @ is the file.
export const splitId = (id) => { const [file, kind] = id.split('@'); return { file, kind }; };

// Turns a schema file (or file@kind) into a tree of fields with every $ref resolved.
export function fieldTree(protocol, id, name = '', required = true) {
  const { file, kind } = splitId(id);
  const s = protocol.schemas[file];
  const n = node(protocol, s, file, name, required);
  const k = kind && kindsOf(protocol, file).find((x) => x.name === kind);
  if (!k) return n;
  const extra = node(protocol, protocol.schemas[k.file], k.file, '', true).children;
  n.children = [...n.children.map((c) => (c.name === 'kind' ? extra.find((e) => e.name === 'kind') : c)), ...extra.filter((e) => e.name !== 'kind')];
  return n;
}

function node(protocol, s, file, name, required) {
  if (s.$ref) {
    const target = join(file, s.$ref);
    const n = { ...fieldTree(protocol, target, name, required), source: target };
    // The definition that points at another one may describe it, give its own examples,
    // rule out one value (not: { const }), or keep only some values (enum).
    if (s.description) n.description = s.description;
    if (s.examples) n.schema = { ...n.schema, examples: s.examples };
    if (s.not?.const !== undefined && n.options) n.options = n.options.filter((o) => o !== s.not.const);
    if (Array.isArray(s.enum) && n.options) n.options = n.options.filter((o) => s.enum.includes(o));
    if (s.const !== undefined) Object.assign(n, { kind: 'enum', options: [s.const], schema: { ...n.schema, examples: [s.const] } });
    return n;
  }
  const n = { name, required, description: s.description, source: file, schema: s };
  if (s.type === 'object') {
    const req = s.required ?? [];
    n.kind = 'object';
    n.children = Object.entries(s.properties ?? {}).map(([k, v]) =>
      node(protocol, v, file, k, req.includes(k)));
  } else if (s.type === 'array') {
    n.kind = 'array';
    n.item = node(protocol, s.items, file, '[]', true);
  } else {
    n.kind = s.enum ? 'enum' : s.type;
    n.options = s.enum;
  }
  return n;
}

export function describeType(n) {
  const s = n.schema;
  if (n.kind === 'enum') return n.options.map(String).join(' | ');
  if (n.kind === 'object' || n.kind === 'array') return n.kind;
  const bits = [s.format ?? [n.kind].flat().join(' | ')];
  if (s.minimum !== undefined) bits.push(`>= ${s.minimum}`);
  if (s.exclusiveMaximum !== undefined) bits.push(`< ${s.exclusiveMaximum}`);
  if (s.maximum !== undefined) bits.push(`<= ${s.maximum}`);
  return bits.join(' ');
}

// Flattens a tree into leaf rows with JSON paths such as ["a", 0, "b"].
export function leaves(tree, value, path = []) {
  if (tree.kind === 'object') {
    return tree.children.flatMap((c) => leaves(c, value?.[c.name], [...path, c.name]));
  }
  if (tree.kind === 'array') {
    const items = Array.isArray(value) && value.length ? value : [undefined];
    return items.flatMap((v, i) => leaves(tree.item, v, [...path, i]));
  }
  return [{ path, node: tree, value }];
}

export function example(protocol, id) {
  const { file, kind } = splitId(id);
  const s = protocol.schemas[file];
  const ex = kind ? s.examples?.find((e) => e.kind === kind) : s.examples?.[0];
  return structuredClone(ex ?? generate(fieldTree(protocol, id)));
}

export function generate(n) {
  if (n.schema.examples?.length) return structuredClone(n.schema.examples[0]);
  if (n.kind === 'object') {
    return Object.fromEntries(n.children.filter((c) => c.required).map((c) => [c.name, generate(c)]));
  }
  if (n.kind === 'array') return [generate(n.item)];
  if (n.kind === 'enum') return n.options[0];
  if (n.kind === 'number' || n.kind === 'integer') return n.schema.minimum ?? 0;
  if (n.kind === 'boolean') return false;
  if (n.schema.format === 'uuid') return crypto.randomUUID();
  return 'text';
}

export function setPath(value, path, v) {
  const copy = structuredClone(value);
  let cur = copy;
  path.slice(0, -1).forEach((p, i) => {
    if (cur[p] === undefined) cur[p] = typeof path[i + 1] === 'number' ? [] : {};
    cur = cur[p];
  });
  const last = path[path.length - 1];
  if (v === undefined) delete cur[last];
  else cur[last] = v;
  return copy;
}

// Text from a person into the field's type.
export function parseInput(n, text) {
  if (text === '') return undefined;
  if (n.kind === 'number') return Number(text);
  if (n.kind === 'integer') return parseInt(text, 10);
  if (n.kind === 'boolean') return text === 'true';
  return text;
}

export function validate(protocol, id, value) {
  const v = protocol.ajv.getSchema(protocol.schemas[splitId(id).file].$id);
  const ok = v(value);
  return { ok, errors: ok ? [] : v.errors.map((e) => `${e.instancePath || '(record)'} ${e.message}`) };
}

// Sizes in bytes. compress is a function bytes -> bytes (deflate today; swappable later).
export function measure(value, compress) {
  const enc = new TextEncoder();
  const readable = JSON.stringify(value, null, 2);
  const json = JSON.stringify(value);
  const bytes = enc.encode(json);
  const fields = [];
  const walk = (v, path) => {
    if (v && typeof v === 'object') {
      for (const [k, c] of Object.entries(v)) walk(c, [...path, k]);
    } else {
      const key = path[path.length - 1];
      const piece = typeof key === 'number' ? JSON.stringify(v) : `"${key}":${JSON.stringify(v)}`;
      fields.push({ path: path.join('.'), bytes: enc.encode(piece).length });
    }
  };
  walk(value, []);
  fields.sort((a, b) => b.bytes - a.bytes);
  const packed = compress ? compress(bytes) : null;
  return {
    json,
    aligned: JSON.stringify(value, null, 2),
    readableBytes: enc.encode(readable).length,
    bytes: bytes.length,
    compressed: packed?.length ?? null,
    hex: packed ? hexDump(packed) : '',
    base64: packed ? toBase64(packed) : '',
    fields,
  };
}

// 16 bytes per line: offset, hex, and printable characters.
export function hexDump(bytes) {
  const lines = [];
  for (let i = 0; i < bytes.length; i += 16) {
    const row = [...bytes.slice(i, i + 16)];
    const hex = row.map((b) => b.toString(16).padStart(2, '0')).join(' ').padEnd(47);
    const text = row.map((b) => (b >= 32 && b < 127 ? String.fromCharCode(b) : '.')).join('');
    lines.push(`${i.toString(16).padStart(4, '0')}  ${hex}  ${text}`);
  }
  return lines.join('\n');
}

function toBase64(bytes) {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}
