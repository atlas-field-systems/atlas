// Unpacks the pinned Protocol release (package.json "protocol") into protocol/, which git ignores.
// Core reads that copy, never ../protocol, so spec work in progress on main never breaks it.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';

const tag = `protocol-${JSON.parse(readFileSync('package.json', 'utf8')).protocol}`;
const stamp = 'protocol/.release';
if (existsSync(stamp) && readFileSync(stamp, 'utf8') === tag) process.exit(0);

const root = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
const git = (...args) => execFileSync('git', args, { cwd: root, maxBuffer: 1 << 28 });
try { git('rev-parse', '-q', '--verify', `refs/tags/${tag}`); } catch { git('fetch', '-q', 'origin', 'tag', tag); }
rmSync('protocol', { recursive: true, force: true });
mkdirSync('protocol');
execFileSync('tar', ['-x', '-C', 'protocol'], { input: git('archive', `${tag}:protocol`) });
writeFileSync(stamp, tag);
console.log(`protocol/ is ${tag}`);
