// Every example message is valid against its definition, and each generated doc is current.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { render } from '../scripts/scenarios.mjs';

for (const name of JSON.parse(readFileSync('examples/index.json', 'utf8'))) {
  test(`${name} examples are valid and docs/${name}-messages.md is up to date`, async () => {
    assert.equal(readFileSync(`docs/${name}-messages.md`, 'utf8'), await render(name), 'run npm run scenarios');
  });
}
