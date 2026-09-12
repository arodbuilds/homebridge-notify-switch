import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { test } from 'node:test';

import { launchOrSkip, openSettings } from './browser.mjs';
import { TWILIO } from './helpers.mjs';

/**
 * A stored configuration with more than one action on the same channel (SPEC section 11.2, item 26): the
 * built settings UI does not represent it. It shows the upgrade notice at the top, disables every section
 * except Download backup, Download backup without credentials and Reset plugin to fresh install, pushes
 * nothing and keeps Save disabled until the reset is done. The backups carry the block exactly as loaded.
 */

const FIXTURE = JSON.parse(readFileSync(join(resolve(import.meta.dirname, '..', 'fixtures', 'legacy'), 'two-sms-actions.json'), 'utf8'));

const NOTICE = 'Warning: upgrading to 1.1 requires reconfiguring this plugin. Download a backup for reference, then use Reset plugin to fresh install '
  + 'under Advanced and set up your switches again.';

const ADVANCED = '#section-settings details.ns-advanced';

/** Every form control inside the four sections, as [label or path, disabled]. */
function controlStates(page) {
  return page.locator('.section-body').locator('input, select, textarea, button').evaluateAll((nodes) => nodes.map((node) => [
    node.textContent.trim() || node.closest('[data-path]')?.dataset.path || node.type, node.disabled,
  ]));
}

test('legacy configuration: the notice is first, every section is disabled except the backups and Reset, nothing is pushed, Save is disabled', async (t) => {
  const browser = await launchOrSkip(t);
  if (!browser) {
    return;
  }
  try {
    const page = await openSettings(browser, FIXTURE);
    const notice = page.locator('.ns-legacy-notice');
    assert.equal(await notice.count(), 1);
    assert.equal(await notice.isVisible(), true);
    assert.equal(await notice.textContent(), NOTICE);
    assert.equal(await notice.getAttribute('role'), 'alert');
    // Directly under the page banner, before anything else (SPEC section 11.2, items 26 and 28).
    assert.equal(await page.locator('#app > :first-child').evaluate((node) => node.classList.contains('ns-banner')), true);
    assert.equal(await page.locator('#app > :nth-child(2)').evaluate((node) => node.classList.contains('ns-legacy-notice')), true, 'at the top of the page');

    // The switch is not represented: no card, a line naming it instead.
    assert.equal(await page.locator('.card[data-path^="switches"]').count(), 0);
    assert.equal(await page.locator('#section-switches .ns-legacy-switches').textContent(),
      'Not shown: Two SMS. This switch has more than one action on the same channel, which this version cannot edit.');
    // The providers and groups are drawn, but nothing in them can be used.
    assert.equal(await page.locator('.card[data-path="providers[0]"]').count(), 1);
    assert.equal(await page.locator('.card[data-path="groups[1]"]').count(), 1);
    const states = await controlStates(page);
    const enabled = states.filter(([, disabled]) => !disabled).map(([label]) => label);
    assert.deepEqual(enabled, ['Download backup', 'Download backup without credentials', 'Reset plugin to fresh install']);
    assert.ok(states.length > enabled.length + 10, `the rest of the page is disabled (${states.length} controls)`);
    assert.equal(await page.locator('#section-providers .section-body').evaluate((node) => node.classList.contains('ns-locked')), true);
    assert.equal(await page.locator(ADVANCED).evaluate((node) => node.open), true, 'Advanced is open so the buttons are in view');
    assert.equal(await page.locator(ADVANCED).locator('input[type="file"]').isDisabled(), true, 'Restore is disabled too');

    // No configuration is pushed, no draft is written, the issue box is hidden and Save is disabled.
    await page.waitForTimeout(600);
    assert.deepEqual(await page.evaluate(() => window.__hb.updates), []);
    assert.equal(await page.evaluate(() => window.localStorage.getItem('homebridge-notify-switch:draft')), null);
    assert.equal(await page.locator('.issues').isVisible(), false);
    assert.equal(await page.evaluate(() => window.__hb.save.at(-1)), false);
    assert.equal(await page.evaluate(() => window.__hb.save.includes(true)), false, 'Save was never enabled');
  } finally {
    await browser.close();
  }
});

test('legacy configuration: both backups carry the block exactly as loaded, the second with its secrets emptied', async (t) => {
  const browser = await launchOrSkip(t);
  if (!browser) {
    return;
  }
  try {
    const page = await openSettings(browser, FIXTURE);
    const advanced = page.locator(ADVANCED);
    let [download] = await Promise.all([
      page.waitForEvent('download'),
      advanced.getByRole('button', { name: 'Download backup', exact: true }).click(),
    ]);
    assert.match(download.suggestedFilename(), /^notify-switch-backup-\d{4}-\d{2}-\d{2}\.json$/);
    assert.deepEqual(JSON.parse(readFileSync(await download.path(), 'utf8')), FIXTURE, 'both SMS actions are in the backup');

    [download] = await Promise.all([
      page.waitForEvent('download'),
      advanced.getByRole('button', { name: 'Download backup without credentials' }).click(),
    ]);
    assert.match(download.suggestedFilename(), /^notify-switch-backup-without-credentials-\d{4}-\d{2}-\d{2}\.json$/);
    const stripped = JSON.parse(readFileSync(await download.path(), 'utf8'));
    assert.deepEqual(stripped, {
      ...FIXTURE,
      providers: [{ ...FIXTURE.providers[0], apiKeySecret: '' }],
      credentialsRemoved: true,
    });
    assert.equal(JSON.stringify(stripped).includes(TWILIO.apiKeySecret), false, 'no secret anywhere in the file');
  } finally {
    await browser.close();
  }
});

test('legacy configuration: Reset plugin to fresh install clears the notice, enables the page and Save, and pushes the empty configuration', async (t) => {
  const browser = await launchOrSkip(t);
  if (!browser) {
    return;
  }
  try {
    const page = await openSettings(browser, FIXTURE);
    await page.locator(ADVANCED).getByRole('button', { name: 'Reset plugin to fresh install' }).click();
    const modal = page.locator('.ns-modal');
    assert.equal(await modal.getByRole('button', { name: 'Download backup first' }).isEnabled(), true);
    await modal.locator('input[type="text"]').fill('RESET');
    await modal.getByRole('button', { name: 'Confirm' }).click();
    assert.equal(await page.locator('.ns-modal').count(), 0);
    assert.equal(await page.locator('.ns-legacy-notice').count(), 0, 'the notice is gone');
    assert.equal(await page.locator('.ns-legacy-switches').count(), 0);
    assert.equal(await page.locator('.ns-locked').count(), 0);
    assert.equal(await page.locator('.ns-get-started').count(), 1, 'the guided empty state is back');
    assert.equal(await page.locator('.ns-get-started button').first().isEnabled(), true, 'the page is usable again');
    assert.equal(await page.locator(ADVANCED).locator('input[type="file"]').isDisabled(), false);
    await page.waitForFunction(() => window.__hb.updates.at(-1)?.[0].providers.length === 0);
    const pushed = await page.evaluate(() => window.__hb.updates.at(-1)[0]);
    assert.deepEqual([pushed.providers, pushed.groups, pushed.switches], [[], [], []]);
    assert.equal(await page.evaluate(() => window.__hb.save.at(-1)), true, 'Save is enabled for the empty configuration');
    assert.equal(await page.locator('.issues .fw-semibold').textContent(), 'Configuration reset. Click Save, then restart Homebridge.');
  } finally {
    await browser.close();
  }
});

test('legacy configuration: Restore from backup refuses such a file and leaves the form alone', async (t) => {
  const browser = await launchOrSkip(t);
  if (!browser) {
    return;
  }
  try {
    const page = await openSettings(browser, {
      platform: 'NotifySwitch', name: 'Notify Switch', defaultCountry: 'US', providers: [TWILIO], groups: [], switches: [],
    });
    const advanced = page.locator(ADVANCED);
    await advanced.locator('summary').click();
    await advanced.locator('input[type="file"]').setInputFiles({
      name: 'legacy.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(FIXTURE)),
    });
    await page.waitForSelector(`${ADVANCED} .restore-status .alert-danger`);
    assert.deepEqual(await advanced.locator('.restore-status li').allTextContents(),
      ['The file has more than one action on the same channel on "Two SMS", which this version cannot edit. Set the switch up again instead.']);
    assert.equal(await page.locator('.card[data-path^="switches"]').count(), 0, 'nothing was loaded');
    assert.equal(await page.locator('.ns-legacy-notice').count(), 0);
    assert.equal(await page.evaluate(() => window.__hb.save.at(-1)), true, 'the page stays as it was');
  } finally {
    await browser.close();
  }
});
