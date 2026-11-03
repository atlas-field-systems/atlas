// Every example message is valid against its definition, and the generated doc is current.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { render } from '../scripts/scenarios.mjs';

test('first-flight examples are valid and docs/first-flight-messages.md is up to date', async () => {
  const text = await render('first-flight');
  assert.equal(readFileSync('docs/first-flight-messages.md', 'utf8'), text, 'run npm run scenarios');
});
