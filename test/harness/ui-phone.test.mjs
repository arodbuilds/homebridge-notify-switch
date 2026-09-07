import assert from 'node:assert/strict';
import { test } from 'node:test';

import { launchOrSkip, openSettings } from './browser.mjs';
import { TWILIO } from './helpers.mjs';

/**
 * Phone entry in the built settings UI (SPEC section 11.2, item 1): nothing is reformatted while the
 * field has focus; on blur the text is parsed with the selected country as the hint, stored as E.164,
 * the country is re-derived from the number, and the field shows the national format.
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

const ROW = (i) => `.address-row[data-path="groups[0].sms[${i}]"]`;

async function storedSms(page, i) {
  await page.waitForFunction(() => window.__hb.updates.length > 0);
  return page.evaluate((index) => window.__hb.updates.at(-1)[0].groups[0].sms[index], i);
}

async function addRow(page) {
  await page.locator('.address-list[data-path="groups[0].sms"]').getByRole('button', { name: 'Add phone number' }).click();
}

test('phone entry: typing with the caret mid-field does not reformat, and blur stores E.164 in the national format', async (t) => {
  const browser = await launchOrSkip(t);
  if (!browser) {
    return;
  }
  try {
    const page = await openSettings(browser, CONFIG);
    await addRow(page);
    const input = page.locator(`${ROW(1)} input.phone-national`);
    await input.click();
    await input.type('305 555 023');
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.type('1');
    assert.equal(await input.inputValue(), '305 555 0123', 'no formatting while typing');
    assert.equal(await input.evaluate((node) => node.selectionStart), 10, 'the caret stays where the user typed');
    assert.equal(await page.locator(`${ROW(1)} .phone-feedback`).textContent(), '', 'no "Stored as" line before blur');
    await page.keyboard.press('End');
    await input.type('x-');
    assert.equal(await input.inputValue(), '305 555 0123-', 'letters are dropped; dashes are accepted');
    await page.keyboard.press('Backspace');
    await input.blur();
    assert.equal(await input.inputValue(), '(305) 555-0123');
    assert.equal(await page.locator(`${ROW(1)} .phone-feedback`).textContent(), 'Stored as +13055550123');
    await page.waitForFunction(() => window.__hb.updates.at(-1)?.[0].groups[0].sms[1] === '+13055550123');
    assert.equal(await storedSms(page, 1), '+13055550123');

    // An invalid entry keeps the raw text, shows the inline error, and has no "Stored as" line.
    await input.click();
    await input.fill('12');
    await input.blur();
    assert.equal(await input.inputValue(), '12');
    const feedback = await page.locator(`${ROW(1)} .phone-feedback`).textContent();
    assert.match(feedback, /^Not a valid number for United States/);
    assert.ok(!feedback.includes('Stored as'));
    assert.match(await page.locator(`${ROW(1)} input.phone-national`).getAttribute('class'), /\bis-invalid\b/);
  } finally {
    await browser.close();
  }
});

test('phone entry: editing an existing number keeps the text as typed until blur', async (t) => {
  const browser = await launchOrSkip(t);
  if (!browser) {
    return;
  }
  try {
    const page = await openSettings(browser, CONFIG);
    const input = page.locator(`${ROW(0)} input.phone-national`);
    assert.equal(await input.inputValue(), '(678) 555-0101', 'stored E.164 is shown in the national format');
    assert.equal(await page.locator(`${ROW(0)} select.phone-country`).inputValue(), 'US');
    assert.equal(await page.locator(`${ROW(0)} .phone-feedback`).textContent(), 'Stored as +16785550101');
    await input.click();
    await page.keyboard.press('End');
    await page.keyboard.press('Backspace');
    await page.keyboard.type('9');
    assert.equal(await input.inputValue(), '(678) 555-0109', 'the existing formatting is left alone while editing');
    await input.blur();
    assert.equal(await input.inputValue(), '(678) 555-0109');
    assert.equal(await page.locator(`${ROW(0)} .phone-feedback`).textContent(), 'Stored as +16785550109');
    await page.waitForFunction(() => window.__hb.updates.at(-1)?.[0].groups[0].sms[0] === '+16785550109');
  } finally {
    await browser.close();
  }
});

test('phone entry: pasting E.164 is accepted as is while focused, then shown nationally with the country set on blur', async (t) => {
  const browser = await launchOrSkip(t);
  if (!browser) {
    return;
  }
  try {
    const page = await openSettings(browser, CONFIG);
    await addRow(page);
    const input = page.locator(`${ROW(1)} input.phone-national`);
    await page.locator(`${ROW(1)} select.phone-country`).selectOption('GB');
    await input.click();
    await input.fill('+13055550123');
    assert.equal(await input.inputValue(), '+13055550123', 'a pasted number is not touched while the field has focus');
    assert.equal(await page.locator(`${ROW(1)} select.phone-country`).inputValue(), 'GB', 'the country waits for blur too');
    await input.blur();
    assert.equal(await input.inputValue(), '(305) 555-0123');
    assert.equal(await page.locator(`${ROW(1)} select.phone-country`).inputValue(), 'US', 'the country follows the pasted number');
    assert.equal(await page.locator(`${ROW(1)} .phone-feedback`).textContent(), 'Stored as +13055550123');
    await page.waitForFunction(() => window.__hb.updates.at(-1)?.[0].groups[0].sms[1] === '+13055550123');

    // A UK number pasted with 00 instead of + works the same way.
    await input.click();
    await input.fill('00 44 20 7946 0958');
    await input.blur();
    assert.equal(await page.locator(`${ROW(1)} select.phone-country`).inputValue(), 'GB');
    assert.equal(await page.locator(`${ROW(1)} .phone-feedback`).textContent(), 'Stored as +442079460958');
  } finally {
    await browser.close();
  }
});

test('phone entry: a +1 number typed with Canada selected re-derives United States from the number', async (t) => {
  const browser = await launchOrSkip(t);
  if (!browser) {
    return;
  }
  try {
    const page = await openSettings(browser, CONFIG);
    await addRow(page);
    const select = page.locator(`${ROW(1)} select.phone-country`);
    const input = page.locator(`${ROW(1)} input.phone-national`);
    await select.selectOption('CA');
    assert.equal(await select.inputValue(), 'CA');
    await input.click();
    await input.type('305 555 0123');
    assert.equal(await select.inputValue(), 'CA', 'the dropdown does not change while typing');
    await input.blur();
    assert.equal(await select.inputValue(), 'US', 'a +1 305 number is United States, not Canada');
    assert.equal(await input.inputValue(), '(305) 555-0123');
    assert.equal(await page.locator(`${ROW(1)} .phone-feedback`).textContent(), 'Stored as +13055550123');
    await page.waitForFunction(() => window.__hb.updates.at(-1)?.[0].groups[0].sms[1] === '+13055550123');

    // Changing the country re-parses the current text against the new hint and stores the result.
    await select.selectOption('GB');
    assert.equal(await page.locator(`${ROW(1)} .phone-feedback`).textContent(), 'Stored as +443055550123');
    await page.waitForFunction(() => window.__hb.updates.at(-1)?.[0].groups[0].sms[1] === '+443055550123');
  } finally {
    await browser.close();
  }
});
