// Fails when a retired phrase is back in the docs or the Protocol definitions. A retired
// phrase teaches a rule the owner reversed; retired-phrases.json lists each one with why it
// was retired and an example it must catch. The archive and the decision log keep history
// and are skipped. Run from the repository root: node .github/scripts/check-retired.mjs
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const list = JSON.parse(readFileSync('.github/retired-phrases.json', 'utf8'));
const skip = (file) => file.startsWith('atlas/archive/') || file === 'atlas/decision-log.md';
const files = execFileSync('git', ['ls-files', '*.md', 'protocol/definitions/*.json'], { encoding: 'utf8' })
  .trim().split('\n').filter((file) => !skip(file));

const entries = list.map((entry) => ({
  ...entry,
  pattern: new RegExp(entry.phrase, 'gi'),
  unless: entry.unless ? new RegExp(entry.unless, 'i') : null,
}));

// Split text into sentences, list items, and table cells, each flattened to one line with
// markdown emphasis and code marks removed, remembering the line each one starts on.
const pieces = (text) => {
  const out = [];
  const boundary = /[.!?|;]\s|\n\s*\n|\n\s*(?:[-*]|\d+\.)\s/g;
  let start = 0;
  const push = (end) => {
    const raw = text.slice(start, end);
    const flat = raw.replace(/[`*]/g, '').replace(/\s+/g, ' ').trim();
    if (flat) out.push({ flat, line: text.slice(0, start).split('\n').length + (raw.match(/^\s*/)[0].split('\n').length - 1) });
  };
  for (const m of text.matchAll(boundary)) {
    push(m.index + 1);
    start = m.index + 1;
  }
  push(text.length);
  return out;
};

const flagged = (entry, flat) => {
  entry.pattern.lastIndex = 0;
  return entry.pattern.test(flat) && !(entry.unless && entry.unless.test(flat));
};

const problems = [];
for (const entry of entries) {
  if (!entry.example || !pieces(entry.example).some((p) => flagged(entry, p.flat))) {
    problems.push(`retired-phrases.json: "${entry.phrase}" does not catch its own example`);
  }
}
for (const file of files) {
  for (const { flat, line } of pieces(readFileSync(file, 'utf8'))) {
    for (const entry of entries) {
      if (flagged(entry, flat)) problems.push(`${file}:${line}: retired phrase /${entry.phrase}/: ${entry.why}\n    ${flat}`);
    }
  }
}
if (problems.length) {
  console.error(problems.join('\n'));
  process.exit(1);
}
console.log(`OK: ${entries.length} retired phrases, ${files.length} files checked.`);
