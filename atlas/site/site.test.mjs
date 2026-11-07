import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';

const site = dirname(fileURLToPath(import.meta.url));
const branchScript = readFileSync(join(site, 'branch.js'), 'utf8');

test('built pages retain local links, unique heading anchors, and preview metadata', (t) => {
  const temp = mkdtempSync(join(tmpdir(), 'atlas-charter-site-'));
  t.after(() => rmSync(temp, { recursive: true, force: true }));
  const fixtureSite = join(temp, 'site');
  const out = join(temp, '_site');
  mkdirSync(fixtureSite);
  for (const file of readdirSync(join(site, '..')).filter((name) => name.endsWith('.md'))) {
    cpSync(join(site, '..', file), join(temp, file));
  }
  for (const file of ['style.css', 'branch.js']) cpSync(join(site, file), join(fixtureSite, file));
  symlinkSync(join(site, 'node_modules'), join(fixtureSite, 'node_modules'), 'dir');
  writeFileSync(join(temp, 'headings.md'), '# Repeated headings\n\n## Repeat\n\n## Repeat\n\n## Repeat-1\n\n## Repeat\n\n## [Linked](README.md) `code`\n\n[Repeated](#repeat-1)\n');
  writeFileSync(join(temp, 'another.md'), '# Repeat\n');
  const env = { ...process.env, SITE_OUT: out };
  delete env.SITE_PULL_REQUESTS;
  const build = () => execFileSync(process.execPath, [join(site, 'build.mjs')], { cwd: fixtureSite, env });
  build();
  assert.deepEqual(JSON.parse(readFileSync(join(out, 'pull-requests.json'), 'utf8')), []);

  let fragments = 0;
  for (const file of readdirSync(out).filter((name) => name.endsWith('.html'))) {
    const html = readFileSync(join(out, file), 'utf8');
    for (const [, href] of html.matchAll(/href="([^"]+)"/g)) {
      const url = new URL(href, `https://charter.test/${file}`);
      if (url.origin !== 'https://charter.test') continue;
      const target = join(out, decodeURIComponent(url.pathname.slice(1)));
      assert.ok(existsSync(target), `${file} links to missing file ${href}`);
      if (url.hash) {
        fragments++;
        const ids = [...readFileSync(target, 'utf8').matchAll(/\bid="([^"]*)"/g)].map((match) => match[1]);
        assert.ok(ids.includes(decodeURIComponent(url.hash.slice(1))), `${file} links to missing anchor ${href}`);
      }
    }
  }
  assert.ok(fragments >= 8, 'checks the existing seven fragment links and the repeated-heading fixture');
  const headings = readFileSync(join(out, 'headings.html'), 'utf8');
  assert.deepEqual([...headings.matchAll(/<h\d id="([^"]*)"/g)].map((match) => match[1]),
    ['repeated-headings', 'repeat', 'repeat-1', 'repeat-1-1', 'repeat-2', 'linked-code']);
  assert.match(readFileSync(join(out, 'another.html'), 'utf8'), /<h1 id="repeat">/);
  assert.ok(existsSync(join(out, 'mermaid.esm.min.mjs')));

  const prs = [{ number: 12, title: 'Preview title' }];
  env.SITE_PULL_REQUESTS = join(temp, 'preview-input.json');
  writeFileSync(env.SITE_PULL_REQUESTS, JSON.stringify(prs));
  build();
  assert.deepEqual(JSON.parse(readFileSync(join(out, 'pull-requests.json'), 'utf8')), prs);
  assert.equal(readFileSync(join(out, 'headings.html'), 'utf8'), headings);
});

async function banner(pathname, metadata) {
  const requests = [];
  const banners = [];
  await runInNewContext(branchScript, {
    location: { pathname },
    fetch: async (href) => {
      requests.push(href);
      if (metadata instanceof Error) throw metadata;
      return { json: async () => metadata };
    },
    document: { createElement: () => ({}), body: { prepend: (element) => banners.push(element) } },
  });
  assert.deepEqual(requests, ['pull-requests.json']);
  return banners[0];
}

test('main banner uses only the local snapshot and escapes PR titles', async () => {
  const result = await banner('/atlas/settings.html', [{ number: 12, title: 'Fresh & <safe>' }]);
  assert.equal(result.className, 'branch main');
  assert.match(result.innerHTML, /Showing main\. Versions: <b>main<\/b>/);
  assert.match(result.innerHTML, /href="\/atlas\/pr\/pr-12\/"/);
  assert.match(result.innerHTML, /#12 Fresh &#38; &#60;safe&#62;/);
});

test('preview banner retains its identity, main link, and other preview links', async () => {
  const result = await banner('/atlas/pr/pr-12/settings.html', [
    { number: 12, title: 'Current' }, { number: 13, title: 'Other' },
  ]);
  assert.equal(result.className, 'branch');
  assert.match(result.innerHTML, /https:\/\/github.com\/atlas-field-systems\/atlas\/pull\/12/);
  assert.match(result.innerHTML, /href="\/atlas\/">main<\/a>/);
  assert.match(result.innerHTML, /<b>#12 Current<\/b>/);
  assert.match(result.innerHTML, /href="\/atlas\/pr\/pr-13\/"/);
});

test('empty, missing, or invalid metadata preserves offline preview identity', async () => {
  for (const metadata of [[], new Error('missing snapshot'), {}, [null, { number: '12', title: 'Bad' }]]) {
    assert.equal(await banner('/atlas/index.html', metadata), undefined);
    const result = await banner('/atlas/pr/pr-12/index.html', metadata);
    assert.match(result.innerHTML, /Preview of pull request/);
    assert.match(result.innerHTML, /href="\/atlas\/">main<\/a>/);
  }
});
