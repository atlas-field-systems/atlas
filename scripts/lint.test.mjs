import assert from 'node:assert/strict';
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
    ['sdk/src/probe.ts', 'performance.now()', 'no-restricted-properties', /injected clock/],
    ['core/src/clock.ts', 'Date.now(); setTimeout(() => {}, 1)'],
    ['sdk/src/clock.ts', 'new Date(); setInterval(() => {}, 1)'],
    ['sdk/src/probe.ts', 'new Date(clock.now()); clock.after(1, fn)'],
    ['asset/test/probe.ts', 'Date.now()'],
    ['asset/test/probe.ts', 'import "node-mavlink"', 'no-restricted-imports', /Asset driver/],
    ['simulations/sitl/probe.ts', 'await import("node-mavlink")', 'atlas/module-boundaries', /simulated equipment/],
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
    ['sdk/src/probe.ts', 'import "@atlas/core/event-kinds"; import "@atlas/protocol/types"'],
    ['asset/src/probe.ts', 'import "@atlas/sdk"; import "@atlas/protocol"'],
    ['simulations/src/probe.ts', 'import "@atlas/core"; import "@atlas/asset"'],
    ['sdk/test/probe.ts', 'export * from "../../core/src/core.ts"', 'atlas/module-boundaries', /package import/],
    ['core/src/api/probe.ts', 'import "../../test/harness.ts"'],
    ['sdk/src/clock.ts', 'try {} catch {}', 'no-restricted-syntax', /diagnostics/],
    ['asset/src/probe.ts', 'promise.catch(() => {})', 'no-restricted-syntax', /diagnostics/],
    ['core/src/probe.ts', 'promise["catch"](() => undefined)', 'no-restricted-syntax', /diagnostics/],
    ['core/src/probe.ts', 'promise.catch(error => { log(error); })'],
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
