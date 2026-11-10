// Checks every link between the repository's markdown files: the target file exists, and
// a #fragment names a heading in it. Run from the repository root: node .github/scripts/check-links.mjs
import { existsSync, readFileSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join, normalize } from 'node:path';

const files = execFileSync('git', ['ls-files', '*.md'], { encoding: 'utf8' }).trim().split('\n');
// The root AGENTS.md rule: a blob/main link is the file at that path in this repository.
const own = /^https:\/\/github\.com\/atlas-field-systems\/atlas\/(?:blob|tree)\/main\/(.*)$/;
// Text in a code block is neither a heading nor a link, and a code span is not a link.
const blank = (code) => code.replace(/[^\n]/g, ' ');
const withoutBlocks = (text) => text.replace(/^```[\s\S]*?^```/gm, blank);
const withoutCode = (text) => withoutBlocks(text).replace(/`[^`\n]*`/g, blank);

// GitHub's heading anchors: lower case, punctuation dropped, spaces to hyphens, repeats numbered.
const anchors = new Map();
const anchorsOf = (file) => {
  if (!anchors.has(file)) {
    const seen = new Map();
    const ids = new Set();
    for (const [, heading] of withoutBlocks(readFileSync(file, 'utf8')).matchAll(/^#{1,6}\s+(.*)$/gm)) {
      const base = heading.trim().toLowerCase().replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
        .replace(/[^\p{L}\p{N}_\s-]/gu, '').replace(/\s/g, '-');
      const n = seen.get(base) ?? 0;
      seen.set(base, n + 1);
      ids.add(n ? `${base}-${n}` : base);
    }
    anchors.set(file, ids);
  }
  return anchors.get(file);
};

let checked = 0;
const problems = [];
for (const file of files) {
  const text = withoutCode(readFileSync(file, 'utf8'));
  for (const m of text.matchAll(/\]\(([^)\s]+)\)/g)) {
    const line = text.slice(0, m.index).split('\n').length;
    const inRepo = m[1].match(own);
    if (!inRepo && /^[a-z][a-z0-9+.-]*:/i.test(m[1])) continue;
    const [path, fragment] = (inRepo ? inRepo[1] : m[1]).split('#');
    const target = inRepo ? normalize(path) : path ? normalize(join(dirname(file), path)) : file;
    checked++;
    if (target.startsWith('..') || !existsSync(target)) problems.push(`${file}:${line}: ${m[1]} points at a missing file`);
    else if (fragment && target.endsWith('.md') && statSync(target).isFile() && !anchorsOf(target).has(fragment)) {
      problems.push(`${file}:${line}: ${m[1]} points at a missing heading`);
    }
  }
}
if (problems.length) {
  console.error(problems.join('\n'));
  process.exit(1);
}
console.log(`OK: ${checked} links in ${files.length} files checked.`);
