import { ESLint } from 'eslint';
import { lintHelp } from '../eslint.config.mjs';

const lint = new ESLint();
const results = await lint.lintFiles(process.argv.slice(2));
for (const result of results)
  for (const problem of result.messages)
    if (Object.hasOwn(lintHelp, problem.ruleId))
      problem.message += ` ${lintHelp[problem.ruleId]}`;

const formatter = await lint.loadFormatter('stylish');
process.stdout.write(await formatter.format(results));
if (results.some(result => result.errorCount)) process.exitCode = 1;
