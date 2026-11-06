// Builds the Charter site from the repo's markdown files. Nothing is copied by hand:
// pages are the .md files, and the nav is the README's numbered reading list.
import { readFileSync, writeFileSync, mkdirSync, rmSync, readdirSync, cpSync } from 'node:fs';
import { join } from 'node:path';
import { marked, TextRenderer } from 'marked';

const root = '..';
const out = process.env.SITE_OUT ?? '_site';
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

const readme = readFileSync(join(root, 'README.md'), 'utf8');
const nav = [{ title: 'Home', file: 'README.md' },
  ...[...readme.matchAll(/^\d+\.\s+\[([^\]]+)\]\(([^)#]+\.md)\)/gm)].map((m) => ({ title: m[1], file: m[2] }))];

const page = (f) => (f === 'README.md' ? 'index.html' : f.replace(/\.md$/, '.html'));
const esc = (s) => s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
const headingIds = new Set();

marked.use({
  renderer: {
    heading({ tokens, depth }) {
      const text = this.parser.parseInline(tokens, new TextRenderer()).replace(/<[^>]*>/g, '');
      const base = text.toLowerCase().replace(/[^\p{L}\p{N}_\s-]/gu, '').replace(/\s/g, '-');
      let id = base;
      for (let suffix = 1; headingIds.has(id); suffix++) id = `${base}-${suffix}`;
      headingIds.add(id);
      return `<h${depth} id="${esc(id)}">${this.parser.parseInline(tokens)}</h${depth}>\n`;
    },
    code({ text, lang }) {
      return lang === 'mermaid' ? `<pre class="mermaid">${esc(text)}</pre>` : `<pre><code>${esc(text)}</code></pre>`;
    },
    link({ href, tokens }) {
      const local = href.replace(/^([\w-]+)\.md(#.*)?$/, (_, n, h = '') => page(`${n}.md`) + h);
      return `<a href="${esc(local)}">${this.parser.parseInline(tokens)}</a>`;
    },
  },
});

for (const f of readdirSync(root).filter((x) => x.endsWith('.md'))) {
  headingIds.clear();
  const md = readFileSync(join(root, f), 'utf8');
  const title = md.match(/^#\s+(.+)$/m)?.[1] ?? f;
  const links = nav.map((n) => `<a href="${page(n.file)}"${n.file === f ? ' class="on"' : ''}>${esc(n.title)}</a>`).join('');
  writeFileSync(join(out, page(f)), `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(title)}</title>
<link rel="stylesheet" href="style.css"></head><body><nav>${links}</nav><main>${marked.parse(md)}</main>
<script src="branch.js"></script><script type="module">import m from './mermaid.esm.min.mjs'; m.initialize({ startOnLoad: true });</script></body></html>`);
}
cpSync('style.css', join(out, 'style.css'));
cpSync('branch.js', join(out, 'branch.js'));
const prs = process.env.SITE_PULL_REQUESTS ? JSON.parse(readFileSync(process.env.SITE_PULL_REQUESTS, 'utf8')) : [];
writeFileSync(join(out, 'pull-requests.json'), JSON.stringify(prs));
// Mermaid is served from this site, not a CDN.
const dist = 'node_modules/mermaid/dist';
cpSync(join(dist, 'mermaid.esm.min.mjs'), join(out, 'mermaid.esm.min.mjs'));
cpSync(join(dist, 'chunks/mermaid.esm.min'), join(out, 'chunks/mermaid.esm.min'), { recursive: true, filter: (s) => !s.endsWith('.map') });
console.log(`Built ${out}/ with ${nav.length} nav entries`);
