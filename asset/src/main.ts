import { readConfig, inspectConfig } from './config.ts';
const [command, path] = process.argv.slice(2);
try {
  if (command !== 'inspect' || !path) throw new Error('usage: node src/main.ts inspect <config.json>');
  process.stdout.write(`${JSON.stringify(inspectConfig(await readConfig(path)), null, 2)}\n`);
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : 'configuration failed'}\n`);
  process.exitCode = 1;
}
