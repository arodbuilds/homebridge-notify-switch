import assert from 'node:assert/strict';
import { test } from 'node:test';

import { launchOrSkip, openSettings } from './browser.mjs';
import { SMTP, TWILIO } from './helpers.mjs';

/**
 * Unsaved draft recovery in the built settings UI (SPEC section 11.2, item 23): nothing is written until the user
 * changes something; a change is then kept in localStorage under a key carrying the plugin name, without any
 * credential; on the next load a differing draft younger than a day is offered back, and only then; Restore loads
 * it with every field touched and takes the credentials back from the saved configuration; a draft equal to the
 * saved configuration (the host saved it, then closed the page) is deleted on load; Discard deletes it; a Reset
 * never leaves one behind.
 */

const CONFIG = {
  platform: 'NotifySwitch',
  name: 'Notify Switch',
  defaultCountry: 'US',
  defaultProviders: { email: 'fastmail' },
  providers: [TWILIO, SMTP],
  groups: [{ id: 'family', name: 'Family', sms: ['+16785550101'], email: ['a@example.com'], telegram: [] }],
  switches: [{
    id: '6f1c2a9e-2b1c-4b8f-9d1e-0c5a1e2f3a4b',
    name: 'Water Leak Alert',
    actions: [{ providerId: 'twilio-main', channel: 'sms', groups: ['family'], body: 'Water detected.' }],
  }],
};

const KEY = 'homebridge-notify-switch:draft';

/** Every credential the configuration holds; none of them may ever reach storage. */
const SECRETS = [TWILIO.apiKeySecret, SMTP.password];

const storedText = (page) => page.evaluate((key) => window.localStorage.getItem(key), KEY);
const draft = async (page) => JSON.parse(await storedText(page));

/** Reloads the page with the same stubs, as the host does when the settings are opened again, and waits for it to render. */
async function reload(page) {
  await page.reload();
  await page.evaluate(() => document.body.classList.add('config-ui-x-purple', 'modal-content'));
  await page.waitForSelector('#section-settings .form-control');
}

/** Waits for the page's first push (the load) and a little longer than its debounce, so a draft it wrote would be there. */
async function settle(page) {
  await page.waitForFunction(() => window.__hb.updates.length > 0);
  await page.waitForTimeout(400);
}

test('draft recovery: no write before a change; a change is kept without credentials and offered back; Restore refills them; Discard deletes it', async (t) => {
  const browser = await launchOrSkip(t);
  if (!browser) {
    return;
  }
  try {
    const page = await openSettings(browser, CONFIG);
    // Opening the page writes nothing: the load's own pushes are not a change of the user's.
    await settle(page);
    assert.equal(await storedText(page), null, 'no draft before the user changes something');
    // Opening and closing again (the host reloads the page each time) still writes nothing and shows no bar.
    await reload(page);
    await settle(page);
    assert.equal(await storedText(page), null);
    assert.equal(await page.locator('.ns-draft-banner').isVisible(), false, 'no bar without a stored draft');

    // A change is kept as a draft with a timestamp: the structure, never a credential.
    await page.locator('[data-path="groups[0].name"] input').fill('Household');
    await page.waitForFunction((key) => JSON.parse(window.localStorage.getItem(key) ?? 'null')?.config.groups[0].name === 'Household', KEY);
    const saved = await draft(page);
    assert.ok(Math.abs(saved.savedAt - Date.now()) < 60000, 'the draft carries the time it was written');
    assert.equal(saved.config.platform, 'NotifySwitch');
    assert.equal(saved.config.providers[0].apiKeySecret, '', 'the Twilio secret is not stored');
    assert.equal(saved.config.providers[1].password, '', 'the SMTP password is not stored');
    assert.equal(saved.config.credentialsRemoved, undefined, 'the backup marker is not a platform field and is not stored');
    const text = await storedText(page);
    for (const secret of SECRETS) {
      assert.ok(!text.includes(secret), `the stored draft never holds ${secret}`);
    }
    assert.equal(saved.config.providers[0].accountSid, TWILIO.accountSid, 'a non-secret provider field is kept');

    // The next load offers it back, directly under the page banner; the saved configuration is shown until Restore.
    await reload(page);
    const banner = page.locator('.ns-draft-banner');
    assert.equal(await banner.isVisible(), true, 'the bar shows because a stored draft differs from the saved configuration');
    assert.equal(await banner.locator('.ns-draft-message').textContent(), 'You have unsaved changes from earlier. Restore them?');
    assert.equal(await page.evaluate(() => document.getElementById('app').firstElementChild.classList.contains('ns-banner')), true);
    assert.equal(await page.evaluate(() => document.getElementById('app').children[1].classList.contains('ns-draft-banner')), true);
    assert.equal(await page.locator('[data-path="groups[0].name"] input').inputValue(), 'Family', 'the saved configuration is shown until Restore');
    await settle(page);
    assert.equal((await draft(page)).config.groups[0].name, 'Household', 'the load does not overwrite the offered draft');
    await banner.getByRole('button', { name: 'Restore' }).click();
    assert.equal(await banner.isVisible(), false);
    assert.equal(await page.locator('[data-path="groups[0].name"] input').inputValue(), 'Household');
    assert.equal(await page.locator('[data-path="groups[0].name"] input').evaluate((node) => node.classList.contains('ns-valid')), true,
      'every restored field counts as touched');
    assert.equal(await page.locator('[data-path="switches[0].name"] input').evaluate((node) => node.classList.contains('ns-valid')), true);
    // The credentials come back from the saved configuration, so nothing has to be typed again and Save stays possible.
    assert.equal(await page.locator('[data-path="providers[0].apiKeySecret"] input').inputValue(), TWILIO.apiKeySecret);
    assert.equal(await page.locator('[data-path="providers[1].password"] input').inputValue(), SMTP.password);
    assert.equal(await page.locator('.ns-issues').isHidden(), true, 'no issue: the restored configuration is complete');
    await page.waitForFunction(() => window.__hb.updates.at(-1)?.[0].groups[0].name === 'Household');
    const pushed = await page.evaluate(() => window.__hb.updates.at(-1)[0]);
    assert.equal(pushed.providers[0].apiKeySecret, TWILIO.apiKeySecret, 'what the host would save carries the secret');
    assert.equal(pushed.providers[1].password, SMTP.password);
    assert.equal(await page.evaluate(() => window.__hb.save.at(-1)), true, 'Save is enabled');
    assert.equal((await draft(page)).config.providers[0].apiKeySecret, '', 'the draft written after Restore still holds no secret');

    // Discard deletes the draft and keeps the saved configuration; nothing is written again until the next change.
    await reload(page);
    assert.equal(await banner.isVisible(), true, 'the restored draft still differs from what is saved');
    await settle(page);
    await banner.getByRole('button', { name: 'Discard' }).click();
    assert.equal(await banner.isVisible(), false);
    assert.equal(await page.locator('[data-path="groups[0].name"] input').inputValue(), 'Family');
    assert.equal(await storedText(page), null, 'Discard deletes the draft');
    await reload(page);
    await settle(page);
    assert.equal(await banner.isVisible(), false);
    assert.equal(await storedText(page), null, 'and nothing is written on the next load either');

    // A draft older than 24 hours is ignored and removed, whatever it holds.
    await page.evaluate(([key, config]) => {
      config.groups[0].name = 'Stale';
      window.localStorage.setItem(key, JSON.stringify({ savedAt: Date.now() - 25 * 60 * 60 * 1000, config }));
    }, [KEY, saved.config]);
    await reload(page);
    assert.equal(await banner.isVisible(), false, 'an old draft is not offered');
    await settle(page);
    assert.equal(await storedText(page), null, 'the stale draft is gone');

    // A stored draft that somehow holds a secret (the storage edited by hand) is read without it.
    await page.evaluate(([key, config, secret]) => {
      config.groups[0].name = 'Edited';
      config.providers[0].apiKeySecret = secret;
      window.localStorage.setItem(key, JSON.stringify({ savedAt: Date.now(), config }));
    }, [KEY, saved.config, 'typed-into-storage']);
    await reload(page);
    assert.equal(await banner.isVisible(), true);
    await banner.getByRole('button', { name: 'Restore' }).click();
    assert.equal(await page.locator('[data-path="providers[0].apiKeySecret"] input').inputValue(), TWILIO.apiKeySecret,
      'the saved secret is used, never the one from storage');
  } finally {
    await browser.close();
  }
});

test('draft recovery: a Save clears the draft; a provider the draft added comes back without its secret and is listed', async (t) => {
  const browser = await launchOrSkip(t);
  if (!browser) {
    return;
  }
  try {
    const page = await openSettings(browser, CONFIG);
    await page.locator('[data-path="groups[0].name"] input').fill('Household');
    await page.waitForFunction((key) => JSON.parse(window.localStorage.getItem(key) ?? 'null')?.config.groups[0].name === 'Household', KEY);
    // The host's Save button saves the pushed block, then closes the modal; the page is told nothing. On the next open the
    // saved configuration equals the draft, which is therefore deleted before the page renders, and no bar shows.
    await page.waitForFunction(() => window.__hb.updates.at(-1)?.[0].groups[0].name === 'Household');
    const pushed = await page.evaluate(() => window.__hb.updates.at(-1)[0]);
    await page.addInitScript((value) => {
      window.__hbConfig = value;
    }, pushed);
    await reload(page);
    assert.equal(await page.locator('.ns-draft-banner').isVisible(), false, 'no bar after a Save');
    assert.equal(await storedText(page), null, 'the draft is cleared once the same configuration has been saved');
    await settle(page);
    assert.equal(await storedText(page), null);
    assert.equal(await page.locator('[data-path="groups[0].name"] input').inputValue(), 'Household');

    // A provider added in the draft has no saved counterpart: it comes back with its secret empty, touched and listed.
    await page.getByRole('button', { name: 'Add provider' }).click();
    await page.locator('.ns-chooser-tile[data-type="telegram"]').click();
    await page.locator('[data-path="providers[2].botToken"] input').fill('123456789:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA');
    await page.waitForFunction((key) => JSON.parse(window.localStorage.getItem(key) ?? 'null')?.config.providers.length === 3, KEY);
    assert.equal((await draft(page)).config.providers[2].botToken, '', 'the new bot token is not stored');
    await reload(page);
    await page.locator('.ns-draft-banner').getByRole('button', { name: 'Restore' }).click();
    assert.equal(await page.locator('[data-path="providers[2].botToken"] input').inputValue(), '');
    assert.equal(await page.locator('[data-path="providers[0].apiKeySecret"] input').inputValue(), TWILIO.apiKeySecret, 'saved secrets are refilled');
    assert.equal(await page.locator('.ns-issues .ns-issue-link[data-issue-path="providers[2].botToken"]').count(), 1, 'the missing token is listed');
    assert.equal(await page.evaluate(() => window.__hb.save.at(-1)), false, 'Save waits for it');
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
    await page.waitForFunction((key) => JSON.parse(window.localStorage.getItem(key) ?? 'null')?.config.groups[0].name === 'Household', KEY);
    const advanced = page.locator('#section-settings details.ns-advanced');
    await advanced.locator('summary').click();
    await advanced.getByRole('button', { name: 'Reset plugin to fresh install' }).click();
    await page.locator('.ns-modal input[type="text"]').fill('RESET');
    await page.locator('.ns-modal').getByRole('button', { name: 'Confirm' }).click();
    await page.waitForFunction(() => window.__hb.updates.at(-1)?.[0].providers.length === 0);
    await page.waitForTimeout(400);
    assert.equal(await storedText(page), null, 'no draft survives a Reset');
    // A reload offers nothing: the pre-reset changes are gone for good.
    await reload(page);
    assert.equal(await page.locator('.ns-draft-banner').isVisible(), false);
    // The next change after a Reset is kept again.
    await page.locator('[data-path="groups[0].name"] input').fill('Neighbours');
    await page.waitForFunction((key) => JSON.parse(window.localStorage.getItem(key) ?? 'null')?.config.groups[0].name === 'Neighbours', KEY);
  } finally {
    await browser.close();
  }
});
