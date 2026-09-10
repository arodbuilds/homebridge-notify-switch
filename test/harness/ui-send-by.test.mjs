import assert from 'node:assert/strict';
import { test } from 'node:test';

import { launchOrSkip, openSettings } from './browser.mjs';
import { TELEGRAM, TWILIO } from './helpers.mjs';

/**
 * Send by follows every change, wherever it came from (SPEC section 11.2, item 8): a channel that becomes present
 * is ticked whether the change was made on the switch card, on a group card (an address on a new channel) or on a
 * provider card (a provider for a channel the recipients already have); a channel the user unticked stays unticked
 * while it stays present, an unrelated group edit included.
 */

const CONFIG = {
  platform: 'NotifySwitch',
  name: 'Notify Switch',
  defaultCountry: 'US',
  providers: [TWILIO],
  groups: [{ id: 'family', name: 'Family', sms: ['+16785550101'], email: [], telegram: ['123456789'], ntfy: [] }],
  switches: [{
    id: '6f1c2a9e-2b1c-4b8f-9d1e-0c5a1e2f3a4b',
    name: 'Water Leak Alert',
    actions: [{ providerId: 'twilio-main', channel: 'sms', groups: ['family'], body: 'Water detected.' }],
  }],
};

const SEND_BY = '.card[data-path="switches[0]"] .ns-send-by';

async function sendByRows(page) {
  return page.locator(`${SEND_BY} .form-check`).evaluateAll((nodes) => nodes.map((node) => [node.dataset.channel, node.querySelector('input').checked]));
}

async function pushedActions(page, predicate) {
  await page.waitForFunction(predicate);
  return page.evaluate(() => window.__hb.updates.at(-1)[0].switches[0].actions);
}

test('send by: a group that gains an address on a new channel ticks that channel on the switch that sends to it', async (t) => {
  const browser = await launchOrSkip(t);
  if (!browser) {
    return;
  }
  try {
    const page = await openSettings(browser, CONFIG);
    // Twilio serves email (it has a from address), but nobody has an email address yet: only SMS is present.
    assert.deepEqual(await sendByRows(page), [['sms', true]]);
    const group = page.locator('.card[data-path="groups[0]"]');
    await group.locator('[data-path="groups[0].email"]').getByRole('button', { name: 'Add email address' }).click();
    await group.locator('[data-path="groups[0].email"] input').fill('a@example.com');
    // The Switches section redraws after the group change; Email is present and ticked, and an email action is written.
    await page.waitForFunction(() => document.querySelectorAll('.card[data-path="switches[0]"] .ns-send-by .form-check').length === 2);
    assert.deepEqual(await sendByRows(page), [['sms', true], ['email', true]]);
    const actions = await pushedActions(page, () => window.__hb.updates.at(-1)?.[0].switches[0].actions.length === 2);
    assert.deepEqual(actions.map((a) => [a.channel, a.providerId]), [['sms', 'twilio-main'], ['email', 'twilio-main']]);
    assert.equal(await page.locator('.card[data-path="switches[0]"] .ns-send-preview').textContent(),
      'Will send SMS via Twilio to 1 number, email via Twilio to 1 address.');
  } finally {
    await browser.close();
  }
});

test('send by: a provider added for a channel the recipients already have ticks that channel', async (t) => {
  const browser = await launchOrSkip(t);
  if (!browser) {
    return;
  }
  try {
    const page = await openSettings(browser, CONFIG);
    // The family group holds a Telegram chat, but no provider can send Telegram: the channel is not listed.
    assert.deepEqual(await sendByRows(page), [['sms', true]]);
    await page.getByRole('button', { name: 'Add provider' }).click();
    await page.locator('.ns-chooser-tile[data-type="telegram"]').click();
    // The Switches section is redrawn with the provider: Telegram is present and ticked, and the action names the new provider.
    assert.deepEqual(await sendByRows(page), [['sms', true], ['telegram', true]]);
    const actions = await pushedActions(page, () => window.__hb.updates.at(-1)?.[0].switches[0].actions.length === 2);
    assert.deepEqual(actions.map((a) => [a.channel, a.providerId]), [['sms', 'twilio-main'], ['telegram', 'telegram']]);
    // Filling the card in validates it; the tick is not repeated and not undone.
    await page.locator('[data-path="providers[1].botToken"] input').fill(TELEGRAM.botToken);
    await page.locator('[data-path="providers[1].botToken"] input').blur();
    assert.deepEqual(await sendByRows(page), [['sms', true], ['telegram', true]]);
    // Unticking it by hand, then an unrelated provider edit: it stays unticked while it stays present.
    await page.locator(`${SEND_BY} [data-path="switches[0].channels.telegram"] input`).uncheck();
    await page.locator('[data-path="providers[1].name"] input').fill('Family bot');
    await page.waitForFunction(() => document.querySelector('[data-path="switches[0].channels.telegram"] input') !== null);
    await page.waitForTimeout(600);
    assert.deepEqual(await sendByRows(page), [['sms', true], ['telegram', false]]);
    const written = await pushedActions(page, () => window.__hb.updates.at(-1)?.[0].providers[1].name === 'Family bot');
    assert.deepEqual(written.map((a) => a.channel), ['sms']);
  } finally {
    await browser.close();
  }
});

test('send by: an unticked present channel stays unticked after an unrelated group edit, and comes back ticked only after leaving', async (t) => {
  const browser = await launchOrSkip(t);
  if (!browser) {
    return;
  }
  try {
    const stored = {
      ...CONFIG,
      groups: [{ id: 'family', name: 'Family', sms: ['+16785550101'], email: ['a@example.com'], telegram: [], ntfy: [] }],
    };
    const page = await openSettings(browser, stored);
    // Email is present (the group has an address and Twilio can send it) but the stored switch has no email action: unticked on load.
    assert.deepEqual(await sendByRows(page), [['sms', true], ['email', false]]);
    const group = page.locator('.card[data-path="groups[0]"]');
    await group.locator('[data-path="groups[0].name"] input').fill('Family and friends');
    await page.waitForFunction(() => document.querySelector('.card[data-path="switches[0]"] .ns-recipient-groups label')?.textContent
      .startsWith('Family and friends'));
    assert.deepEqual(await sendByRows(page), [['sms', true], ['email', false]], 'a group rename changes nothing about Send by');
    await group.locator('[data-path="groups[0].email"]').getByRole('button', { name: 'Add email address' }).click();
    await group.locator('[data-path="groups[0].email"] input').nth(1).fill('b@example.com');
    await page.waitForFunction(() => document.querySelector('[data-path="switches[0].channels.email"] label')?.textContent === 'Email (2 addresses)');
    assert.deepEqual(await sendByRows(page), [['sms', true], ['email', false]], 'a second address on a channel already present does not tick it');
    let actions = await pushedActions(page, () => window.__hb.updates.at(-1)?.[0].groups[0].email.length === 2);
    assert.deepEqual(actions.map((a) => a.channel), ['sms']);
    // Removing every email address makes the channel leave; adding one back makes it present again, and it is ticked again.
    await group.locator('[data-path="groups[0].email"]').getByRole('button', { name: /Remove/ }).nth(1).click();
    await group.locator('[data-path="groups[0].email"]').getByRole('button', { name: /Remove/ }).first().click();
    await page.waitForFunction(() => document.querySelectorAll('.card[data-path="switches[0]"] .ns-send-by .form-check').length === 1);
    assert.deepEqual(await sendByRows(page), [['sms', true]]);
    await group.locator('[data-path="groups[0].email"]').getByRole('button', { name: 'Add email address' }).click();
    await group.locator('[data-path="groups[0].email"] input').fill('c@example.com');
    await page.waitForFunction(() => document.querySelectorAll('.card[data-path="switches[0]"] .ns-send-by .form-check').length === 2);
    assert.deepEqual(await sendByRows(page), [['sms', true], ['email', true]]);
    actions = await pushedActions(page, () => window.__hb.updates.at(-1)?.[0].switches[0].actions.length === 2);
    assert.deepEqual(actions.map((a) => a.channel), ['sms', 'email']);
  } finally {
    await browser.close();
  }
});
