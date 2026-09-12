import { copyFileSync, existsSync, mkdtempSync, writeFileSync } from 'node:fs';
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

/**
 * The rules from the Homebridge UI's own stylesheet (homebridge-config-ui-x 5.29, `styles-*.css`) that
 * paint the plugin settings iframe. The host posts its body classes into the iframe: `config-ui-x-{theme}`
 * or `config-ui-x-dark-mode-{theme}`, `modal-content`, and `dark-mode` when dark. It never sets Bootstrap's
 * `data-bs-theme` there, so Bootstrap's variables keep their light values in dark mode; the theme colours
 * the body, cards, alerts, links and primary buttons with these rules instead. Kept verbatim so a colour
 * that is unreadable in the real UI is unreadable here too.
 */
const HOST_THEME_CSS = `
.modal-content{border-radius:.7rem!important;border:none;line-height:1.5rem;font-size:.9rem;font-weight:300}
.config-ui-x-purple.modal-content{background-color:#fff!important;color:#000!important}
.config-ui-x-purple .alert{color:#000;background-color:#eee;border-color:#ccc}
.config-ui-x-purple .btn-primary,.config-ui-x-purple .btn-default{background-color:#9c27b0!important;border-color:#9c27b0!important}
.config-ui-x-purple .form-control::placeholder{color:#cdcdcd!important;opacity:1!important}
.config-ui-x-dark-mode-purple{background-color:#000}
.config-ui-x-dark-mode-purple.modal-content{background-color:#242424!important;color:#fff!important}
.config-ui-x-dark-mode-purple .card{color:#fff;background-color:#2b2b2b!important}
.config-ui-x-dark-mode-purple .alert{color:#eee;background-color:#2b2b2b;box-shadow:0 0 1px #444;border:none}
.config-ui-x-dark-mode-purple .alert a{color:#9c27b0}
.config-ui-x-dark-mode-purple a{color:#9c27b0}
.config-ui-x-dark-mode-purple .btn-link{color:#9e9e9e!important}
.config-ui-x-dark-mode-purple .btn-primary,.config-ui-x-dark-mode-purple .btn-default{background-color:#9c27b0!important;border-color:#9c27b0!important}
.config-ui-x-dark-mode-purple .form-control::placeholder{color:#636363!important;opacity:1!important}
`;

/** The body classes the Homebridge UI posts into the iframe for its purple theme in light and dark mode. */
export const HOST_BODY_CLASSES = {
  light: ['config-ui-x-purple', 'modal-content'],
  dark: ['config-ui-x-dark-mode-purple', 'modal-content', 'dark-mode'],
};

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
 * calls; every call is also recorded in `window.__hb.requests`. The configuration and any fixture the
 * request function reads are handed to the page as init-script arguments (`window.__hbConfig`,
 * `window.__fixture`), never interpolated into source.
 */
export function homebridgeStub(requestScript = 'async () => ({ ok: true, message: "stub" })') {
  return `
    window.__hb = { updates: [], save: [], requests: [], toasts: [] };
    window.__hbRequest = ${requestScript};
    window.homebridge = {
      getPluginConfig: async () => [window.__hbConfig],
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
  // The banner sits beside index.html in the plugin's public folder and the page references it by a relative path
  // (SPEC section 11.2, item 28); the copy makes the temporary page load it the same way.
  copyFileSync(join(PUBLIC, 'notify-switch-banner.png'), join(dir, 'notify-switch-banner.png'));
  // Same order as the Homebridge UI: the plugin's index.html links its own stylesheet, then the host appends its own.
  writeFileSync(file, `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Notify Switch settings</title>
    <link rel="stylesheet" href="${pathToFileURL(join(PUBLIC, 'index.css')).href}">
    <link rel="stylesheet" href="${pathToFileURL(BOOTSTRAP).href}">
    <style>${HOST_THEME_CSS}</style>
  </head>
  <body>
    <div id="app" class="notify-switch-ui"></div>
    <script src="${pathToFileURL(join(PUBLIC, 'index.js')).href}"></script>
  </body>
</html>`);
  return pathToFileURL(file).href;
}

/**
 * Opens the built settings UI with `config` loaded and the stubbed server. Fails the test on any page error.
 * `hasTouch` emulates a touch device; `dark` renders the page in dark mode the way the Homebridge UI does
 * (its dark body classes, see HOST_BODY_CLASSES, and no `data-bs-theme` on the root); `locale` sets the
 * browser language (`navigator.language`); `initScript` runs before the page; `fixture` is any value the
 * request function may read as `window.__fixture` (passed as data, not built into its source).
 */
export async function openSettings(browser, config, {
  requestScript, viewport = { width: 900, height: 900 }, onPageError, hasTouch = false, dark = false, locale, initScript, fixture,
} = {}) {
  const page = await browser.newPage({ viewport, hasTouch, colorScheme: dark ? 'dark' : 'light', ...(locale ? { locale } : {}) });
  page.on('pageerror', (err) => {
    if (onPageError) {
      onPageError(err);
    } else {
      throw new Error(`page error: ${err.message}`);
    }
  });
  // Data first (the configuration, the fixture), each as an argument the page receives as a value; then the stub.
  await page.addInitScript((value) => {
    window.__hbConfig = value;
  }, config);
  if (fixture !== undefined) {
    await page.addInitScript((value) => {
      window.__fixture = value;
    }, fixture);
  }
  await page.addInitScript(homebridgeStub(requestScript));
  if (initScript) {
    await page.addInitScript(initScript);
  }
  await page.goto(writePage());
  // The host posts its body classes after the page has loaded, so they follow the load here too. Transitions
  // are turned off so a colour read right after the switch is the final colour, not a frame in between.
  await page.evaluate((classes) => {
    const style = document.createElement('style');
    style.textContent = '* { transition: none !important; }';
    document.head.appendChild(style);
    document.body.classList.add(...classes);
  }, dark ? HOST_BODY_CLASSES.dark : HOST_BODY_CLASSES.light);
  await page.waitForSelector('#section-settings .form-control');
  return page;
}

/** The most recent configuration block pushed through `updatePluginConfig`, once one exists. */
export async function lastPushed(page) {
  await page.waitForFunction(() => window.__hb.updates.length > 0);
  return page.evaluate(() => window.__hb.updates.at(-1)[0]);
}
