import assert from 'node:assert/strict';
import { test } from 'node:test';

import { launchOrSkip, openSettings } from './browser.mjs';
import { TWILIO } from './helpers.mjs';

/**
 * Click-to-insert variables (SPEC section 11.2, item 17): every entry of a Variables list is a real button showing
 * the token with the value it would render right now (in the platform's Time format and Date format settings, and
 * the switch's current name), and clicking one inserts the token at the field's caret, replacing any selection,
 * places the caret after it, returns focus and runs the field's own change handling.
 */

const CONFIG = {
  platform: 'NotifySwitch',
  name: 'Notify Switch',
  defaultCountry: 'US',
  providers: [TWILIO],
  groups: [{ id: 'family', name: 'Family', sms: ['+16785550101'], email: ['a@example.com'], telegram: [], ntfy: [] }],
  switches: [{
    id: '6f1c2a9e-2b1c-4b8f-9d1e-0c5a1e2f3a4b',
    name: 'Water Leak Alert',
    actions: [
      { providerId: 'twilio-main', channel: 'sms', groups: ['family'], body: 'Water at home.' },
      { providerId: 'twilio-main', channel: 'email', groups: ['family'], subject: 'Leak', body: 'Water at home.' },
    ],
  }],
};

const MESSAGE = '.card[data-path="switches[0]"] [data-path="switches[0].body"]';

/** The list entries as [token, value] pairs. */
async function entries(page, field) {
  return page.locator(`${field} .ns-variable-list li`).evaluateAll((nodes) => nodes.map((node) => [
    node.querySelector('button').textContent, node.querySelector('.ns-variable-value').textContent,
  ]));
}

test('variables: each entry is a button with the token and its current value; the values follow the settings and the switch name', async (t) => {
  const browser = await launchOrSkip(t);
  if (!browser) {
    return;
  }
  try {
    const page = await openSettings(browser, CONFIG);
    const message = page.locator(MESSAGE);
    await message.locator('.ns-variables-toggle').click();
    const list = message.locator('.ns-variables');
    assert.equal(await list.isVisible(), true);
    const buttons = list.locator('.ns-variable-list button');
    assert.equal(await buttons.count(), 4, 'one real button per variable');
    const shape = (nodes) => nodes.map((node) => [node.tagName, node.type, node.dataset.token, node.getAttribute('aria-label')]);
    assert.deepEqual(await buttons.evaluateAll(shape), [
      ['BUTTON', 'button', '{{switchName}}', 'Insert {{switchName}}'],
      ['BUTTON', 'button', '{{time}}', 'Insert {{time}}'],
      ['BUTTON', 'button', '{{date}}', 'Insert {{date}}'],
      ['BUTTON', 'button', '{{datetime}}', 'Insert {{datetime}}'],
    ]);
    const shown = await entries(page, MESSAGE);
    assert.deepEqual(shown.map(([token]) => token), ['{{switchName}}', '{{time}}', '{{date}}', '{{datetime}}']);
    assert.equal(shown[0][1], 'Water Leak Alert');
    assert.match(shown[1][1], /^\d{1,2}:\d\d [AP]M$/, '12-hour by default');
    assert.match(shown[2][1], /^\d{1,2}\/\d{1,2}\/\d{4}$/, 'month/day/year by default');
    assert.equal(shown[3][1], `${shown[2][1]} ${shown[1][1]}`, 'datetime is the date, a space, the time');
    assert.equal(await list.locator('.ns-variables-help').textContent(), 'Click a variable to insert it at the cursor.');
    assert.equal(await list.locator('a').textContent(), 'More about variables');
    assert.equal(await list.locator('a').getAttribute('href'), 'https://github.com/arodbuilds/homebridge-notify-switch#template-variables');
    // Every list on the card is one: the subject has its own, bound to its own field.
    const subject = page.locator('.card[data-path="switches[0]"] [data-path="switches[0].subject"]');
    await subject.locator('.ns-variables-toggle').click();
    assert.equal(await subject.locator('.ns-variable-list button').count(), 4);

    // The values follow the settings and the name: they are read each time a list opens.
    await page.locator('#section-settings [data-path="timeFormat"] select').selectOption('24h');
    await page.locator('#section-settings [data-path="dateFormat"] select').selectOption('ymd');
    await page.locator('.card[data-path="switches[0]"] [data-path="switches[0].name"] input').fill('');
    // Leave the name field first: its "Name is required." message appears on blur and would move the toggle under the pointer.
    await page.locator('.card[data-path="switches[0]"] [data-path="switches[0].name"] input').blur();
    await message.locator('.ns-variables-toggle').click();
    await message.locator('.ns-variables-toggle').click();
    const again = await entries(page, MESSAGE);
    assert.equal(again[0][1], 'Switch name', 'an empty name shows the placeholder');
    assert.match(again[1][1], /^\d\d:\d\d$/, '24-hour');
    assert.match(again[2][1], /^\d{4}-\d\d-\d\d$/, 'year-month-day');
    assert.equal(again[3][1], `${again[2][1]} ${again[1][1]}`);
  } finally {
    await browser.close();
  }
});

test('variables: clicking inserts the token at the caret, replaces a selection, focuses the field and runs its change handling', async (t) => {
  const browser = await launchOrSkip(t);
  if (!browser) {
    return;
  }
  try {
    const page = await openSettings(browser, CONFIG);
    const message = page.locator(MESSAGE);
    const textarea = message.locator('textarea');
    await message.locator('.ns-variables-toggle').click();
    // Caret after "Water " (index 6), then insert {{time}}.
    await textarea.evaluate((node) => {
      node.focus();
      node.setSelectionRange(6, 6);
    });
    await message.locator('.ns-variable[data-token="{{time}}"]').click();
    assert.equal(await textarea.inputValue(), 'Water {{time}}at home.');
    assert.deepEqual(await textarea.evaluate((node) => [node.selectionStart, node.selectionEnd, node === document.activeElement]), [14, 14, true],
      'the caret sits after the token and the field has focus');
    // The field's own handler ran: the written action carries the new body, with the SMS counter updated.
    await page.waitForFunction(() => window.__hb.updates.at(-1)?.[0].switches[0].actions[0].body === 'Water {{time}}at home.');
    assert.deepEqual(await page.evaluate(() => window.__hb.updates.at(-1)[0].switches[0].actions.map((a) => a.body)),
      ['Water {{time}}at home.', 'Water {{time}}at home.']);
    assert.match(await message.locator('.sms-counter').textContent(), /22/, 'the SMS counter counted the new text');
    // A selection is replaced.
    await textarea.evaluate((node) => {
      node.focus();
      node.setSelectionRange(6, 14);
    });
    await message.locator('.ns-variable[data-token="{{switchName}}"]').click();
    assert.equal(await textarea.inputValue(), 'Water {{switchName}}at home.');
    assert.deepEqual(await textarea.evaluate((node) => [node.selectionStart, node.selectionEnd]), [20, 20]);
    // Keyboard: the button takes focus and Enter activates it; the caret is at the end of the field afterwards.
    await textarea.evaluate((node) => node.setSelectionRange(node.value.length, node.value.length));
    const dateButton = message.locator('.ns-variable[data-token="{{date}}"]');
    await dateButton.focus();
    await page.keyboard.press('Enter');
    assert.equal(await textarea.inputValue(), 'Water {{switchName}}at home.{{date}}');
    assert.equal(await textarea.evaluate((node) => node === document.activeElement), true);
    // The subject list inserts into the subject, not the message.
    const subject = page.locator('.card[data-path="switches[0]"] [data-path="switches[0].subject"]');
    await subject.locator('.ns-variables-toggle').click();
    await subject.locator('input').evaluate((node) => {
      node.focus();
      node.setSelectionRange(0, 0);
    });
    await subject.locator('.ns-variable[data-token="{{datetime}}"]').click();
    assert.equal(await subject.locator('input').inputValue(), '{{datetime}}Leak');
    assert.equal(await textarea.inputValue(), 'Water {{switchName}}at home.{{date}}');
    await page.waitForFunction(() => window.__hb.updates.at(-1)?.[0].switches[0].actions[1].subject === '{{datetime}}Leak');
  } finally {
    await browser.close();
  }
});
