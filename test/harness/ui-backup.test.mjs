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
    assert.equal(await advanced.locator('.backup-note').textContent(),
      'The full backup contains your provider credentials; store it like a password. The version without credentials is safe to share when asking for help.');
    // The note sits under the two buttons, which share one row.
    assert.equal(await advanced.locator('.ns-backup-actions button').count(), 2);
    assert.equal(await advanced.locator('.ns-backup-actions + .backup-note').count(), 1);
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      advanced.getByRole('button', { name: 'Download backup', exact: true }).click(),
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

test('settings advanced: Download backup without credentials empties every secret field and marks the file', async (t) => {
  const browser = await launchOrSkip(t);
  if (!browser) {
    return;
  }
  try {
    const page = await openSettings(browser, {
      ...CONFIG,
      providers: [TWILIO, SMTP, TELEGRAM, { ...TWILIO, id: 'twilio-file', name: 'Twilio file', credentialsFile: 'twilio.json' }],
    });
    const advanced = page.locator(ADVANCED);
    await advanced.locator('summary').click();
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      advanced.getByRole('button', { name: 'Download backup without credentials' }).click(),
    ]);
    assert.match(download.suggestedFilename(), /^notify-switch-backup-without-credentials-\d{4}-\d{2}-\d{2}\.json$/);
    const { readFileSync } = await import('node:fs');
    const saved = JSON.parse(readFileSync(await download.path(), 'utf8'));
    assert.equal(saved.credentialsRemoved, true);
    assert.equal(saved.platform, 'NotifySwitch');
    const [twilio, smtp, telegram, fromFile] = saved.providers;
    assert.equal(twilio.apiKeySecret, '', 'the Twilio secret is emptied');
    assert.equal(twilio.accountSid, TWILIO.accountSid, 'the Account SID is not a secret and stays');
    assert.equal(twilio.apiKeySid, TWILIO.apiKeySid);
    assert.equal(smtp.password, '', 'the SMTP password is emptied');
    assert.equal(smtp.username, SMTP.username, 'the SMTP username stays without a credentials file');
    assert.equal(smtp.host, SMTP.host);
    assert.equal(telegram.botToken, '', 'the bot token is emptied');
    // With a credentialsFile every key the file may supply is emptied too; the path to the file stays.
    assert.deepEqual([fromFile.accountSid, fromFile.apiKeySid, fromFile.apiKeySecret], ['', '', '']);
    assert.equal(fromFile.credentialsFile, 'twilio.json');
    assert.equal(fromFile.smsSenders[0], TWILIO.smsSenders[0]);
    assert.equal(saved.switches[0].name, 'Water Leak Alert', 'everything else is the full backup');
    assert.equal(saved.groups[0].sms[0], '+16785550101');
    assert.equal(JSON.stringify(saved).includes(TWILIO.apiKeySecret), false, 'no secret anywhere in the file');
    assert.equal(JSON.stringify(saved).includes(SMTP.password), false);
    assert.equal(JSON.stringify(saved).includes(TELEGRAM.botToken), false);
  } finally {
    await browser.close();
  }
});

test('settings advanced: Restore from a backup without credentials loads everything else and shows the empty secret fields as errors', async (t) => {
  const browser = await launchOrSkip(t);
  if (!browser) {
    return;
  }
  try {
    const page = await openSettings(browser, CONFIG);
    const advanced = page.locator(ADVANCED);
    await advanced.locator('summary').click();
    const picker = advanced.locator('input[type="file"]');
    const stripped = {
      ...BACKUP,
      credentialsRemoved: true,
      providers: [{ ...SMTP, password: '' }, { ...TELEGRAM, botToken: '' }],
    };
    await picker.setInputFiles(file('shared.json', stripped));
    await page.waitForSelector('.card[data-path="providers[1]"]');
    assert.equal(await page.locator(`${ADVANCED} .restore-status .alert-danger`).count(), 0, 'accepted');
    assert.deepEqual(await page.locator('.card[data-path^="providers"] .card-header > span').allTextContents(), ['FastmailSMTP', 'TelegramTelegram']);
    assert.equal(await page.locator('[data-path="name"] input').inputValue(), 'Restored');
    assert.equal(await page.locator('.card[data-path="switches[0]"] [data-path="switches[0].name"] input').inputValue(), 'Smoke Alarm');
    assert.deepEqual(await page.evaluate(() => window.__hb.toasts.at(-1)), ['success', 'Backup loaded. Enter the credentials it left out, then click Save.']);
    // The emptied secrets are touched: their errors show inline and the issue list names them. Save waits for them.
    const password = page.locator('[data-path="providers[0].password"]');
    assert.equal(await password.locator('.invalid-feedback').textContent(), 'Password is required.');
    assert.equal(await password.locator('input').evaluate((node) => node.classList.contains('is-invalid')), true);
    const token = page.locator('[data-path="providers[1].botToken"]');
    assert.match(await token.locator('.invalid-feedback').textContent(), /does not look like a bot token/);
    assert.deepEqual(await page.locator('.issues .ns-issue-link').evaluateAll((nodes) => nodes.map((node) => node.dataset.issuePath)),
      ['providers[0].password', 'providers[1].botToken']);
    assert.equal(await page.locator('.issues .fw-semibold').textContent(), 'Fix these before saving:');
    assert.equal(await page.evaluate(() => window.__hb.save.at(-1)), false, 'Save is disabled until the secrets are entered');
    await page.waitForFunction(() => window.__hb.updates.at(-1)?.[0].name === 'Restored');
    const pushed = await page.evaluate(() => window.__hb.updates.at(-1)[0]);
    assert.equal('credentialsRemoved' in pushed, false, 'the marker never reaches config.json');
    assert.equal(pushed.providers[0].host, SMTP.host);
    // Other errors in such a file are still rejected before anything changes.
    await picker.setInputFiles(file('broken.json', { ...stripped, providers: [{ ...SMTP, password: '', host: '' }] }));
    await page.waitForFunction(() => /Host is required/.test(document.querySelector('.restore-status')?.textContent ?? ''));
    assert.equal(await page.locator('[data-path="name"] input').inputValue(), 'Restored', 'the form is untouched');
    // Typing the password clears its error and its list entry.
    await password.locator('input').fill(SMTP.password);
    await password.locator('input').blur();
    assert.equal(await password.locator('.invalid-feedback').textContent(), '');
    assert.equal(await page.locator('.issues .ns-issue-link[data-issue-path="providers[0].password"]').count(), 0);
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
    assert.equal(await page.locator('.card[data-path="providers[0]"] .card-header > span').textContent(), 'TwilioTwilio', 'the form is untouched');

    // A valid backup replaces the form state and enables Save.
    await picker.setInputFiles(file('good.json', BACKUP));
    await page.waitForSelector('.card[data-path="providers[1]"]');
    assert.equal(await page.locator(`${ADVANCED} .restore-status .alert-danger`).count(), 0);
    assert.deepEqual(await page.locator('.card[data-path^="providers"] .card-header > span').allTextContents(), ['FastmailSMTP', 'TelegramTelegram']);
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
    assert.equal(await page.locator('.card[data-path]').count(), 0, 'no provider, group or switch cards remain');
    assert.equal(await page.locator('.ns-get-started').count(), 1, 'the guided empty state is back');
    await page.waitForFunction(() => window.__hb.updates.at(-1)?.[0].providers.length === 0);
    const pushed = await page.evaluate(() => window.__hb.updates.at(-1)[0]);
    assert.equal(pushed.platform, 'NotifySwitch');
    assert.equal(pushed.name, 'Notify Switch');
    assert.equal(pushed.configVersion, 1);
    assert.deepEqual([pushed.providers, pushed.groups, pushed.switches], [[], [], []]);
    assert.equal(await page.evaluate(() => window.__hb.save.at(-1)), true, 'Save is enabled for the empty configuration');
    assert.equal(await page.locator('.issues li').count(), 0, 'no validation issues for the empty configuration');
    // The Save status area reads the reset line until the next change (SPEC section 11.2, item 19).
    assert.equal(await page.locator('.issues').isVisible(), true);
    assert.equal(await page.locator('.issues .fw-semibold').textContent(), 'Configuration reset. Click Save, then restart Homebridge.');
    assert.equal(await page.locator('.issues').getAttribute('role'), 'status');
    assert.equal(await page.getByRole('button', { name: 'Add group' }).isDisabled(), true, 'no provider yet, so Add group is disabled');
  } finally {
    await browser.close();
  }
});
