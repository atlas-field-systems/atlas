// Atlas Protocol viewer for the browser. Everything shown comes from definitions/.
import Ajv from 'https://esm.sh/ajv@8.17.1/dist/2020';
import addFormats from 'https://esm.sh/ajv-formats@3.0.1';
import { deflateSync } from 'https://esm.sh/fflate@0.8.2';
import { loadProtocol, fieldTree, leaves, example, generate, setPath, parseInput, validate, measure, describeType } from './lib/protocol.mjs';

const readJson = async (f) => (await fetch(`definitions/${f}`)).json();
const protocol = await loadProtocol(readJson, Ajv, addFormats);
const compress = (b) => deflateSync(b, { level: 9 });
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);

$('title').textContent = protocol.index.title;
$('nav').innerHTML = protocol.index.groups.map((g) => `<h3>${esc(g.name)}</h3>` +
  g.files.map((f) => `<a data-file="${esc(f)}">${esc(protocol.schemas[f].title ?? f)}</a>`).join('')).join('');
$('nav').onclick = (e) => { if (e.target.dataset.file) location.hash = e.target.dataset.file; };
window.onhashchange = () => show(location.hash.slice(1));
if (location.hash) show(location.hash.slice(1));

function show(file) {
  if (!protocol.schemas[file]) return;
  document.querySelectorAll('nav a').forEach((a) => a.classList.toggle('on', a.dataset.file === file));
  const s = protocol.schemas[file];
  const tree = fieldTree(protocol, file);
  let value = example(protocol, file);
  $('view').innerHTML = `<h2>${esc(s.title ?? file)} <code>${esc(file)}</code></h2><p>${esc(s.description)}</p>
    <button id="ex">Use the example</button><button id="min">Minimal (required only)</button>
    <div class="cols"><div><h3>Fields</h3><table id="fields"></table></div>
    <div><h3>Message JSON</h3><textarea id="json" spellcheck="false"></textarea><div id="result"></div></div></div>`;
  const render = (fromText) => {
    const rows = leaves(tree, value);
    $('fields').innerHTML = '<tr><th>Field</th><th>Value</th></tr>' + rows.map((r, i) => {
      const n = r.node;
      const cur = r.value === undefined ? '' : r.value;
      const ctl = n.kind === 'enum'
        ? `<select data-i="${i}"><option value="">(none)</option>${n.options.map((o) => `<option ${o === cur ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select>`
        : `<input data-i="${i}" value="${esc(cur)}">`;
      return `<tr><td><b>${esc(r.path.join('.'))}</b>${n.required ? '' : ' <i>(optional)</i>'}<br><code>${esc(describeType(n))}</code></td>
        <td>${ctl}<div class="desc">${esc(n.description)}</div></td></tr>`;
    }).join('');
    $('fields').onchange = (e) => {
      const r = rows[e.target.dataset.i];
      value = setPath(value, r.path, parseInput(r.node, e.target.value));
      render();
    };
    if (!fromText) $('json').value = JSON.stringify(value, null, 2);
    const v = validate(protocol, file, value);
    const m = measure(value, compress);
    $('result').innerHTML = `<p class="${v.ok ? 'ok' : 'bad'}">${v.ok ? 'Valid' : 'Invalid'}</p>
      ${v.errors.map((e) => `<div class="bad">${esc(e)}</div>`).join('')}
      <p><b>${m.bytes}</b> bytes as compact JSON, <b>${m.compressed}</b> bytes compressed (deflate)</p>
      <table><tr><th>Largest fields</th><th>Bytes</th></tr>${m.fields.slice(0, 8).map((f) => `<tr><td>${esc(f.path)}</td><td>${f.bytes}</td></tr>`).join('')}</table>`;
  };
  $('json').oninput = () => { try { value = JSON.parse($('json').value); render(true); } catch { $('result').innerHTML = '<p class="bad">Not valid JSON yet</p>'; } };
  $('ex').onclick = () => { value = example(protocol, file); render(); };
  $('min').onclick = () => { value = generate({ ...tree, schema: {} }); render(); };
  render();
}
