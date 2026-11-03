// Copies the site, the shared lib, and the definitions into _site/ for GitHub Pages.
import { cpSync, rmSync } from 'node:fs';
const defs = process.env.ATLAS_DEFINITIONS ?? 'definitions';
const out = process.env.SITE_OUT ?? '_site';
rmSync(out, { recursive: true, force: true });
cpSync('site', out, { recursive: true });
cpSync('lib', `${out}/lib`, { recursive: true });
cpSync(defs, `${out}/definitions`, { recursive: true });
console.log(`Built ${out}/`);
