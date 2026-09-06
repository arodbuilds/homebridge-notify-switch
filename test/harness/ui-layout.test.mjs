import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';

import { chromium } from 'playwright-core';

import { SMTP, TELEGRAM, TWILIO } from './helpers.mjs';

/**
 * Headless Chromium smoke test for the built settings UI (homebridge-ui/public). The page is loaded
 * the way the Homebridge UI loads it (the plugin's own stylesheet first, then the host's Bootstrap
 * appended after it, and a `window.homebridge` stub in place of the injected one) and checked for:
 *   - no rendered element starting left of the viewport or ending past it, at 400px and 900px;
 *   - no horizontal page scroll;
 *   - the two-column grids stacking to one column below 600px;
 *   - the uncovered channel warning with its copy and "Add … action" button, with Save left enabled.
 *
 * Needs a Chromium or Chrome binary: `NOTIFY_SWITCH_CHROMIUM` (or `CHROMIUM_PATH` / `CHROME_BIN`), one of
 * the usual install locations, or the `chrome` channel. Without one the test is skipped locally and
 * fails on CI (where Chrome is always present), so the check cannot silently disappear.
 */

const require = createRequire(import.meta.url);
const ROOT = resolve(import.meta.dirname, '..', '..');
const PUBLIC = join(ROOT, 'homebridge-ui', 'public');
const BOOTSTRAP = require.resolve('bootstrap/dist/css/bootstrap.min.css');

const CANDIDATES = [
  process.env.NOTIFY_SWITCH_CHROMIUM,
  process.env.CHROMIUM_PATH,
  process.env.CHROME_BIN,
  '/opt/pw-browsers/chromium',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
].filter((candidate) => typeof candidate === 'string' && candidate.length > 0);

async function launch() {
  const executablePath = CANDIDATES.find((candidate) => existsSync(candidate));
  const attempts = executablePath ? [{ executablePath }] : [{ channel: 'chrome' }, { channel: 'chromium' }];
  let lastError;
  for (const attempt of attempts) {
    try {
      return await chromium.launch({ ...attempt, headless: true, chromiumSandbox: false });
    } catch (err) {
      lastError = err;
    }
  }
  throw new Error(`no Chromium available (${lastError instanceof Error ? lastError.message.split('\n')[0] : String(lastError)})`);
}

/** A valid configuration whose only switch leaves the family group's Telegram chat uncovered. */
const CONFIG = {
  platform: 'NotifySwitch',
  name: 'Notify Switch',
  defaultCountry: 'US',
  masterSwitch: { enabled: true, name: 'Notifications Enabled' },
  providers: [TWILIO, { ...SMTP, credentialsFile: 'smtp.json' }, TELEGRAM],
  groups: [{ id: 'family', name: 'Family', sms: ['+16785550101', '+16785550102'], email: ['a@example.com'], telegram: ['123456789'] }],
  switches: [{
    id: '6f1c2a9e-2b1c-4b8f-9d1e-0c5a1e2f3a4b',
    name: 'Water Leak Alert',
    failureSensor: true,
    actions: [
      { providerId: 'twilio-main', channel: 'sms', groups: ['family'], recipients: ['+16785550103'], body: 'Water detected at {{time}}.' },
      { providerId: 'fastmail', channel: 'email', groups: ['family'], subject: 'Leak', body: 'Water detected under the kitchen sink at {{time}} on {{date}}.' },
    ],
  }],
};

/** Stands in for the `homebridge` object the Homebridge UI injects into the settings iframe. */
function homebridgeStub(config) {
  return `
    window.__hb = { updates: [], save: [] };
    window.homebridge = {
      getPluginConfig: async () => [${JSON.stringify(config)}],
      updatePluginConfig: async (blocks) => { window.__hb.updates.push(blocks); },
      savePluginConfig: async () => undefined,
      showSpinner() {}, hideSpinner() {},
      enableSaveButton() { window.__hb.save.push(true); },
      disableSaveButton() { window.__hb.save.push(false); },
      toast: { error() {}, success() {}, warning() {}, info() {} },
      request: async () => ({ ok: true, message: 'stub' }),
      addEventListener() {},
    };`;
}

function writePage() {
  const dir = mkdtempSync(join(tmpdir(), 'notify-switch-ui-'));
  const file = join(dir, 'index.html');
  // Same order as the Homebridge UI: the plugin's index.html links its own stylesheet, then the host appends its own.
  writeFileSync(file, `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Notify Switch settings</title>
    <link rel="stylesheet" href="${pathToFileURL(join(PUBLIC, 'index.css')).href}">
    <link rel="stylesheet" href="${pathToFileURL(BOOTSTRAP).href}">
  </head>
  <body>
    <div id="app" class="notify-switch-ui"></div>
    <script src="${pathToFileURL(join(PUBLIC, 'index.js')).href}"></script>
  </body>
</html>`);
  return pathToFileURL(file).href;
}

/** Every rendered element whose box starts left of the viewport or ends past it, plus the page's scroll width. */
async function audit(page) {
  return page.evaluate(() => {
    const width = window.innerWidth;
    const skip = new Set(['SCRIPT', 'STYLE', 'LINK', 'OPTION', 'OPTGROUP']);
    const offenders = [];
    for (const node of document.querySelectorAll('body *')) {
      if (skip.has(node.tagName)) {
        continue;
      }
      const rect = node.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) {
        continue;
      }
      if (rect.left < 0 || rect.right > width + 0.5) {
        offenders.push(`<${node.tagName.toLowerCase()} class="${node.className}"> left=${rect.left.toFixed(1)} right=${rect.right.toFixed(1)}`);
      }
    }
    return { width, scrollWidth: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth), offenders };
  });
}

/** For each grid with two or more visible children, the distinct left edges of those children. */
async function gridColumns(page) {
  return page.evaluate(() => [...document.querySelectorAll('.ns-grid')].map((grid) => {
    const children = [...grid.children].filter((child) => child.getBoundingClientRect().height > 0);
    const lefts = [...new Set(children.map((child) => Math.round(child.getBoundingClientRect().left)))];
    const widths = children.map((child) => Math.round(child.getBoundingClientRect().width));
    return { children: children.length, lefts, widths, gridWidth: Math.round(grid.getBoundingClientRect().width) };
  }).filter((grid) => grid.children >= 2));
}

test('settings UI layout: nothing is clipped at the left edge or overflows the iframe, and grids stack on a phone', async (t) => {
  let browser;
  try {
    browser = await launch();
  } catch (err) {
    if (process.env.CI) {
      throw err;
    }
    t.skip(`${err.message}; set NOTIFY_SWITCH_CHROMIUM to run the layout smoke test`);
    return;
  }
  try {
    const url = writePage();
    const page = await browser.newPage({ viewport: { width: 900, height: 900 } });
    page.on('pageerror', (err) => assert.fail(`page error: ${err.message}`));
    await page.addInitScript(homebridgeStub(CONFIG));
    await page.goto(url);
    await page.waitForSelector('.card');
    assert.equal(await page.locator('.alert-danger').count(), 0, 'the configuration loaded');

    // Every section heading and label starts inside the page, with the container's 16px padding on both sides.
    const paddings = await page.evaluate(() => {
      const style = getComputedStyle(document.getElementById('app'));
      return [style.paddingLeft, style.paddingRight];
    });
    assert.deepEqual(paddings, ['16px', '16px']);

    for (const width of [900, 599, 400]) {
      await page.setViewportSize({ width, height: 900 });
      const result = await audit(page);
      assert.deepEqual(result.offenders, [], `elements outside the ${width}px viewport`);
      assert.ok(result.scrollWidth <= width, `no horizontal scroll at ${width}px (scrollWidth ${result.scrollWidth})`);
      const heading = await page.locator('h2').first().boundingBox();
      assert.ok(heading && heading.x >= 16, `section headings start at or after the padding at ${width}px (x=${heading?.x})`);

      const grids = await gridColumns(page);
      assert.ok(grids.length >= 3, 'the page has two-column grids to check');
      for (const grid of grids) {
        if (width < 600) {
          assert.equal(grid.lefts.length, 1, `grid stacks to one column at ${width}px: lefts ${grid.lefts.join(', ')}`);
          assert.ok(grid.widths.every((w) => Math.abs(w - grid.gridWidth) <= 1), `each stacked field spans the grid at ${width}px`);
        } else {
          assert.ok(grid.lefts.length >= 2, `grid shows columns side by side at ${width}px: lefts ${grid.lefts.join(', ')}`);
        }
      }
    }

    // Uncovered channel warning (SPEC section 11.3): the family group has a Telegram chat but the switch has no Telegram action.
    const warning = page.locator('.coverage-warning');
    assert.equal(await warning.count(), 1);
    assert.equal(await warning.locator('.coverage-warning-text').textContent(),
      'This switch sends to a group with Telegram chat IDs, but it has no Telegram action. Those recipients will not receive anything.');
    const addButton = warning.getByRole('button', { name: 'Add Telegram action' });
    assert.equal(await addButton.count(), 1);
    assert.equal(await page.locator('.issues').isHidden(), true, 'a coverage warning is not a validation issue');
    assert.deepEqual(await page.evaluate(() => window.__hb.save.at(-1)), true, 'Save stays enabled');

    // The button appends a Telegram action on the first provider that serves Telegram, with the same group selected.
    await addButton.click();
    assert.equal(await page.locator('.action-card').count(), 3);
    const added = page.locator('.action-card').nth(2);
    assert.equal(await added.locator('select').nth(0).inputValue(), 'telegram-home');
    assert.equal(await added.locator('select').nth(1).inputValue(), 'telegram');
    assert.equal(await added.locator('input[type="checkbox"]').isChecked(), true, 'the family group is selected');
    assert.equal(await page.locator('.coverage-warning').count(), 0, 'the warning clears once the channel is covered');
    // Config pushes are debounced; wait for the one that carries the new action.
    await page.waitForFunction(() => window.__hb.updates.at(-1)?.[0].switches[0].actions.length === 3);
    const pushed = await page.evaluate(() => window.__hb.updates.at(-1)[0].switches[0].actions[2]);
    assert.deepEqual(pushed, { providerId: 'telegram-home', channel: 'telegram', groups: ['family'], recipients: [], body: '' });
    assert.deepEqual(await page.evaluate(() => window.__hb.save.at(-1)), false, 'the empty message is a validation issue until filled in');

    // Test send confirmation: Send now is the primary button, Cancel neutral; red is reserved for Remove.
    await page.getByRole('button', { name: 'Test send' }).click();
    const sendNow = page.getByRole('button', { name: 'Send now' });
    assert.match(await sendNow.getAttribute('class'), /\bbtn-primary\b/);
    assert.match(await page.getByRole('button', { name: 'Cancel' }).getAttribute('class'), /\bbtn-outline-secondary\b/);
    const redButtons = await page.evaluate(() => [...document.querySelectorAll('button')]
      .filter((node) => /\bbtn-(outline-)?danger\b/.test(node.className))
      .map((node) => node.textContent.trim()));
    assert.ok(redButtons.length > 0);
    assert.ok(redButtons.every((label) => /^Remove/.test(label)), `only Remove buttons are red: ${redButtons.join(', ')}`);

    // With validation issues showing, the sticky issues box is inside the viewport too.
    await page.setViewportSize({ width: 400, height: 700 });
    assert.equal(await page.locator('.issues').isVisible(), true);
    const withIssues = await audit(page);
    assert.deepEqual(withIssues.offenders, []);
    assert.ok(withIssues.scrollWidth <= 400);
  } finally {
    await browser.close();
  }
});
