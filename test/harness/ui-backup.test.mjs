import assert from 'node:assert/strict';
import { test } from 'node:test';

import { launchOrSkip, openSettings } from './browser.mjs';
import { SMTP, TELEGRAM, TWILIO } from './helpers.mjs';

/**
 * Settings > Advanced in the built settings UI (SPEC section 11.2, item 12): Download backup, Restore
 * from backup with validation before anything changes, and Reset plugin to fresh install behind a
 * typed confirmation.
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

const BACKUP = {
  platform: 'NotifySwitch',
  name: 'Restored',
  configVersion: 1,
  defaultCountry: 'GB',
  providers: [SMTP, TELEGRAM],
  groups: [{ id: 'friends', name: 'Friends', sms: [], email: ['f@example.com'], telegram: [] }],
  switches: [{
    id: '0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d',
    name: 'Smoke Alarm',
    actions: [{ providerId: 'fastmail', channel: 'email', groups: ['friends'], body: 'Smoke detected.' }],
  }],
};

function file(name, content) {
  return { name, mimeType: 'application/json', buffer: Buffer.from(typeof content === 'string' ? content : JSON.stringify(content)) };
}

const ADVANCED = '#section-settings details.ns-advanced';

test('settings advanced: Download backup writes the current configuration as notify-switch-backup-YYYY-MM-DD.json', async (t) => {
  const browser = await launchOrSkip(t);
  if (!browser) {
    return;
  }
  try {
    const page = await openSettings(browser, CONFIG);
    const advanced = page.locator(ADVANCED);
    assert.equal(await advanced.evaluate((node) => node.open), false, 'collapsed by default');
    await advanced.locator('summary').click();
    assert.equal(await advanced.locator('.backup-note').textContent(), 'The backup file contains your provider credentials. Store it like a password.');
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      advanced.getByRole('button', { name: 'Download backup' }).click(),
    ]);
    assert.match(download.suggestedFilename(), /^notify-switch-backup-\d{4}-\d{2}-\d{2}\.json$/);
    const path = await download.path();
    const { readFileSync } = await import('node:fs');
    const saved = JSON.parse(readFileSync(path, 'utf8'));
    assert.equal(saved.platform, 'NotifySwitch');
    assert.equal(saved.providers[0].apiKeySecret, TWILIO.apiKeySecret, 'the backup carries the credentials');
    assert.equal(saved.switches[0].name, 'Water Leak Alert');
  } finally {
    await browser.close();
  }
});

test('settings advanced: Restore from backup validates first and replaces the form on success', async (t) => {
  const browser = await launchOrSkip(t);
  if (!browser) {
    return;
  }
  try {
    const page = await openSettings(browser, CONFIG);
    const advanced = page.locator(ADVANCED);
    await advanced.locator('summary').click();
    const picker = advanced.locator('input[type="file"]');

    // Not JSON.
    await picker.setInputFiles(file('broken.json', '{ not json'));
    await page.waitForSelector(`${ADVANCED} .restore-status .alert-danger`);
    assert.match(await advanced.locator('.restore-status').textContent(), /The backup could not be loaded:.*Not valid JSON/);

    // JSON, but not a Notify Switch backup.
    await picker.setInputFiles(file('other.json', { platform: 'SomethingElse' }));
    await page.waitForFunction(() => /"platform" must be "NotifySwitch"/.test(document.querySelector('.restore-status')?.textContent ?? ''));

    // A backup that fails the configuration rules: nothing changes.
    await picker.setInputFiles(file('invalid.json', { ...BACKUP, providers: [{ ...SMTP, host: '' }] }));
    await page.waitForFunction(() => /Host is required/.test(document.querySelector('.restore-status')?.textContent ?? ''));
    assert.equal(await page.locator('.card[data-path="providers[0]"] .card-header').textContent(), 'Twiliotwilio', 'the form is untouched');

    // A valid backup replaces the form state and enables Save.
    await picker.setInputFiles(file('good.json', BACKUP));
    await page.waitForSelector('.card[data-path="providers[1]"]');
    assert.equal(await page.locator(`${ADVANCED} .restore-status .alert-danger`).count(), 0);
    assert.deepEqual(await page.locator('.card[data-path^="providers"] .card-header').allTextContents(), ['Fastmailsmtp', 'Telegramtelegram']);
    assert.equal(await page.locator('[data-path="name"] input').inputValue(), 'Restored');
    assert.equal(await page.locator('[data-path="defaultCountry"] select').inputValue(), 'GB');
    await page.waitForFunction(() => window.__hb.updates.at(-1)?.[0].name === 'Restored');
    const pushed = await page.evaluate(() => window.__hb.updates.at(-1)[0]);
    assert.equal(pushed.switches[0].name, 'Smoke Alarm');
    assert.equal(pushed.providers[0].password, SMTP.password);
    assert.equal(await page.evaluate(() => window.__hb.save.at(-1)), true, 'Save is enabled');
    assert.deepEqual(await page.evaluate(() => window.__hb.toasts.at(-1)), ['success', 'Backup loaded. Review the form, then click Save.']);

    // A whole config.json with a NotifySwitch platform block is accepted too.
    const whole = { bridge: { name: 'Homebridge' }, platforms: [{ platform: 'config' }, { ...BACKUP, name: 'From config' }] };
    await picker.setInputFiles(file('config.json', whole));
    await page.waitForFunction(() => window.__hb.updates.at(-1)?.[0].name === 'From config');
  } finally {
    await browser.close();
  }
});

test('settings advanced: Reset plugin to fresh install needs RESET typed, then leaves the empty default configuration with Save enabled', async (t) => {
  const browser = await launchOrSkip(t);
  if (!browser) {
    return;
  }
  try {
    const page = await openSettings(browser, CONFIG);
    const advanced = page.locator(ADVANCED);
    await advanced.locator('summary').click();
    const reset = advanced.getByRole('button', { name: 'Reset plugin to fresh install' });
    assert.match(await reset.getAttribute('class'), /\btext-danger\b/, 'a red text button');
    await reset.click();
    const modal = page.locator('.ns-modal');
    assert.equal(await modal.count(), 1);
    assert.deepEqual(await modal.locator('li').allTextContents(), [
      'All providers, groups, switches, and settings are removed.',
      'Switches disappear from the Home app after the next restart.',
      'Credentials files on disk are not touched.',
    ]);
    assert.equal(await modal.getByRole('button', { name: 'Download backup first' }).count(), 1);
    const confirm = modal.getByRole('button', { name: 'Confirm' });
    assert.match(await confirm.getAttribute('class'), /\bbtn-danger\b/);
    assert.equal(await confirm.isEnabled(), false);
    const field = modal.locator('input[type="text"]');
    await field.fill('reset');
    assert.equal(await confirm.isEnabled(), false, 'the word must match exactly');
    await field.fill('RESET');
    assert.equal(await confirm.isEnabled(), true);

    // Escape cancels without changing anything.
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('.ns-modal').count(), 0);
    assert.equal(await page.locator('.card[data-path="providers[0]"]').count(), 1);

    await reset.click();
    await page.locator('.ns-modal input[type="text"]').fill('RESET');
    await page.locator('.ns-modal').getByRole('button', { name: 'Confirm' }).click();
    assert.equal(await page.locator('.ns-modal').count(), 0);
    assert.equal(await page.locator('.card').count(), 0, 'no provider, group or switch cards remain');
    await page.waitForFunction(() => window.__hb.updates.at(-1)?.[0].providers.length === 0);
    const pushed = await page.evaluate(() => window.__hb.updates.at(-1)[0]);
    assert.equal(pushed.platform, 'NotifySwitch');
    assert.equal(pushed.name, 'Notify Switch');
    assert.equal(pushed.configVersion, 1);
    assert.deepEqual([pushed.providers, pushed.groups, pushed.switches], [[], [], []]);
    assert.equal(await page.evaluate(() => window.__hb.save.at(-1)), true, 'Save is enabled for the empty configuration');
    assert.equal(await page.locator('.issues').isHidden(), true, 'no validation issues for the empty configuration');
  } finally {
    await browser.close();
  }
});
