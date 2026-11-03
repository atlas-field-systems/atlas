// Atlas Protocol viewer for the browser. Everything shown comes from definitions/.
// Bundled into one local file at build time, so the site needs no outside servers.
import Ajv from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { deflateSync } from 'fflate';
import { marked } from 'marked';
import { loadScenario } from './lib/scenario.mjs';
import { loadProtocol, fieldTree, leaves, example, generate, setPath, parseInput, validate, measure, describeType, messageTree, messageFile, splitId } from './lib/protocol.mjs';

const readJson = async (f) => (await fetch(`definitions/${f}`)).json();
const protocol = await loadProtocol(readJson, Ajv, addFormats);
const compress = (b) => deflateSync(b, { level: 9 });
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);

$('title').textContent = protocol.index.title;
// Messages as a tree (group › type › kind) from the folders under messages/; then the other groups.
// Kinds appear under their types, so the group that lists kind files is not shown again.
const tree = messageTree(protocol);
const inTree = new Set(tree.flatMap((g) => g.types.flatMap((t) => [t.file, ...t.kinds.map((k) => k.file)])));
const baseName = (f) => f.split('/').pop().replace('.json', '');
$('nav').innerHTML = '<h3>Messages</h3>' + tree.map((g) => `<div class="grp">${esc(g.name)}</div>` + g.types.map((t) => t.kinds.length
  ? `<div class="typ">${esc(baseName(t.file))}</div>` + t.kinds.map((k) => `<a class="knd" data-file="${esc(t.file)}@${esc(k.name)}">${esc(k.name)}</a>`).join('')
  : `<a class="typ" data-file="${esc(t.file)}">${esc(baseName(t.file))}</a>`).join('')).join('') +
  protocol.index.groups.filter((g) => !g.files.every((f) => inTree.has(f))).map((g) => `<h3>${esc(g.name)}</h3>` +
    g.files.filter((f) => !inTree.has(f)).map((f) => `<a data-file="${esc(f)}">${esc(protocol.schemas[f].title ?? f)}</a>`).join('')).join('');
const scenarios = await (await fetch('examples/index.json')).json();
$('nav').innerHTML += '<h3>Scenarios</h3>' + scenarios.map((n) => `<a data-file="scenario:${esc(n)}">${esc(n.replace(/-/g, ' ').replace(/\//g, ' › '))}</a>`).join('');
$('nav').onclick = (e) => { if (e.target.dataset.file) location.hash = e.target.dataset.file; };
const docs = await (await fetch('docs/index.json')).json();
$('nav').innerHTML += '<h3>Docs</h3>' + docs.map((d) => `<a data-file="doc:${esc(d)}">${esc(d.replace(/\.md$/, '').replace(/[-/]/g, ' '))}</a>`).join('');
branchBanner();
window.onhashchange = () => route(location.hash.slice(1));
if (location.hash) route(location.hash.slice(1));

function route(h) {
  if (h.startsWith('doc:')) return showDoc(h.slice(4));
  if (h.startsWith('scenario:')) return showScenario(h.slice(9));
  return show(h);
}

async function showDoc(name) {
  document.querySelectorAll('nav a').forEach((a) => a.classList.toggle('on', a.dataset.file === `doc:${name}`));
  const text = await (await fetch(`docs/${name}`)).text();
  $('view').innerHTML = `<article class="doc">${marked.parse(text)}</article>`;
  const diagrams = [...document.querySelectorAll('code.language-mermaid')];
  if (!diagrams.length) return;
  diagrams.forEach((c) => { c.parentElement.outerHTML = `<pre class="mermaid">${esc(c.textContent)}</pre>`; });
  const { default: mermaid } = await import('https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs');
  mermaid.initialize({ startOnLoad: false });
  await mermaid.run({ querySelector: 'pre.mermaid' });
}

// Which version this is (main or a pull request preview), with links to the others.
async function branchBanner() {
  const m = location.pathname.match(/^(.*?\/)pr\/pr-(\d+)\//);
  const root = m ? m[1] : location.pathname.replace(/[^/]*$/, '');
  const here = m ? Number(m[2]) : null;
  let prs = [];
  try { prs = await (await fetch('https://api.github.com/repos/atlas-field-systems/protocol/pulls?state=open&per_page=50')).json(); } catch {}
  if (!Array.isArray(prs)) prs = [];
  const link = (href, label, on) => on ? `<b>${esc(label)}</b>` : `<a href="${esc(href)}">${esc(label)}</a>`;
  const cur = prs.find((p) => p.number === here);
  $('branch').className = here ? 'branch' : 'branch main';
  $('branch').innerHTML = (here ? `Preview of pull request <a href="https://github.com/atlas-field-systems/protocol/pull/${here}">#${here}</a>${cur ? `: ${esc(cur.title)}` : ''} (work in progress, not on main). ` : 'Showing main. ') +
    'Versions: ' + link(root, 'main', !here) + prs.map((p) => link(`${root}pr/pr-${p.number}/`, `#${p.number} ${p.title}`, p.number === here)).join('');
}

async function showScenario(name) {
  document.querySelectorAll('nav a').forEach((a) => a.classList.toggle('on', a.dataset.file === `scenario:${name}`));
  const s = await loadScenario(protocol, async (f) => (await fetch(`examples/${f}`)).json(), name, compress);
  const row = (r) => r.gap
    ? `<tr class="gap"><td>—</td><td></td><td><b>GAP: ${esc(r.gap)}</b></td><td>${esc(r.why)}</td><td></td><td></td></tr>`
    : `<tr><td>${esc(r.file.split('-')[0])}</td><td>${esc(r.from)} → ${esc(r.to)}</td><td>${protocol.schemas[messageFile(r.message)] ? `<a href="#${esc(messageFile(r.message))}${r.message.kind ? `@${esc(r.message.kind)}` : ''}"><code>${esc(r.message.type)}</code>${r.message.kind ? ` <code>${esc(r.message.kind)}</code>` : ''}</a>` : `<code>${esc(r.message.type)}</code>`}${r.ok === false ? ' <b>invalid</b>' : ''}</td><td>${esc(r.why)}<details><summary>JSON</summary><pre>${esc(JSON.stringify(r.message, null, 2))}</pre></details></td><td>${r.bytes}</td><td>${r.compressed}</td></tr>`;
  $('view').innerHTML = `<h2>${esc(s.title)}</h2><p>${esc(s.source)}</p>` + Object.entries(s.branches).map(([b, label]) =>
    `<h3>${esc(label)}</h3><table class="scenario"><tr><th>#</th><th>From → To</th><th>Message</th><th>Why</th><th>Minified</th><th>Deflate</th></tr>${s.rows.filter((r) => r.branch === b).map(row).join('')}</table>`).join('');
}

function show(id) {
  const { file, kind } = splitId(id);
  if (!protocol.schemas[file]) return;
  document.querySelectorAll('nav a').forEach((a) => a.classList.toggle('on', a.dataset.file === id));
  const s = protocol.schemas[file];
  const k = kind && tree.flatMap((g) => g.types).find((t) => t.file === file)?.kinds.find((x) => x.name === kind);
  const fields = fieldTree(protocol, id);
  let value = example(protocol, id);
  $('view').innerHTML = `<h2>${k ? `<code>${esc(s.properties.type.const)}</code> <code>${esc(kind)}</code>` : esc(s.title ?? file)} <small><code>${esc(file)}</code></small></h2><p>${esc(s.description)}</p>${k ? `<p><b>${esc(kind)}:</b> ${esc(protocol.schemas[k.file].description)}</p>` : ''}
    <button id="ex">Use the example</button><button id="min">Minimal (required only)</button>
    <div class="cols"><div class="fieldcol"><h3>Fields</h3><table id="fields"></table></div>
    <div><h3>Message JSON</h3><p class="lbl" id="readlbl"></p><textarea id="json" spellcheck="false"></textarea><div id="result"></div></div>
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
    const v = validate(protocol, id, value);
    const m = measure(value, compress);
    $('compact').innerHTML = `<p class="lbl">Compact JSON, line for line with the message JSON. Sent minified on one line: <b>${m.bytes}</b> bytes</p><pre class="aligned">${esc(m.aligned)}</pre>`;
    $('readlbl').innerHTML = `Readable: <b>${m.readableBytes}</b> bytes`;
    $('json').rows = Math.max(m.aligned.split('\n').length, $('json').value.split('\n').length) + 1;
    renderPacked(m);
    $('result').innerHTML = `<p class="${v.ok ? 'ok' : 'bad'}">${v.ok ? 'Valid' : 'Invalid'}</p>
      ${v.errors.map((e) => `<div class="bad">${esc(e)}</div>`).join('')}
      <p><b>${m.bytes}</b> bytes as compact JSON, <b>${m.compressed}</b> bytes compressed (deflate)</p>
      <table><tr><th>Largest fields</th><th>Bytes</th></tr>${m.fields.slice(0, 8).map((f) => `<tr><td>${esc(f.path)}</td><td>${f.bytes}</td></tr>`).join('')}</table>`;
  };
  const renderPacked = (m) => {
    $('packed').innerHTML = `<p><b>${m.bytes}</b> bytes compact JSON (above) &rarr; <b>${m.compressed}</b> bytes deflate (${Math.round((100 * m.compressed) / m.bytes)}%)</p>
      <h4>Hex dump</h4><pre>${esc(m.hex)}</pre><h4>Base64</h4><pre class="wrap">${esc(m.base64)}</pre>`;
  };
  $('json').oninput = () => { try { value = JSON.parse($('json').value); render(true); } catch { $('result').innerHTML = '<p class="bad">Not valid JSON yet</p>'; } };
  $('ex').onclick = () => { value = example(protocol, id); render(); };
  $('min').onclick = () => { value = generate({ ...fields, schema: {} }); render(); };
  render();
}
