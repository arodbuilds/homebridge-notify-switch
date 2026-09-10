import assert from 'node:assert/strict';
import { test } from 'node:test';

import { launchOrSkip, openSettings } from './browser.mjs';
import { TWILIO } from './helpers.mjs';

/**
 * The Time format and Date format settings in the built settings UI (SPEC section 5.1, section 11.2 and section
 * 11.3): two dropdowns directly below Default Country with one help line under the pair, the defaults when the
 * stored block has no value (or an invalid one), both values written with the next Save, and the defaults kept
 * by Reset plugin to fresh install.
 */

const CONFIG = {
  platform: 'NotifySwitch',
  name: 'Notify Switch',
  defaultCountry: 'US',
  providers: [TWILIO],
  groups: [{ id: 'family', name: 'Family', sms: ['+16785550101'], email: [], telegram: [], ntfy: [] }],
  switches: [{
    id: '6f1c2a9e-2b1c-4b8f-9d1e-0c5a1e2f3a4b',
    name: 'Water Leak Alert',
    actions: [{ providerId: 'twilio-main', channel: 'sms', groups: ['family'], body: 'Water detected at {{time}}.' }],
  }],
};

const ADVANCED = '#section-settings details.ns-advanced[data-advanced="settings"]';

test('format settings: two dropdowns below Default Country with the spec copy, defaults when unset, written with the next Save', async (t) => {
  const browser = await launchOrSkip(t);
  if (!browser) {
    return;
  }
  try {
    const page = await openSettings(browser, CONFIG);
    const settings = page.locator('#section-settings');
    const time = settings.locator('[data-path="timeFormat"]');
    const date = settings.locator('[data-path="dateFormat"]');
    assert.equal(await time.locator('label').first().textContent(), 'Time format');
    assert.deepEqual(await time.locator('option').allTextContents(), ['12-hour (5:15 PM)', '24-hour (17:15)']);
    assert.deepEqual(await time.locator('option').evaluateAll((nodes) => nodes.map((node) => node.value)), ['12h', '24h']);
    assert.equal(await date.locator('label').first().textContent(), 'Date format');
    assert.deepEqual(await date.locator('option').allTextContents(), ['Month/Day/Year (9/8/2026)', 'Day/Month/Year (8/9/2026)', 'Year-Month-Day (2026-09-08)']);
    assert.deepEqual(await date.locator('option').evaluateAll((nodes) => nodes.map((node) => node.value)), ['mdy', 'dmy', 'ymd']);
    // A missing field means the default.
    assert.equal(await time.locator('select').inputValue(), '12h');
    assert.equal(await date.locator('select').inputValue(), 'mdy');
    // One help line under the pair, and the pair sits directly below Default Country.
    const block = settings.locator('.ns-format-settings');
    assert.equal(await block.locator('.ns-format-help').textContent(), 'Used by {{time}}, {{date}} and {{datetime}} in messages.');
    assert.equal(await block.locator('.ns-help').count(), 1, 'one help line for the pair, none per field');
    assert.equal(await page.evaluate(() => {
      const country = document.querySelector('[data-path="defaultCountry"]').closest('.ns-grid');
      return country.nextElementSibling.classList.contains('ns-format-settings');
    }), true, 'the format block follows the grid that holds Default Country');
    const boxes = await page.evaluate(() => {
      const box = (selector) => document.querySelector(selector).getBoundingClientRect();
      return { country: box('[data-path="defaultCountry"]').bottom, time: box('[data-path="timeFormat"]').top, date: box('[data-path="dateFormat"]').top };
    });
    assert.ok(boxes.time >= boxes.country && boxes.date >= boxes.country, 'both dropdowns are drawn below Default Country');
    // The defaults are written with the next Save, like Default Country.
    await page.waitForFunction(() => window.__hb.updates.length > 0);
    let pushed = await page.evaluate(() => window.__hb.updates.at(-1)[0]);
    assert.equal(pushed.timeFormat, '12h');
    assert.equal(pushed.dateFormat, 'mdy');
    assert.equal(pushed.defaultCountry, 'US');
    // Choosing values writes them.
    await time.locator('select').selectOption('24h');
    await date.locator('select').selectOption('ymd');
    await page.waitForFunction(() => window.__hb.updates.at(-1)?.[0].dateFormat === 'ymd');
    pushed = await page.evaluate(() => window.__hb.updates.at(-1)[0]);
    assert.equal(pushed.timeFormat, '24h');
    assert.equal(pushed.dateFormat, 'ymd');
    assert.equal(await page.evaluate(() => window.__hb.save.at(-1)), true);
    // Reset plugin to fresh install keeps the defaults.
    await page.locator(`${ADVANCED} summary`).click();
    await page.locator(ADVANCED).getByRole('button', { name: 'Reset plugin to fresh install' }).click();
    await page.locator('.ns-modal input[type="text"]').fill('RESET');
    await page.locator('.ns-modal').getByRole('button', { name: 'Confirm' }).click();
    await page.waitForFunction(() => window.__hb.updates.at(-1)?.[0].providers.length === 0);
    pushed = await page.evaluate(() => window.__hb.updates.at(-1)[0]);
    assert.equal(pushed.timeFormat, '12h');
    assert.equal(pushed.dateFormat, 'mdy');
    assert.equal(pushed.defaultCountry, 'US');
    assert.equal(await settings.locator('[data-path="timeFormat"] select').inputValue(), '12h');
    assert.equal(await settings.locator('[data-path="dateFormat"] select').inputValue(), 'mdy');
    await page.close();

    // Stored values are shown; an invalid stored value falls back to the default and is written as such.
    const stored = await openSettings(browser, { ...CONFIG, timeFormat: '24h', dateFormat: 'dmy' });
    assert.equal(await stored.locator('[data-path="timeFormat"] select').inputValue(), '24h');
    assert.equal(await stored.locator('[data-path="dateFormat"] select').inputValue(), 'dmy');
    await stored.close();
    const invalid = await openSettings(browser, { ...CONFIG, timeFormat: '12', dateFormat: 42 });
    assert.equal(await invalid.locator('[data-path="timeFormat"] select').inputValue(), '12h');
    assert.equal(await invalid.locator('[data-path="dateFormat"] select').inputValue(), 'mdy');
    await invalid.waitForFunction(() => window.__hb.updates.length > 0);
    pushed = await invalid.evaluate(() => window.__hb.updates.at(-1)[0]);
    assert.equal(pushed.timeFormat, '12h');
    assert.equal(pushed.dateFormat, 'mdy');
    assert.equal(await invalid.evaluate(() => window.__hb.save.at(-1)), true);
  } finally {
    await browser.close();
  }
});
