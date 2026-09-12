import assert from 'node:assert/strict';
import { test } from 'node:test';

import { launchOrSkip, openSettings } from './browser.mjs';
import { NTFY, SMTP, TELEGRAM, TWILIO } from './helpers.mjs';

/**
 * The switch editor in the built settings UI (SPEC section 11.2, item 8, and section 11.3): Recipients with
 * per-channel counts and extra addresses by channel, Send by with resolved counts, one Message and one Subject,
 * the live preview line, and Advanced (Customize message per channel, provider overrides, BCC, ntfy options).
 * Every change writes the `actions` array config.json keeps.
 */

const CONFIG = {
  platform: 'NotifySwitch',
  name: 'Notify Switch',
  defaultCountry: 'US',
  defaultProviders: { email: 'fastmail' },
  providers: [TWILIO, SMTP, NTFY],
  groups: [
    { id: 'family', name: 'Family', sms: ['+16785550101', '+16785550102'], email: ['a@example.com'], telegram: [], ntfy: ['home-alerts', 'garage'] },
    { id: 'neighbours', name: 'Neighbours', sms: [], email: ['n@example.com'], telegram: [], ntfy: [] },
  ],
  switches: [{
    id: '6f1c2a9e-2b1c-4b8f-9d1e-0c5a1e2f3a4b',
    name: 'Water Leak Alert',
    actions: [
      { providerId: 'twilio-main', channel: 'sms', groups: ['family'], body: 'Water at {{time}}.' },
      { providerId: 'fastmail', channel: 'email', groups: ['family'], subject: 'Leak', body: 'Water at {{time}}.' },
      { providerId: 'ntfy-home', channel: 'ntfy', groups: ['family'], subject: 'Leak', body: 'Water at {{time}}.' },
    ],
  }],
};

/** The text of a field's label without the required star. */
const labelOf = (locator) => locator.locator('.form-label').first().evaluate((node) => node.firstChild.textContent);

async function pushedActions(page, predicate) {
  await page.waitForFunction(predicate);
  return page.evaluate(() => window.__hb.updates.at(-1)[0].switches[0].actions);
}

test('switch editor: recipients with counts, Send by with counts, one message and subject, the preview line, and the actions written', async (t) => {
  const browser = await launchOrSkip(t);
  if (!browser) {
    return;
  }
  try {
    const page = await openSettings(browser, CONFIG);
    assert.equal(await page.locator('#section-switches .section-copy').textContent(),
      'Each switch appears in the Home app. Turning it on sends your message to everyone in the groups you pick, on every channel they have, '
      + 'then the switch turns itself off.');
    const sw = page.locator('.card[data-path="switches[0]"]');
    assert.equal(await sw.locator('.action-card').count(), 0, 'no per-action editor');
    assert.equal(await sw.getByRole('button', { name: 'Add action' }).count(), 0);
    assert.equal(await sw.locator('.coverage-warning').count(), 0);

    // The card's fields in shell order (SPEC section 11.2, items 8 and 28): Name, Enabled, Cooldown and Failure Mode on one row,
    // Failure Sensor, then the editor blocks; the id is under Advanced, read-only, with its caption and no Edit link.
    const bodyOrder = await sw.locator('.card-body').evaluate((body) => [...body.children].slice(0, 6).map((node) => {
      const cells = [...node.querySelectorAll(':scope > [class^="ns-span-"]')];
      return cells.length > 0 ? cells.map((cell) => `${cell.className}:${cell.firstElementChild.dataset.path}`).join(' ') : node.dataset.path ?? node.className;
    }));
    assert.deepEqual(bodyOrder, [
      'switches[0].name', 'switches[0].enabled', 'ns-span-6:switches[0].cooldownSeconds ns-span-6:switches[0].failureMode', 'switches[0].failureSensor',
      'ns-span-6:switches[0].failureSensorResetSeconds', 'ns-switch-editor',
    ]);
    assert.equal(await sw.locator('[data-path="switches[0].enabled"] .ns-help').textContent(),
      'A disabled switch still appears in the Home app but does nothing when turned on.');
    assert.equal(await sw.locator('.card-body > [data-path="switches[0].id"], .card-body > .switch-id').count(), 0, 'no id line in the body');
    const idField = sw.locator('details.ns-advanced [data-path="switches[0].id"]');
    assert.equal(await idField.locator('input').inputValue(), '6f1c2a9e-2b1c-4b8f-9d1e-0c5a1e2f3a4b');
    assert.equal(await idField.locator('input').evaluate((node) => node.readOnly), true);
    assert.equal(await idField.locator('label').textContent(), 'ID');
    assert.equal(await idField.locator('.ns-help').textContent(), 'Generated. HomeKit tracks the switch by this id, so you can rename it freely.');
    assert.equal(await idField.locator('.ns-id-edit').count(), 0, 'no Edit link on the switch id');
    assert.equal(await idField.evaluate((node) => node.parentElement.className), 'ns-span-12');
    const describe = (cells) => cells
      .map((cell) => `${cell.className}:${cell.firstElementChild?.dataset.path ?? cell.firstElementChild?.className ?? cell.tagName}`);
    const advancedOrder = await sw.locator('details.ns-advanced > div > .ns-grid > *').evaluateAll(describe);
    assert.deepEqual(advancedOrder, [
      'ns-span-12:switches[0].id', 'ns-span-12:switches[0].customize', 'ns-span-12:ns-per-channel', 'ns-span-12:ns-grid ns-provider-row',
      'ns-span-12:ns-grid ns-ntfy-options', 'ns-span-12:switches[0].bcc',
    ], 'ID, Customize, the per-channel messages, the provider row, the Priority and Tags row, BCC');
    assert.deepEqual(await sw.locator('details.ns-advanced .ns-provider-row > *').evaluateAll(describe), [
      'ns-span-6:switches[0].providers.sms', 'ns-span-6:switches[0].providers.email', 'ns-span-6:switches[0].providers.telegram',
      'ns-span-6:switches[0].providers.ntfy', ':SPAN',
    ], 'a provider dropdown per channel at 6 columns, then the Sender slot');
    assert.deepEqual(await sw.locator('details.ns-advanced .ns-ntfy-options > *').evaluateAll(describe),
      ['ns-span-6 ns-ntfy-option:switches[0].priority', 'ns-span-6 ns-ntfy-option:switches[0].tags'], 'Priority and Tags share a row');
    // Blocks: a bold heading with the caption directly under it.
    for (const [block, title, caption] of [
      ['.ns-recipients', 'Recipients', 'Everyone in the groups you tick gets the message on every channel they have an address for.'],
      ['.ns-extra-recipients-block', 'Extra recipients', 'People outside the groups above, entered under their channel.'],
      ['.ns-send-by', 'Send by', 'Untick a channel to skip it for this switch.'],
    ]) {
      assert.equal(await sw.locator(`${block} .ns-block-title`).textContent(), title);
      assert.equal(await sw.locator(`${block} .ns-block-title + .ns-block-caption`).textContent(), caption);
    }
    assert.deepEqual(await sw.locator('.ns-extra-recipients > *').evaluateAll((nodes) => nodes.map((node) => node.className.split(' ')[0])),
      ['ns-span-6', 'ns-span-6', 'ns-span-6'], 'extra lists at 6 columns');
    const sendByCells = sw.locator('.ns-send-by-rows > *').evaluateAll((nodes) => nodes.map((node) => node.className));
    assert.deepEqual(await sendByCells, ['ns-span-4', 'ns-span-4', 'ns-span-4']);

    // Recipients: group checkboxes with per-channel counts, then extra addresses by channel.
    const groups = sw.locator('.ns-recipient-groups');
    assert.deepEqual(await groups.locator('.form-check-label').allTextContents(), ['Family: 2 SMS, 1 email, 2 ntfy', 'Neighbours: 1 email']);
    assert.deepEqual(await groups.locator('input').evaluateAll((nodes) => nodes.map((node) => node.checked)), [true, false]);
    assert.equal(await sw.locator('.ns-recipients .ns-help').first().textContent(),
      'Everyone in the groups you tick gets the message on every channel they have an address for.');
    assert.deepEqual(await sw.locator('.ns-extra-channel').evaluateAll((nodes) => nodes.map((node) => node.dataset.channel)), ['sms', 'email', 'ntfy'],
      'one list per channel a provider can send on');
    assert.deepEqual(await sw.locator('.ns-extra-channel .fw-semibold').allTextContents(), ['Phone numbers (SMS)', 'Email addresses', 'ntfy topics']);

    // Send by: one checkbox per channel present, all ticked, with the resolved count.
    const sendBy = sw.locator('.ns-send-by');
    assert.deepEqual(await sendBy.locator('.form-check-label').allTextContents(), ['SMS (2 numbers)', 'Email (1 address)', 'ntfy (2 topics)']);
    assert.deepEqual(await sendBy.locator('input').evaluateAll((nodes) => nodes.map((node) => node.checked)), [true, true, true]);
    assert.equal(await sendBy.locator('.ns-help').textContent(), 'Untick a channel to skip it for this switch.');

    // Message: one body with the SMS counter, one subject with its help.
    const body = sw.locator('[data-path="switches[0].body"]');
    assert.equal(await labelOf(body), 'Message');
    assert.equal(await body.locator('textarea').inputValue(), 'Water at {{time}}.');
    assert.equal(await body.locator('.sms-counter').isVisible(), true);
    assert.equal(await body.locator('.ns-help').textContent(), 'Up to 160 plain characters. Emoji and special symbols are not allowed for SMS.');
    const subject = sw.locator('[data-path="switches[0].subject"]');
    assert.equal(await subject.locator('label').first().textContent(), 'Subject');
    assert.equal(await subject.locator('input').inputValue(), 'Leak');
    assert.equal(await subject.locator('.ns-help').textContent(), 'Used as the email subject and the ntfy title. Defaults to the switch name.');
    const preview = sw.locator('.ns-send-preview');
    assert.equal(await preview.textContent(), 'Will send SMS via Twilio to 2 numbers, email via Fastmail to 1 address, ntfy via ntfy to 2 topics.');
    assert.equal(await sw.locator('details.ns-advanced[data-advanced="switches[0]"]').evaluate((node) => node.open), false, 'Advanced starts collapsed');

    // Ticking a group updates the counts and the preview; the written actions carry both groups on every channel.
    await groups.locator('input').nth(1).check();
    assert.deepEqual(await sendBy.locator('.form-check-label').allTextContents(), ['SMS (2 numbers)', 'Email (2 addresses)', 'ntfy (2 topics)']);
    assert.equal(await preview.textContent(), 'Will send SMS via Twilio to 2 numbers, email via Fastmail to 2 addresses, ntfy via ntfy to 2 topics.');
    let actions = await pushedActions(page, () => window.__hb.updates.at(-1)?.[0].switches[0].actions[0].groups.length === 2);
    assert.deepEqual(actions.map((a) => a.groups), [['family', 'neighbours'], ['family', 'neighbours'], ['family', 'neighbours']]);

    // Unticking SMS hides the counter, swaps the help, drops the SMS action, and keeps the stored order of the rest.
    await sendBy.locator('[data-path="switches[0].channels.sms"] input').uncheck();
    assert.equal(await body.locator('.sms-counter').isVisible(), false);
    assert.equal(await body.locator('.ns-help').textContent(), 'Plain text.');
    assert.equal(await preview.textContent(), 'Will send email via Fastmail to 2 addresses, ntfy via ntfy to 2 topics.');
    actions = await pushedActions(page, () => window.__hb.updates.at(-1)?.[0].switches[0].actions.length === 2);
    assert.deepEqual(actions.map((a) => a.channel), ['email', 'ntfy']);
    assert.equal(await page.evaluate(() => window.__hb.save.at(-1)), true);
    await sendBy.locator('[data-path="switches[0].channels.sms"] input').check();
    actions = await pushedActions(page, () => window.__hb.updates.at(-1)?.[0].switches[0].actions.length === 3);
    assert.deepEqual(actions.map((a) => a.channel), ['sms', 'email', 'ntfy'], 'ticking it back restores the stored order');

    // Without email or ntfy the Subject field goes away.
    await sendBy.locator('[data-path="switches[0].channels.email"] input').uncheck();
    await sendBy.locator('[data-path="switches[0].channels.ntfy"] input').uncheck();
    assert.equal(await subject.isVisible(), false);
    assert.equal(await preview.textContent(), 'Will send SMS via Twilio to 2 numbers.');
    await sendBy.locator('[data-path="switches[0].channels.email"] input').check();
    assert.equal(await subject.isVisible(), true);
    await sendBy.locator('[data-path="switches[0].channels.ntfy"] input').check();

    // Extra recipients count into the channel and the Test send confirmation covers every enabled channel.
    const extraSms = sw.locator('[data-path="switches[0].recipients.sms"]');
    await extraSms.getByRole('button', { name: 'Add phone number' }).click();
    await extraSms.locator('input.phone-national').fill('305 555 0123');
    await extraSms.locator('input.phone-national').blur();
    assert.deepEqual(await sendBy.locator('.form-check-label').allTextContents(), ['SMS (3 numbers)', 'Email (2 addresses)', 'ntfy (2 topics)']);
    actions = await pushedActions(page, () => window.__hb.updates.at(-1)?.[0].switches[0].actions[0].recipients.length === 1);
    assert.deepEqual(actions[0].recipients, ['+13055550123']);
    await page.waitForFunction(() => !document.querySelector('.card[data-path="switches[0]"] .ns-test-send button').disabled);
    await sw.locator('.ns-test-send').getByRole('button', { name: 'Test send' }).click();
    assert.equal(await sw.locator('.ns-confirm-question').textContent(), 'Send to 7 recipients now?');
    await page.keyboard.press('Escape');

    // Every channel unticked: the error sits on Send by. Nobody to reach at all: no channel is listed and the error sits on Recipients.
    for (const channel of ['sms', 'email', 'ntfy']) {
      await sendBy.locator(`[data-path="switches[0].channels.${channel}"] input`).uncheck();
    }
    assert.equal(await sendBy.locator(':scope > .invalid-feedback').textContent(), 'Turn on at least one channel.');
    assert.equal(await preview.textContent(), 'Nothing will be sent yet.');
    assert.equal(await sw.locator('.ns-test-send-hint').textContent(), 'Fix the errors above first');
    for (const channel of ['sms', 'email', 'ntfy']) {
      await sendBy.locator(`[data-path="switches[0].channels.${channel}"] input`).check();
    }
    await groups.locator('input').nth(0).uncheck();
    await groups.locator('input').nth(1).uncheck();
    await extraSms.getByRole('button', { name: /Remove/ }).click();
    assert.deepEqual(await sendBy.locator('.form-check-label').allTextContents(), [], 'no channel is reachable any more');
    assert.equal(await sendBy.locator('.ns-send-by-empty').isVisible(), true);
    assert.equal(await sendBy.locator('.ns-send-by-empty').textContent(), 'Pick a group or add an extra recipient to choose how to send.');
    assert.equal(await groups.locator(':scope > .invalid-feedback').textContent(), 'Pick at least one group, or add an extra recipient.');
    // Ticking a group again brings its channels back ticked by default.
    await groups.locator('input').nth(1).check();
    assert.deepEqual(await sendBy.locator('.form-check-label').allTextContents(), ['Email (1 address)']);
    assert.deepEqual(await sendBy.locator('input').evaluateAll((nodes) => nodes.map((node) => node.checked)), [true]);
  } finally {
    await browser.close();
  }
});

test('switch editor advanced: customize per channel, provider override naming the platform default, BCC, ntfy options; reloading reverses it', async (t) => {
  const browser = await launchOrSkip(t);
  if (!browser) {
    return;
  }
  try {
    const page = await openSettings(browser, CONFIG);
    const sw = page.locator('.card[data-path="switches[0]"]');
    const advanced = sw.locator('details.ns-advanced[data-advanced="switches[0]"]');
    await advanced.locator('summary').click();
    // Provider dropdowns only for channels with more than one provider, defaulting to the platform default.
    assert.equal(await sw.locator('[data-path="switches[0].providers.sms"]').isVisible(), false);
    assert.equal(await sw.locator('[data-path="switches[0].providers.ntfy"]').isVisible(), false);
    const emailProvider = sw.locator('[data-path="switches[0].providers.email"]');
    assert.equal(await emailProvider.isVisible(), true);
    assert.equal(await emailProvider.locator('label').first().textContent(), 'Email provider');
    assert.deepEqual(await emailProvider.locator('option').allTextContents(), ['Platform default (Fastmail)', 'Twilio (Twilio)', 'Fastmail (SMTP)']);
    assert.equal(await emailProvider.locator('select').inputValue(), '');
    assert.equal(await emailProvider.locator('.ns-help').textContent(), 'For this switch only. The default for every switch is under Settings.');
    assert.equal(await sw.locator('[data-path="switches[0].bcc"]').isVisible(), true);
    assert.equal(await sw.locator('[data-path="switches[0].priority"]').isVisible(), true);
    assert.equal(await sw.locator('[data-path="switches[0].tags"]').isVisible(), true);
    assert.equal(await sw.locator('.ns-per-channel').isVisible(), false, 'per-channel messages wait for Customize');

    // Customize message per channel: the per-channel fields start as copies of the shared message.
    const customize = sw.locator('[data-path="switches[0].customize"]');
    assert.equal(await customize.locator('label').textContent(), 'Customize message per channel');
    await customize.locator('input').check();
    const card = page.locator('.card[data-path="switches[0]"]');
    assert.equal(await card.locator('[data-path="switches[0].body"]').isVisible(), false);
    assert.equal(await card.locator('[data-path="switches[0].subject"]').isVisible(), false);
    assert.deepEqual(await card.locator('.ns-channel-message:visible .form-label').evaluateAll((nodes) => nodes.map((node) => node.firstChild.textContent)),
      ['SMS message', 'Email subject', 'Email message', 'ntfy title', 'ntfy message']);
    assert.equal(await card.locator('[data-path="switches[0].bodies.sms"] textarea').inputValue(), 'Water at {{time}}.');
    assert.equal(await card.locator('[data-path="switches[0].bodies.sms"] .sms-counter').isVisible(), true, 'the SMS counter follows the SMS message');
    assert.equal(await card.locator('[data-path="switches[0].bodies.email"] .sms-counter').isVisible(), false);
    assert.equal(await card.locator('[data-path="switches[0].subjects.email"] input').inputValue(), 'Leak');
    await card.locator('[data-path="switches[0].bodies.sms"] textarea').fill('Leak! Check the kitchen.');
    await card.locator('[data-path="switches[0].subjects.ntfy"] input').fill('Kitchen leak');
    await card.locator('[data-path="switches[0].providers.email"] select').selectOption('twilio-main');
    await page.locator('.card[data-path="switches[0]"] [data-path="switches[0].bcc"] input').check();
    await page.locator('.card[data-path="switches[0]"] [data-path="switches[0].priority"] select').selectOption('high');
    await page.locator('.card[data-path="switches[0]"] [data-path="switches[0].tags"] input').fill('warning, house');
    const actions = await pushedActions(page, () => window.__hb.updates.at(-1)?.[0].switches[0].actions[2]?.tags?.length === 2);
    assert.deepEqual(actions, [
      { providerId: 'twilio-main', channel: 'sms', groups: ['family'], recipients: [], body: 'Leak! Check the kitchen.' },
      { providerId: 'twilio-main', channel: 'email', groups: ['family'], recipients: [], subject: 'Leak', bcc: true, body: 'Water at {{time}}.' },
      {
        providerId: 'ntfy-home', channel: 'ntfy', groups: ['family'], recipients: [], subject: 'Kitchen leak', priority: 'high', tags: ['warning', 'house'],
        body: 'Water at {{time}}.',
      },
    ]);
    assert.equal(await page.locator('.card[data-path="switches[0]"] .ns-send-preview').textContent(),
      'Will send SMS via Twilio to 2 numbers, email via Twilio to 1 address, ntfy via ntfy to 2 topics.');
    const written = await page.evaluate(() => window.__hb.updates.at(-1)[0]);
    await page.close();

    // Loading what was written reverses it: Customize on, the override selected, Advanced open.
    const again = await openSettings(browser, written);
    const loaded = again.locator('.card[data-path="switches[0]"]');
    assert.equal(await loaded.locator('[data-path="switches[0].customize"] input').isChecked(), true);
    assert.equal(await loaded.locator('details.ns-advanced[data-advanced="switches[0]"]').evaluate((node) => node.open), true);
    assert.equal(await loaded.locator('[data-path="switches[0].bodies.sms"] textarea').inputValue(), 'Leak! Check the kitchen.');
    assert.equal(await loaded.locator('[data-path="switches[0].subjects.ntfy"] input').inputValue(), 'Kitchen leak');
    assert.equal(await loaded.locator('[data-path="switches[0].providers.email"] select').inputValue(), 'twilio-main');
    assert.equal(await loaded.locator('[data-path="switches[0].bcc"] input').isChecked(), true);
    assert.equal(await loaded.locator('[data-path="switches[0].tags"] input').inputValue(), 'warning, house');
    // Turning Customize off goes back to the one shared message.
    await loaded.locator('[data-path="switches[0].customize"] input').uncheck();
    assert.equal(await loaded.locator('[data-path="switches[0].body"]').isVisible(), true);
    await again.waitForFunction(() => window.__hb.updates.at(-1)?.[0].switches[0].actions[1].body === 'Leak! Check the kitchen.');
    const shared = await again.evaluate(() => window.__hb.updates.at(-1)[0].switches[0].actions.map((a) => [a.body, a.subject]));
    assert.deepEqual(shared, [['Leak! Check the kitchen.', undefined], ['Leak! Check the kitchen.', 'Leak'], ['Leak! Check the kitchen.', 'Leak']],
      'the first channel\'s message and subject become the shared ones');
  } finally {
    await browser.close();
  }
});

test('switch editor: a new switch starts empty; a provider a hand-edited action names but that is gone is reported on the override', async (t) => {
  const browser = await launchOrSkip(t);
  if (!browser) {
    return;
  }
  try {
    const page = await openSettings(browser, CONFIG);
    await page.getByRole('button', { name: 'Add switch' }).click();
    const sw = page.locator('.card[data-path="switches[1]"]');
    assert.deepEqual(await sw.locator('.ns-send-by .form-check-label').allTextContents(), []);
    assert.equal(await sw.locator('.ns-send-by-empty').isVisible(), true);
    assert.equal(await sw.locator('[data-path="switches[1].subject"]').isVisible(), false);
    assert.equal(await sw.locator('.ns-send-preview').textContent(), 'Nothing will be sent yet.');
    await sw.locator('[data-path="switches[1].name"] input').fill('Smoke Alarm');
    await sw.locator('.ns-recipient-groups input').first().check();
    assert.deepEqual(await sw.locator('.ns-send-by .form-check-label').allTextContents(), ['SMS (2 numbers)', 'Email (1 address)', 'ntfy (2 topics)']);
    assert.deepEqual(await sw.locator('.ns-send-by input').evaluateAll((nodes) => nodes.map((node) => node.checked)), [true, true, true],
      'all ticked by default');
    await sw.locator('[data-path="switches[1].body"] textarea').fill('Smoke!');
    await page.waitForFunction(() => window.__hb.updates.at(-1)?.[0].switches[1]?.actions.length === 3);
    assert.deepEqual(await page.evaluate(() => window.__hb.updates.at(-1)[0].switches[1].actions), [
      { providerId: 'twilio-main', channel: 'sms', groups: ['family'], recipients: [], body: 'Smoke!' },
      { providerId: 'fastmail', channel: 'email', groups: ['family'], recipients: [], body: 'Smoke!' },
      { providerId: 'ntfy-home', channel: 'ntfy', groups: ['family'], recipients: [], body: 'Smoke!' },
    ], 'one action per channel with the platform defaults');
    await page.waitForFunction(() => window.__hb.save.at(-1) === true);
    await page.close();

    // A stored action naming a provider that no longer exists, while another can send on the channel: the override shows it as
    // missing with an error and nothing is dropped.
    const stale = {
      ...CONFIG,
      providers: [...CONFIG.providers, TELEGRAM],
      switches: [{ ...CONFIG.switches[0], actions: [{ providerId: 'old-bot', channel: 'telegram', groups: ['family'], recipients: ['5551'], body: 'Hi' }] }],
    };
    const page2 = await openSettings(browser, stale);
    const override = page2.locator('[data-path="switches[0].providers.telegram"]');
    assert.equal(await override.isVisible(), true);
    assert.equal(await override.locator('select').inputValue(), 'old-bot');
    assert.deepEqual(await override.locator('option').allTextContents(), ['Platform default (Telegram)', 'Telegram (Telegram)', 'old-bot (missing)']);
    await page2.waitForFunction(() => window.__hb.save.at(-1) === false);
    assert.equal(await page2.locator('.issues .ns-issue-link[data-issue-path="switches[0].providers.telegram"]').textContent(),
      'Switch 1 "Water Leak Alert": Provider "old-bot" does not exist.');
    await page2.waitForFunction(() => window.__hb.updates.length > 0);
    assert.deepEqual(await page2.evaluate(() => window.__hb.updates.at(-1)[0].switches[0].actions),
      [{ providerId: 'old-bot', channel: 'telegram', groups: ['family'], recipients: ['5551'], body: 'Hi' }]);
  } finally {
    await browser.close();
  }
});
