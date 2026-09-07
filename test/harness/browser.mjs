import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { chromium } from 'playwright-core';

/**
 * Shared helpers for the headless Chromium tests of the built settings UI (homebridge-ui/public).
 * The page is loaded the way the Homebridge UI loads it (the plugin's own stylesheet first, then the
 * host's Bootstrap appended after it) with a `window.homebridge` stub in place of the injected one.
 *
 * Needs a Chromium or Chrome binary: `NOTIFY_SWITCH_CHROMIUM` (or `CHROMIUM_PATH` / `CHROME_BIN`), one of
 * the usual install locations, or the `chrome` channel. Without one the tests are skipped locally and
 * fail on CI (where Chrome is always present), so the checks cannot silently disappear.
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

export async function launch() {
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

/**
 * Launches the browser, or skips the test (locally) / fails it (on CI) when no browser is available.
 * Returns undefined when skipped.
 */
export async function launchOrSkip(t) {
  try {
    return await launch();
  } catch (err) {
    if (process.env.CI) {
      throw err;
    }
    t.skip(`${err.message}; set NOTIFY_SWITCH_CHROMIUM to run the settings UI browser tests`);
    return undefined;
  }
}

/**
 * Stands in for the `homebridge` object the Homebridge UI injects into the settings iframe.
 * `requestScript` is the source of an `async (path, payload) => result` function that answers server
 * calls; every call is also recorded in `window.__hb.requests`.
 */
export function homebridgeStub(config, requestScript = 'async () => ({ ok: true, message: "stub" })') {
  return `
    window.__hb = { updates: [], save: [], requests: [], toasts: [] };
    window.__hbRequest = ${requestScript};
    window.homebridge = {
      getPluginConfig: async () => [${JSON.stringify(config)}],
      updatePluginConfig: async (blocks) => { window.__hb.updates.push(blocks); },
      savePluginConfig: async () => undefined,
      showSpinner() {}, hideSpinner() {},
      enableSaveButton() { window.__hb.save.push(true); },
      disableSaveButton() { window.__hb.save.push(false); },
      toast: {
        error(m) { window.__hb.toasts.push(['error', m]); }, success(m) { window.__hb.toasts.push(['success', m]); },
        warning(m) { window.__hb.toasts.push(['warning', m]); }, info(m) { window.__hb.toasts.push(['info', m]); },
      },
      request: async (path, payload) => { window.__hb.requests.push({ path, payload }); return window.__hbRequest(path, payload); },
      addEventListener() {},
    };`;
}

export function writePage() {
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

/** Opens the built settings UI with `config` loaded and the stubbed server. Fails the test on any page error. */
export async function openSettings(browser, config, { requestScript, viewport = { width: 900, height: 900 }, onPageError } = {}) {
  const page = await browser.newPage({ viewport });
  page.on('pageerror', (err) => {
    if (onPageError) {
      onPageError(err);
    } else {
      throw new Error(`page error: ${err.message}`);
    }
  });
  await page.addInitScript(homebridgeStub(config, requestScript));
  await page.goto(writePage());
  await page.waitForSelector('#section-settings .form-control');
  return page;
}

/** The most recent configuration block pushed through `updatePluginConfig`, once one exists. */
export async function lastPushed(page) {
  await page.waitForFunction(() => window.__hb.updates.length > 0);
  return page.evaluate(() => window.__hb.updates.at(-1)[0]);
}
