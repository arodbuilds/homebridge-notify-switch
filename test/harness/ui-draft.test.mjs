import assert from 'node:assert/strict';
import { test } from 'node:test';

import { launchOrSkip, openSettings } from './browser.mjs';
import { TWILIO } from './helpers.mjs';

/**
 * Unsaved draft recovery in the built settings UI (SPEC section 11.2, item 23): every change is kept in
 * localStorage under a key carrying the plugin name; on the next load a differing draft younger than a
 * day is offered back; Restore loads it with every field touched, Discard deletes it; a Reset never
 * leaves a draft behind.
 */

const CONFIG = {
  platform: 'NotifySwitch',
  name: 'Notify Switch',
  defaultCountry: 'US',
  providers: [TWILIO],
  groups: [{ id: 'family', name: 'Family', sms: ['+16785550101'], email: [], telegram: [] }],
  switches: [{
    id: '6f1c2a9e-2b1c-4b8f-9d1e-0c5a1e2f3a4b',
    name: 'Water Leak Alert',
    actions: [{ providerId: 'twilio-main', channel: 'sms', groups: ['family'], body: 'Water detected.' }],
  }],
};

const KEY = 'homebridge-notify-switch:draft';

const draft = (page) => page.evaluate((key) => JSON.parse(window.localStorage.getItem(key)), KEY);

/** Reloads the page with the same stubs and waits for it to render. */
async function reload(page) {
  await page.reload();
  await page.evaluate(() => document.body.classList.add('config-ui-x-purple', 'modal-content'));
  await page.waitForSelector('#section-settings .form-control');
}

test('draft recovery: a change is kept under the plugin key, offered back on the next load, restored with fields touched, or discarded', async (t) => {
  const browser = await launchOrSkip(t);
  if (!browser) {
    return;
  }
  try {
    const page = await openSettings(browser, CONFIG);
    // The first push writes a draft equal to the saved configuration; a reload then shows no banner and removes it.
    await page.waitForFunction((key) => window.localStorage.getItem(key) !== null, KEY);
    assert.equal((await draft(page)).config.groups[0].name, 'Family');
    await reload(page);
    assert.equal(await page.locator('.ns-draft-banner').isVisible(), false, 'a draft equal to the saved configuration is not offered');

    // A change is kept as a draft with a timestamp.
    await page.locator('[data-path="groups[0].name"] input').fill('Household');
    await page.waitForFunction((key) => JSON.parse(window.localStorage.getItem(key))?.config.groups[0].name === 'Household', KEY);
    const saved = await draft(page);
    assert.ok(Math.abs(saved.savedAt - Date.now()) < 60000, 'the draft carries the time it was written');
    assert.equal(saved.config.platform, 'NotifySwitch');

    // The next load offers it back, before anything else on the page.
    await reload(page);
    const banner = page.locator('.ns-draft-banner');
    assert.equal(await banner.isVisible(), true);
    assert.equal(await banner.locator('.ns-draft-message').textContent(), 'You have unsaved changes from earlier. Restore them?');
    // Directly under the page banner, before anything else (SPEC section 11.2, items 23 and 28).
    assert.equal(await page.evaluate(() => document.getElementById('app').firstElementChild.classList.contains('ns-banner')), true);
    assert.equal(await page.evaluate(() => document.getElementById('app').children[1].classList.contains('ns-draft-banner')), true);
    assert.equal(await page.locator('[data-path="groups[0].name"] input').inputValue(), 'Family', 'the saved configuration is shown until Restore');
    await banner.getByRole('button', { name: 'Restore' }).click();
    assert.equal(await banner.isVisible(), false);
    assert.equal(await page.locator('[data-path="groups[0].name"] input').inputValue(), 'Household');
    assert.equal(await page.locator('[data-path="groups[0].name"] input').evaluate((node) => node.classList.contains('ns-valid')), true,
      'every restored field counts as touched');
    assert.equal(await page.locator('[data-path="switches[0].name"] input').evaluate((node) => node.classList.contains('ns-valid')), true);
    await page.waitForFunction(() => window.__hb.updates.at(-1)?.[0].groups[0].name === 'Household');

    // Discard deletes the draft and keeps the saved configuration; nothing is written again until the next change.
    await reload(page);
    assert.equal(await banner.isVisible(), true, 'the restored draft still differs from what is saved');
    // The page's first push (of the saved configuration) writes a draft of its own; let it land before Discard.
    await page.waitForFunction((key) => window.__hb.updates.length > 0
      && JSON.parse(window.localStorage.getItem(key))?.config.groups[0].name === 'Family', KEY);
    await banner.getByRole('button', { name: 'Discard' }).click();
    assert.equal(await banner.isVisible(), false);
    assert.equal(await page.locator('[data-path="groups[0].name"] input').inputValue(), 'Family');
    assert.equal(await page.evaluate((key) => window.localStorage.getItem(key), KEY), null, 'Discard deletes the draft');
    await reload(page);
    assert.equal(await banner.isVisible(), false);

    // A draft older than 24 hours is ignored and removed, whatever it holds.
    await page.evaluate(([key, config]) => {
      config.groups[0].name = 'Stale';
      window.localStorage.setItem(key, JSON.stringify({ savedAt: Date.now() - 25 * 60 * 60 * 1000, config }));
    }, [KEY, saved.config]);
    await reload(page);
    assert.equal(await banner.isVisible(), false, 'an old draft is not offered');
    const afterStale = await draft(page);
    assert.ok(afterStale === null || afterStale.config.groups[0].name === 'Family', 'the stale draft is gone');
  } finally {
    await browser.close();
  }
});

test('draft recovery: a Reset confirm clears the draft and does not write a new one until the next change', async (t) => {
  const browser = await launchOrSkip(t);
  if (!browser) {
    return;
  }
  try {
    const page = await openSettings(browser, CONFIG);
    await page.locator('[data-path="groups[0].name"] input').fill('Household');
    await page.waitForFunction((key) => JSON.parse(window.localStorage.getItem(key))?.config.groups[0].name === 'Household', KEY);
    const advanced = page.locator('#section-settings details.ns-advanced');
    await advanced.locator('summary').click();
    await advanced.getByRole('button', { name: 'Reset plugin to fresh install' }).click();
    await page.locator('.ns-modal input[type="text"]').fill('RESET');
    await page.locator('.ns-modal').getByRole('button', { name: 'Confirm' }).click();
    await page.waitForFunction(() => window.__hb.updates.at(-1)?.[0].providers.length === 0);
    assert.equal(await page.evaluate((key) => window.localStorage.getItem(key), KEY), null, 'no draft survives a Reset');
    // A reload offers nothing: the pre-reset changes are gone for good.
    await reload(page);
    assert.equal(await page.locator('.ns-draft-banner').isVisible(), false);
  } finally {
    await browser.close();
  }
});
