// Copies the site, the shared lib, the definitions and the docs into _site/ for GitHub Pages.
import { cpSync, rmSync, readdirSync, writeFileSync } from 'node:fs';
import { buildSync } from 'esbuild';
const defs = process.env.ATLAS_DEFINITIONS ?? 'definitions';
const out = process.env.SITE_OUT ?? '_site';
rmSync(out, { recursive: true, force: true });
cpSync('site', out, { recursive: true });
cpSync('lib', `${out}/lib`, { recursive: true });
// app.mjs plus ajv, ajv-formats and fflate in one self-contained file.
buildSync({ entryPoints: [`${out}/app.mjs`], nodePaths: ['node_modules'], bundle: true, format: 'esm', minify: true, outfile: `${out}/app.mjs`, allowOverwrite: true, logLevel: 'error' });
cpSync(defs, `${out}/definitions`, { recursive: true });
// The docs pages, so pull request previews show proposals too.
cpSync('docs', `${out}/docs`, { recursive: true });
const docs = readdirSync('docs', { recursive: true }).filter((f) => f.endsWith('.md')).sort();
writeFileSync(`${out}/docs/index.json`, JSON.stringify(docs));
cpSync('examples', `${out}/examples`, { recursive: true });
console.log(`Built ${out}/`);
