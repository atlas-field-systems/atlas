// Turns an example scenario (examples/<name>/scenario.json plus its message files)
// into rows with sizes and validation. Shared by the docs script, the tests and the viewer.
import { validate, measure, messageFile } from './protocol.mjs';

export async function loadScenario(protocol, readExample, name, compress) {
  const scenario = await readExample(`${name}/scenario.json`);
  const rows = [];
  for (const step of scenario.steps) {
    if (step.gap) { rows.push({ ...step }); continue; }
    const message = await readExample(`${name}/${step.file}`);
    const file = messageFile(message);
    const check = protocol.schemas[file] ? validate(protocol, file, message) : { ok: false, errors: [`no definition ${file}`] };
    const size = measure(message, compress);
    rows.push({ ...step, message, ok: check.ok, errors: check.errors, bytes: size.bytes, compressed: size.compressed, fields: size.fields });
  }
  return { ...scenario, rows };
}

// Where the bytes go: fields repeated in every message, and the longest single fields.
export function verbosity(rows) {
  const msgs = rows.filter((r) => r.message);
  const keys = new Map();
  for (const r of msgs) for (const f of r.fields) {
    const k = f.path.replace(/\.\d+(\.|$)/g, '[]$1');
    const e = keys.get(k) ?? { path: k, count: 0, bytes: 0 };
    e.count++; e.bytes += f.bytes; keys.set(k, e);
  }
  const total = msgs.reduce((s, r) => s + r.bytes, 0);
  const all = [...keys.values()].sort((a, b) => b.bytes - a.bytes);
  const longest = msgs.flatMap((r) => r.fields.map((f) => ({ file: r.file, ...f }))).sort((a, b) => b.bytes - a.bytes);
  const enc = new TextEncoder();
  const valueBytes = msgs.reduce((s, r) => s + r.fields.reduce((a, f) => a + enc.encode(JSON.stringify(f.path.split('.').reduce((o, k) => o[k], r.message))).length, 0), 0);
  return { keyBytes: total - valueBytes, messages: msgs.length, total, compressed: msgs.reduce((s, r) => s + r.compressed, 0), fields: all, longest };
}
