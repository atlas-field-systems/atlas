import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';
import { ESLint } from 'eslint';

const lint = new ESLint();

// Charter, Test what matters: protect the check through ESLint's public API.
test('Atlas lint reports violations and honors the file boundaries', async () => {
  const cases = [
    ['core/src/probe.ts', 'Date.now()', 'no-restricted-properties', /injected clock/],
    ['sdk/src/probe.ts', 'new Date()', 'no-restricted-syntax', /injected clock/],
    ['asset/src/probe.ts', 'setTimeout(() => {}, 1)', 'no-restricted-globals', /injected clock/],
    ['core/src/probe.ts', 'globalThis.setInterval(() => {}, 1)', 'no-restricted-globals', /injected clock/],
    ['sdk/src/probe.ts', 'global.setTimeout(() => {}, 1)', 'no-restricted-globals', /injected clock/],
    ['sdk/src/probe.ts', 'performance.now()', 'no-restricted-properties', /injected clock/],
    ['sdk/src/probe.ts', 'process.hrtime.bigint()', 'no-restricted-properties', /injected clock/],
    ['sdk/src/probe.ts', 'process.uptime()', 'no-restricted-properties', /injected clock/],
    ['asset/src/probe.js', "import 'node-mavlink';", 'no-restricted-imports', /node-mavlink/],
    ['protocol/cli/probe.mjs', 'try { run(); } catch {}', 'no-restricted-syntax', /Handle the error/],
    ['protocol/cli/probe.js', 'try { run(); } catch {}', 'no-restricted-syntax', /Handle the error/],
    ['sdk/src/probe.ts', 'globalThis.process.hrtime.bigint()', 'no-restricted-syntax', /injected clock/],
    ['sdk/src/probe.ts', 'import { uptime } from "node:process"', 'no-restricted-syntax', /injected clock/],
    ['sdk/src/probe.ts', 'AbortSignal.timeout(1)', 'no-restricted-syntax', /injected clock/],
    ['core/src/probe.ts', 'Date()', 'no-restricted-syntax', /injected clock/],
    ['sdk/src/probe.ts', 'import * as timers from "node:timers"', 'no-restricted-syntax', /injected clock/],
    ['sdk/src/probe.ts', 'import { scheduler } from "node:timers/promises"', 'no-restricted-syntax', /injected clock/],
    ['sdk/src/probe.ts', 'import "timers"', 'no-restricted-syntax', /injected clock/],
    ['sdk/src/probe.ts', 'export * from "timers"', 'no-restricted-syntax', /injected clock/],
    ['sdk/src/probe.ts', 'export { setImmediate } from "timers"', 'no-restricted-syntax', /injected clock/],
    ['sdk/src/probe.ts', 'import("node:timers")', 'no-restricted-syntax', /injected clock/],
    ['sdk/src/probe.ts', 'import(`node:timers/promises`)', 'no-restricted-syntax', /injected clock/],
    ['sdk/src/probe.ts', 'require("timers")', 'no-restricted-syntax', /injected clock/],
    ['sdk/src/probe.ts', 'import timers = require("node:timers")', 'no-restricted-syntax', /injected clock/],
    ['sdk/src/probe.ts', 'type Timer = import("timers").Timer', 'no-restricted-syntax', /injected clock/],
    ['asset/src/probe.ts', 'scheduler.wait(1)', 'no-restricted-syntax', /injected clock/],
    ['sdk/src/probe.ts', 'const { setTimeout: delay } = globalThis', 'no-restricted-syntax', /injected clock/],
    ['sdk/src/probe.ts', 'const { setTimeout } = global', 'no-restricted-syntax', /injected clock/],
    ['core/src/probe.ts', '({ ["setInterval"]: repeat } = globalThis)', 'no-restricted-syntax', /injected clock/],
    ['core/src/clock.ts', 'Date.now(); setTimeout(() => {}, 1)'],
    ['sdk/src/clock.ts', 'new Date(); setInterval(() => {}, 1)'],
    ['sdk/src/probe.ts', 'new Date(clock.now()); clock.after(1, fn)'],
    ['asset/test/probe.ts', 'Date.now()'],
    ['asset/src/probe.ts', 'import "node-mavlink"', 'no-restricted-imports', /Asset driver/],
    ['asset/test/probe.ts', 'import "node-mavlink"'],
    ['simulations/sitl/probe.ts', 'await import("node-mavlink")'],
    ['asset/src/ardupilot.ts', 'import "node-mavlink"'],
    ['simulations/src/probe.ts', 'import "node-mavlink"'],
    ['core/src/probe.ts', 'import "ajv"', 'no-restricted-imports', /Protocol/],
    ['sdk/src/probe.ts', 'export * from "ajv-formats"', 'no-restricted-imports', /Protocol/],
    ['asset/test/probe.ts', 'import "zod/v4"', 'no-restricted-imports', /Asset runtime/],
    ['protocol/lib/probe.mjs', 'import "ajv"; import "ajv-formats"'],
    ['asset/src/probe.ts', 'import "zod"'],
    ['protocol/lib/probe.mjs', 'import "@atlas/core"', 'no-restricted-imports', /package import/],
    ['core/src/probe.ts', 'import "@atlas/sdk"', 'no-restricted-imports', /package import/],
    ['sdk/src/probe.ts', 'import "@atlas/core"', 'no-restricted-imports', /package import/],
    ['sdk/src/probe.ts', 'type T = import("@atlas/core/private").T', 'atlas/module-boundaries', /package import/],
    ['asset/src/probe.ts', 'import "@atlas/core/event-kinds"', 'no-restricted-imports', /package import/],
    ['sdk/src/probe.ts', 'import "@atlas/core/event-kinds"', 'no-restricted-imports', /package import/],
    ['sdk/src/probe.ts', 'import "@atlas/protocol/event-kinds"; import "@atlas/protocol/types"'],
    ['asset/src/probe.ts', 'import "@atlas/sdk"; import "@atlas/protocol"'],
    ['simulations/src/probe.ts', 'import "@atlas/core"; import "@atlas/asset"'],
    ['sdk/test/probe.ts', 'export * from "../../core/src/core.ts"', 'atlas/module-boundaries', /package import/],
    ['core/src/api/probe.ts', 'import "../../test/harness.ts"'],
    ['sdk/src/clock.ts', 'try {} catch {}', 'no-restricted-syntax', /diagnostics/],
    ['asset/src/probe.ts', 'promise.catch(() => {})', 'no-restricted-syntax', /diagnostics/],
    ['core/src/probe.ts', 'promise["catch"](() => undefined)', 'no-restricted-syntax', /diagnostics/],
    ['sdk/src/probe.ts', 'promise.catch(() => null)', 'no-restricted-syntax', /diagnostics/],
    ['asset/src/probe.ts', 'promise.catch(() => void 0)', 'no-restricted-syntax', /diagnostics/],
    ['sdk/src/probe.ts', 'promise.then(handle, () => {})', 'no-restricted-syntax', /diagnostics/],
    ['asset/src/probe.ts', 'promise["then"](handle, () => false)', 'no-restricted-syntax', /diagnostics/],
    ['sdk/src/probe.ts', 'promise.then(handle, function () { return; })', 'no-restricted-syntax', /diagnostics/],
    ['asset/src/probe.ts', 'promise.catch(() => { return null; })', 'no-restricted-syntax', /diagnostics/],
    ['core/src/probe.ts', 'function f() { try {} catch (error) { return; } }', 'no-restricted-syntax', /diagnostics/],
    ...['null', 'false', 'undefined', '1', '"fallback"'].map(value =>
      ['core/src/probe.ts', `function f() { try {} catch { return ${value}; } }`, 'no-restricted-syntax', /diagnostics/],
    ),
    ['protocol/lib/probe.mjs', 'try {} catch {}', 'no-restricted-syntax', /diagnostics/],
    ['core/src/probe.ts', 'promise.catch(error => { log(error); })'],
    ['sdk/src/probe.ts', 'promise.catch(error => void log(error)); promise.then(() => {}, log)'],
    ['protocol/lib/probe.mjs', 'function f() { try {} catch { return invalid(); } }'],
    ['core/test/probe.ts', 'try {} catch {}'],
    ['simulations/scenarios/probe.ts', 'let value: any', '@typescript-eslint/no-explicit-any', /Unexpected any/],
    ['simulations/scenarios/probe.ts', 'let value: unknown'],
    ['protocol/site/probe.mjs', '// Follow up later. TODO: remove this path.', 'no-warning-comments', /todo/i],
    ['protocol/site/probe.mjs', '// The viewer loads packaged definitions.'],
  ];
  for (const [filePath, code, ruleId, message] of cases) {
    const [result] = await lint.lintText(code, { filePath });
    const context = `${filePath}: ${code}`;
    assert.deepEqual(result.messages.map(item => item.ruleId), ruleId ? [ruleId] : [], context);
    if (ruleId) {
      assert.equal(result.messages[0].severity, 2, context);
      assert.match(result.messages[0].message, message, context);
    }
  }

  const [disabled] = await lint.lintText(
    '/* eslint-disable @typescript-eslint/no-explicit-any */\nlet value: any',
    { filePath: 'core/src/probe.ts' },
  );
  assert.equal(disabled.errorCount, 1);
  assert.equal(disabled.messages.find(item => item.severity === 2)?.ruleId, '@typescript-eslint/no-explicit-any');
  assert.equal(await lint.isPathIgnored('protocol/_site/app.mjs'), true);
  assert.equal(await lint.isPathIgnored('protocol/types.d.ts'), true);
});

test('Atlas lint exits unsuccessfully on warnings [atlas/CHARTER.md#test-what-matters]', async t => {
  const directory = await mkdtemp('core/src/lint-test-');
  t.after(() => rm(directory, { recursive: true, force: true }));
  const file = join(directory, 'probe.ts');
  await writeFile(file, '/* eslint-disable no-warning-comments */\nexport {};\n');

  const result = spawnSync(process.execPath, ['scripts/lint.mjs', file], { encoding: 'utf8' });
  assert.match(result.stdout, /has no effect because you have 'noInlineConfig'/);
  assert.match(result.stdout, /0 errors, 1 warning/);
  assert.equal(result.status, 1);
});
