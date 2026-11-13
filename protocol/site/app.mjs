// Atlas Protocol viewer for the browser. Everything shown comes from definitions/.
// Bundled into one local file at build time, so the site needs no outside servers.
import { loadDefinitions } from '../lib/definitions.mjs';
import { deflateSync } from 'fflate';
import { marked } from 'marked';
import { fieldTree, leaves, example, generate, setPath, parseInput, measure, describeType, recordTree, splitId } from '../lib/protocol.mjs';

const readBytes = async (file) => {
  const response = await fetch(`definitions/${file}`);
  if (!response.ok) throw new Error(`Cannot load definition: ${file}`);
  return new Uint8Array(await response.arrayBuffer());
};
const indexBytes = await readBytes('index.json');
const index = JSON.parse(new TextDecoder().decode(indexBytes));
const files = new Map(await Promise.all(index.groups.flatMap((g) => g.files)
  .map(async (file) => [file, await readBytes(file)])));
files.set('index.json', indexBytes);
const protocol = await loadDefinitions(files);
const compress = (b) => deflateSync(b, { level: 9 });
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);

$('title').textContent = protocol.index.title;
// Kinds appear under their records, so the group that lists kind files is not shown again.
const tree = recordTree(protocol);
const records = tree.flatMap((g) => g.records);
const inTree = new Set(records.flatMap((r) => [r.file, ...r.kinds.map((k) => k.file)]));
const baseName = (f) => f.split('/').pop().replace('.json', '');
$('nav').innerHTML = '<h3>Records</h3>' + tree.map((g) => (g.name ? `<div class="grp">${esc(g.name)}</div>` : '') + g.records.map((r) => r.kinds.length
  ? `<div class="typ">${esc(baseName(r.file))}</div>` + r.kinds.map((k) => `<a class="knd" data-file="${esc(r.file)}@${esc(k.name)}">${esc(k.name)}</a>`).join('')
  : `<a class="typ" data-file="${esc(r.file)}">${esc(baseName(r.file))}</a>`).join('')).join('') +
  protocol.index.groups.filter((g) => !g.files.every((f) => inTree.has(f))).map((g) => `<h3>${esc(g.name)}</h3>` +
    g.files.filter((f) => !inTree.has(f)).map((f) => `<a data-file="${esc(f)}">${esc(protocol.schemas[f].title ?? f)}</a>`).join('')).join('');
$('nav').onclick = (e) => { if (e.target.dataset.file) location.hash = e.target.dataset.file; };
const docs = await (await fetch('docs/index.json')).json();
$('nav').innerHTML += '<h3>Docs</h3>' + docs.map((d) => `<a data-file="doc:${esc(d)}">${esc(d.replace(/\.md$/, '').replace(/[-/]/g, ' '))}</a>`).join('');
branchBanner();
window.onhashchange = () => route(location.hash.slice(1));
if (location.hash) route(location.hash.slice(1));

function route(h) {
  if (h.startsWith('doc:')) return showDoc(h.slice(4));
  return show(h);
}

async function showDoc(name) {
  document.querySelectorAll('nav a').forEach((a) => a.classList.toggle('on', a.dataset.file === `doc:${name}`));
  const text = await (await fetch(`docs/${name}`)).text();
  $('view').innerHTML = `<article class="doc">${marked.parse(text)}</article>`;
}

// Which version this is (main or a pull request preview), with links to the others.
async function branchBanner() {
  // The viewer sits at protocol/ of the shared site, or at the root when served alone.
  const m = location.pathname.match(/^(.*?\/)(?:pr\/pr-(\d+)\/)?(protocol\/)?[^/]*$/);
  const root = m[1];
  const sub = m[3] ?? '';
  const here = m[2] ? Number(m[2]) : null;
  let prs = [];
  try { prs = await (await fetch('pull-requests.json')).json(); } catch {}
  prs = Array.isArray(prs) ? prs.filter((p) => Number.isInteger(p?.number) && p.number > 0 && typeof p.title === 'string') : [];
  const link = (href, label, on) => on ? `<b>${esc(label)}</b>` : `<a href="${esc(href)}">${esc(label)}</a>`;
  const cur = prs.find((p) => p.number === here);
  $('branch').className = here ? 'branch' : 'branch main';
  $('branch').innerHTML = (here ? `Preview of pull request <a href="https://github.com/atlas-field-systems/atlas/pull/${here}">#${here}</a>${cur ? `: ${esc(cur.title)}` : ''} (work in progress, not on main). ` : 'Showing main. ') +
    'Versions: ' + link(`${root}${sub}`, 'main', !here) + prs.map((p) => link(`${root}pr/pr-${p.number}/${sub}`, `#${p.number} ${p.title}`, p.number === here)).join('');
}

function show(id) {
  const { file, kind } = splitId(id);
  if (!protocol.schemas[file]) return;
  document.querySelectorAll('nav a').forEach((a) => a.classList.toggle('on', a.dataset.file === id));
  const s = protocol.schemas[file];
  const r = records.find((x) => x.file === file);
  const k = kind && r?.kinds.find((x) => x.name === kind);
  const fields = fieldTree(protocol, id);
  let value = example(protocol, id);
  $('view').innerHTML = `<h2>${k ? `<code>${esc(r.name)}</code> <code>${esc(kind)}</code>` : esc(s.title ?? file)} <small><code>${esc(file)}</code></small></h2><p>${esc(s.description)}</p>${k ? `<p><b>${esc(kind)}:</b> ${esc(protocol.schemas[k.file].description)}</p>` : ''}
    <button id="ex">Use the example</button><button id="min">Minimal (required only)</button>
    <div class="cols"><div class="fieldcol"><h3>Fields</h3><table id="fields"></table></div>
    <div><h3>Record JSON</h3><p class="lbl" id="readlbl"></p><textarea id="json" spellcheck="false"></textarea><div id="verdict"></div></div>
    <div><h3>Compressed</h3><div id="compact"></div><div id="packed"></div></div></div>`;
  const render = (fromText) => {
    const rows = leaves(fields, value);
    $('fields').innerHTML = '<tr><th>Field</th><th>Value</th></tr>' + rows.map((r, i) => {
      const n = r.node;
      const cur = r.value === undefined ? '' : r.value;
      const ctl = n.kind === 'enum'
        ? `<select data-i="${i}"><option value="">(none)</option>${n.options.map((o) => `<option ${o === cur ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select>`
        : `<input data-i="${i}" value="${esc(cur)}">`;
      return `<tr><td><b>${r.path.map(esc).join('.<wbr>')}</b>${n.required ? '' : ' <i>(optional)</i>'}<br><code>${esc(describeType(n))}</code></td>
        <td class="val">${ctl}</td></tr>
        <tr class="descrow"><td colspan="2" class="desc">${esc(n.description)}</td></tr>`;
    }).join('');
    $('fields').onchange = (e) => {
      const r = rows[e.target.dataset.i];
      value = setPath(value, r.path, parseInput(r.node, e.target.value));
      render();
    };
    if (!fromText) $('json').value = JSON.stringify(value, null, 2);
    const v = protocol.checkFile(splitId(id).file, value);
    const m = measure(value, compress);
    $('compact').innerHTML = `<p class="lbl">Compact JSON, as sent on one line: <b>${m.bytes}</b> bytes</p><pre class="wrap">${esc(m.json)}</pre>`;
    $('readlbl').innerHTML = `Readable: <b>${m.readableBytes}</b> bytes`;
    $('json').rows = $('json').value.split('\n').length + 1;
    renderPacked(m);
    $('verdict').innerHTML = `<p class="${v.ok ? 'ok' : 'bad'}">${v.ok ? 'Valid' : 'Invalid'}</p>
      ${(v.ok ? [] : v.problems).map((p) => `<div class="bad">${esc(p.path)} ${esc(p.message)}</div>`).join('')}
      <p><b>${m.bytes}</b> bytes as compact JSON, <b>${m.compressed}</b> bytes compressed (deflate)</p>
      <table><tr><th>Largest fields</th><th>Bytes</th></tr>${m.fields.slice(0, 8).map((f) => `<tr><td>${esc(f.path)}</td><td>${f.bytes}</td></tr>`).join('')}</table>`;
  };
  const renderPacked = (m) => {
    $('packed').innerHTML = `<p><b>${m.bytes}</b> bytes compact JSON (above) &rarr; <b>${m.compressed}</b> bytes deflate (${Math.round((100 * m.compressed) / m.bytes)}%)</p>
      <h4>Hex dump</h4><pre>${esc(m.hex)}</pre><h4>Base64</h4><pre class="wrap">${esc(m.base64)}</pre>`;
  };
  $('json').oninput = () => { try { value = JSON.parse($('json').value); render(true); } catch { $('verdict').innerHTML = '<p class="bad">Not valid JSON yet</p>'; } };
  $('ex').onclick = () => { value = example(protocol, id); render(); };
  $('min').onclick = () => { value = generate({ ...fields, schema: {} }); render(); };
  render();
}
