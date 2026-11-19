import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const packages = ['protocol', 'core', 'sdk', 'asset', 'simulations'];
const checks = ['docs', ...packages, 'site'];
const [command, part, ...extra] = process.argv.slice(2);

function run(directory, command, args, env = {}) {
  console.log(`\n[${directory}] ${command} ${args.join(' ')}`);
  const result = spawnSync(command, args, {
    cwd: join(root, directory),
    stdio: 'inherit',
    env: { ...process.env, ...env },
  });
  if (result.error) throw new Error(`${command}: ${result.error.message}`);
  if (result.status !== 0)
    throw new Error(`${directory}: ${command} failed (${result.signal ?? result.status}).`);
}
const node = (dir, ...args) => run(dir, process.execPath, args);
const npm = (dir, ...args) => run(dir, 'npm', args);
const types = dir => node(dir, 'node_modules/typescript/bin/tsc', '--noEmit');

function check(part) {
  switch (part) {
    case 'docs':
      node('.', '.github/scripts/check-links.mjs');
      node('.', '.github/scripts/check-retired.mjs');
      break;
    case 'protocol':
      npm(part, 'run', 'check');
      npm(part, 'test');
      npm(part, 'run', 'build:site');
      break;
    case 'core':
    case 'simulations':
      types(part);
      npm(part, 'test');
      break;
    case 'sdk':
      types(part);
      npm(part, 'run', 'check:browser');
      npm(part, 'test');
      break;
    case 'asset':
      run('.', 'systemd-analyze', ['verify', 'asset/atlas-asset.service']);
      types(part);
      npm(part, 'test');
      node(part, 'src/main.ts', 'inspect', 'examples/copter.json');
      break;
    case 'site':
      npm('atlas/site', 'run', 'check');
      npm('atlas/site', 'run', 'build');
      break;
  }
}

try {
  if (process.versions.node.split('.')[0] !== '24')
    throw new Error(`Use Node 24 (found ${process.versions.node}).`);
  if (extra.length || !['setup', 'check', 'sitl', 'demo'].includes(command) ||
      (part && !(command === 'check' ? checks : command === 'setup' ? [...packages, 'site'] : []).includes(part)))
    throw new Error('Usage: npm run setup [-- protocol|core|sdk|asset|simulations|site]; npm run check [-- docs|protocol|core|sdk|asset|simulations|site]; npm run check:sitl; npm run demo');
  switch (command) {
    case 'setup': {
      const selected = part === 'site' ? ['protocol', 'atlas/site']
        : part ? packages.slice(0, packages.indexOf(part) + 1) : [...packages, 'atlas/site'];
      for (const directory of selected) npm(directory, 'ci');
      if (!part || part === 'core' || part === 'simulations') npm('core', 'run', 'build');
      console.log('\nSetup complete. Run npm run demo, or npm run check.');
      break;
    }
    case 'check':
      console.log('Non-SITL checks. Node test summaries report any skips; use npm run check:sitl for ArduPilot.');
      for (const name of part ? [part] : checks) check(name);
      console.log('\nRequested checks passed. Review test summaries for skipped scenarios.');
      break;
    case 'sitl':
      node('.', 'simulations/scripts/fetch-sitl.mjs');
      node('simulations', '--test', 'sitl/flight.test.ts');
      break;
    case 'demo': {
      const runs = join(root, 'simulations/.runs');
      await mkdir(runs, { recursive: true });
      const evidence = await mkdtemp(join(runs, 'demo-'));
      console.log(`Asset reconnect demo: real Core, SDK and Asset app; simulated peripheral, network and time.\nEvidence: ${evidence}`);
      try {
        run('simulations', process.execPath,
          ['--test', '--test-timeout=30000', 'scenarios/asset-rejoin.test.ts'],
          { ATLAS_DEMO_OUTPUT: evidence });
      } finally {
        console.log(`\nDemo output: ${evidence}\nRead summary.md for the result, or the error above if startup failed.`);
      }
      break;
    }
  }
} catch (error) {
  console.error(`\n${error.message}`);
  process.exitCode = 1;
}
