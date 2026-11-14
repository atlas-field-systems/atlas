#!/usr/bin/env node
// Merges one pull request into main the way AGENTS.md requires: a local --no-ff merge under the
// project's noreply identity, pushed only when every GitHub Actions check on the PR head passed
// and main ends up with exactly the tree those checks tested.
//
//   node .github/scripts/merge-pr.mjs <number>          # check and merge locally, push nothing
//   node .github/scripts/merge-pr.mjs <number> --push   # same, then push main
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const NAME = 'the-Drunken-coder';
const EMAIL = '183743141+the-Drunken-coder@users.noreply.github.com';
const PASSED = new Set(['SUCCESS', 'SKIPPED', 'NEUTRAL']);

const [number, flag] = process.argv.slice(2);
if (!/^\d+$/.test(number ?? '') || (flag !== undefined && flag !== '--push')) {
  console.error('usage: node .github/scripts/merge-pr.mjs <number> [--push]');
  process.exit(2);
}
const push = flag === '--push';

const run = (cmd, args, opts = {}) => execFileSync(cmd, args, { encoding: 'utf8', ...opts }).trim();
const git = (...args) => run('git', args);
class Refusal extends Error {}
const refuse = (why) => {
  throw new Refusal(why);
};

try {
  merge();
} catch (error) {
  if (!(error instanceof Refusal)) throw error;
  console.error(`refused: ${error.message}`);
  process.exit(1);
}

function merge() {
  const pr = JSON.parse(run('gh', ['pr', 'view', number, '--json',
    'number,title,state,isCrossRepository,baseRefName,headRefName,headRefOid,statusCheckRollup']));
  if (pr.state !== 'OPEN') refuse(`PR #${pr.number} is ${pr.state}`);
  if (pr.isCrossRepository) refuse('the PR comes from a fork');

  const actions = pr.statusCheckRollup.filter((c) => c.__typename === 'CheckRun' && c.workflowName);
  if (actions.length === 0) refuse('no GitHub Actions check ran on the PR head');
  const notPassed = actions.filter((c) => c.status !== 'COMPLETED' || !PASSED.has(c.conclusion));
  if (notPassed.length) {
    refuse('checks not passed: ' + notPassed.map((c) => `${c.workflowName}/${c.name} ${c.status} ${c.conclusion ?? ''}`.trim()).join(', '));
  }
  for (const c of pr.statusCheckRollup.filter((c) => !actions.includes(c))) {
    console.log(`note: ${c.name ?? c.context} (not a CI workflow) is ${c.conclusion || c.state || c.status}`);
  }

  git('fetch', '--quiet', 'origin', 'main', pr.headRefName, pr.baseRefName);
  const head = git('rev-parse', `origin/${pr.headRefName}`);
  if (head !== pr.headRefOid) refuse(`origin/${pr.headRefName} is ${head}, but the checks ran on ${pr.headRefOid}`);
  const isAncestor = (a, b) => {
    try { git('merge-base', '--is-ancestor', a, b); return true; } catch { return false; }
  };
  if (pr.baseRefName !== 'main' && !isAncestor(`origin/${pr.baseRefName}`, 'origin/main')) {
    refuse(`its base ${pr.baseRefName} is not merged into main yet; merge that PR first`);
  }
  // Main must already be in the PR head, so the merge result is exactly the tree CI tested.
  if (!isAncestor('origin/main', head)) {
    refuse('main has moved since this branch; merge main into the branch, push, and wait for CI');
  }

  const dir = mkdtempSync(join(tmpdir(), `atlas-merge-${pr.number}-`));
  try {
    git('worktree', 'add', '--quiet', '--detach', dir, 'origin/main');
    const inDir = (...args) => run('git', args, { cwd: dir });
    inDir('-c', `user.name=${NAME}`, '-c', `user.email=${EMAIL}`, 'merge', '--no-ff', '--quiet', head,
      '-m', `Merge pull request #${pr.number} from atlas-field-systems/${pr.headRefName}\n\n${pr.title}`);
    if (inDir('rev-parse', 'HEAD^{tree}') !== git('rev-parse', `${head}^{tree}`)) refuse('the merged tree differs from the tested head');
    const who = inDir('log', '-1', '--format=%an <%ae>|%cn <%ce>');
    if (who !== `${NAME} <${EMAIL}>|${NAME} <${EMAIL}>`) refuse(`merge commit identity is ${who}`);
    const mergeSha = inDir('rev-parse', 'HEAD');
    console.log(`merged #${pr.number} locally as ${mergeSha}; tree matches tested head ${head}`);
    if (!push) {
      console.log('not pushed; rerun with --push to push main');
    } else {
      inDir('push', '--quiet', 'origin', 'HEAD:main');
      console.log(`pushed main ${mergeSha}`);
      // A stacked PR shows as merged only once its own base branch contains its head.
      if (pr.baseRefName !== 'main') {
        inDir('push', '--quiet', 'origin', `${head}:refs/heads/${pr.baseRefName}`);
        console.log(`fast-forwarded ${pr.baseRefName} so GitHub marks #${pr.number} merged`);
      }
    }
  } finally {
    try { git('worktree', 'remove', '--force', dir); } catch { rmSync(dir, { recursive: true, force: true }); }
  }
}
