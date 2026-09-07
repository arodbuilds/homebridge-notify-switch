import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { test } from 'node:test';

/**
 * Brand assets and packaging (SPEC section 11.2, item 20 and section 13, item 8): the settings UI
 * bundle inlines the mark exactly as shipped in assets/, the SVGs carry no metadata, and the assets
 * directory stays out of the npm tarball.
 */

const ROOT = resolve(import.meta.dirname, '..', '..');
const ASSETS = join(ROOT, 'assets');

const EXPECTED = [
  'notify-switch-192.png', 'notify-switch-512.png', 'notify-switch-banner.png', 'notify-switch-dark.svg',
  'notify-switch-light.svg', 'notify-switch-mark.svg', 'notify-switch-social.png',
];

/** README screenshots (SPEC section 13, item 9). Committed on their own, so they may be absent in a checkout. */
const SCREENSHOTS = ['switch-config.png'];

test('assets: all seven brand files are present, nothing else but the README screenshots, and the SVGs contain only the drawing', () => {
  const files = readdirSync(ASSETS).sort();
  assert.deepEqual(files.filter((name) => !SCREENSHOTS.includes(name)), EXPECTED);
  for (const name of EXPECTED.filter((file) => file.endsWith('.svg'))) {
    const svg = readFileSync(join(ASSETS, name), 'utf8');
    assert.ok(!/<metadata|c2pa/.test(svg), `${name} carries embedded metadata`);
    assert.ok(/^<svg[^>]*viewBox="0 0 192 192"/.test(svg), `${name} starts with the svg element`);
  }
  const mark = readFileSync(join(ASSETS, 'notify-switch-mark.svg'), 'utf8');
  assert.ok(/currentColor/.test(mark) && !/#[0-9A-Fa-f]{3,6}\b/.test(mark), 'the mark uses currentColor and no fixed colour');
});

test('assets: the settings UI bundle inlines notify-switch-mark.svg verbatim', () => {
  const mark = readFileSync(join(ASSETS, 'notify-switch-mark.svg'), 'utf8');
  const bundle = readFileSync(join(ROOT, 'homebridge-ui', 'public', 'index.js'), 'utf8');
  // esbuild stores the text as a template literal (the asset has no backslash or backtick, so it is verbatim) or a JSON string.
  const found = [
    ...[...bundle.matchAll(/`(<svg[^`]*<\/svg>\n?)`/g)].map((match) => match[1]),
    ...[...bundle.matchAll(/"(<svg[^"]*<\/svg>(?:\\n)?)"/g)].map((match) => JSON.parse(`"${match[1]}"`)),
  ];
  assert.ok(found.includes(mark), `the bundle carries the asset as shipped (found ${found.length} svg literals)`);
});

test('packaging: npm pack does not include the assets directory, the source, or the tests', () => {
  const output = execFileSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  const files = JSON.parse(output)[0].files.map((file) => file.path);
  assert.ok(files.length > 0);
  for (const file of files) {
    assert.ok(!/^(assets|src|test|homebridge-ui\/src)\//.test(file), `${file} must not be published`);
  }
  const published = ['dist/index.js', 'homebridge-ui/public/index.js', 'homebridge-ui/public/index.css', 'homebridge-ui/server.js',
    'config.schema.json', 'CHANGELOG.md', 'README.md'];
  for (const expected of published) {
    assert.ok(files.includes(expected), `${expected} is published`);
  }
});
