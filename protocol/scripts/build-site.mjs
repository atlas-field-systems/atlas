// Bundles the site and copies the definitions and docs into _site/ for GitHub Pages.
import { cpSync, rmSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { buildSync } from 'esbuild';
const defs = process.env.ATLAS_DEFINITIONS ?? 'definitions';
const out = process.env.SITE_OUT ?? '_site';
rmSync(out, { recursive: true, force: true });
cpSync('site', out, { recursive: true });
// app.mjs plus ajv, ajv-formats and fflate in one self-contained file.
buildSync({ entryPoints: ['site/app.mjs'], bundle: true, format: 'esm', minify: true, outfile: `${out}/app.mjs`, logLevel: 'error' });
cpSync(defs, `${out}/definitions`, { recursive: true });
// The docs pages, so pull request previews show proposals too.
cpSync('docs', `${out}/docs`, { recursive: true });
const docs = readdirSync('docs', { recursive: true }).filter((f) => f.endsWith('.md')).sort();
writeFileSync(`${out}/docs/index.json`, JSON.stringify(docs));
cpSync('examples', `${out}/examples`, { recursive: true });
const prs = process.env.SITE_PULL_REQUESTS ? JSON.parse(readFileSync(process.env.SITE_PULL_REQUESTS, 'utf8')) : [];
writeFileSync(`${out}/pull-requests.json`, JSON.stringify(prs));
console.log(`Built ${out}/`);
