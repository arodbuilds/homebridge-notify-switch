import assert from 'node:assert/strict';
import { test } from 'node:test';

import { launchOrSkip, openSettings } from './browser.mjs';
import { TWILIO } from './helpers.mjs';

/**
 * Card behaviour in the built settings UI (SPEC section 11.2, items 13 to 17): the provider chooser,
 * ids generated from names and hidden under Advanced with an Edit toggle, fresh cards that show no
 * errors until touched, the per-card Show help toggle, the Variables toggle, and the rewritten
 * validation messages.
 */

const CONFIG = {
  platform: 'NotifySwitch',
  name: 'Notify Switch',
  providers: [TWILIO],
  groups: [{ id: 'family', name: 'Family', sms: ['+16785550101'], email: [], telegram: [] }],
  switches: [{
    id: '6f1c2a9e-2b1c-4b8f-9d1e-0c5a1e2f3a4b',
    name: 'Water Leak Alert',
    actions: [{ providerId: 'twilio-main', channel: 'sms', groups: ['family'], body: 'Water detected.' }],
  }],
};

async function pushed(page, predicate) {
  await page.waitForFunction(predicate);
  return page.evaluate(() => window.__hb.updates.at(-1)[0]);
}

test('provider chooser: four tiles create a card with the type fixed, the name prefilled and the id generated', async (t) => {
  const browser = await launchOrSkip(t);
  if (!browser) {
    return;
  }
  try {
    const page = await openSettings(browser, CONFIG);
    assert.equal(await page.locator('select option', { hasText: 'Twilio (SMS and email)' }).count(), 0, 'no Type dropdown on provider cards');
    await page.getByRole('button', { name: 'Add provider' }).click();
    const chooser = page.locator('.ns-chooser');
    assert.equal(await chooser.count(), 1, 'Add provider opens the chooser instead of a card');
    assert.equal(await page.locator('.card[data-path^="providers"]').count(), 1, 'no card was created yet');
    const tiles = chooser.locator('.ns-chooser-tile');
    assert.deepEqual(await tiles.locator('.fw-semibold').allTextContents(), ['Twilio', 'Email (SMTP)', 'Telegram', 'ntfy']);
    assert.deepEqual(await tiles.locator('.ns-secondary').allTextContents(), [
      'SMS text messages, and email if you have a Twilio-authenticated domain.',
      'Send from a mailbox you already have, such as Fastmail, Gmail, iCloud, or Outlook.',
      'Free messages through a bot you create. Best for family group chats.',
      'Free push notifications to the ntfy app. No account needed for public topics.',
    ]);
    await chooser.getByRole('button', { name: 'Cancel' }).click();
    assert.equal(await page.locator('.ns-chooser').count(), 0, 'Cancel restores the button');

    await page.getByRole('button', { name: 'Add provider' }).click();
    await page.locator('.ns-chooser-tile[data-type="smtp"]').click();
    const card = page.locator('.card[data-path="providers[1]"]');
    assert.equal(await card.count(), 1);
    assert.equal(await card.locator('.card-header .badge').textContent(), 'SMTP', 'the type badge stays in the header and reads SMTP');
    assert.equal(await card.locator('[data-path="providers[1].name"] input').inputValue(), 'Email');
    assert.equal(await card.locator('select option', { hasText: 'SMTP (email)' }).count(), 0, 'the type cannot be changed');
    assert.equal(await card.locator('.card-body > [data-path="providers[1].id"]').count(), 0, 'the ID is not in the main form');
    const advanced = card.locator('details.ns-advanced[data-advanced="providers[1]"]');
    assert.equal(await advanced.evaluate((node) => node.open), false);
    const idInput = advanced.locator('[data-path="providers[1].id"] input');
    assert.equal(await idInput.inputValue(), 'email', 'the id is generated from the name');
    assert.equal(await idInput.evaluate((node) => node.readOnly), true, 'read-only until Edit is clicked');
    let config = await pushed(page, () => window.__hb.updates.at(-1)?.[0].providers.length === 2);
    assert.equal(config.providers[1].id, 'email');
    assert.equal(config.providers[1].type, 'smtp');
    assert.equal(config.providers[1].name, 'Email');
    // The Mail provider picker sits at the top of the SMTP card (SPEC section 11.2, item 22): segments on a wide screen, Other selected.
    const picker = card.locator('.ns-preset-picker');
    assert.equal(await picker.locator('.form-label').textContent(), 'Mail provider');
    assert.deepEqual(await picker.locator('.ns-preset-segments label').allTextContents(),
      ['Fastmail', 'Gmail', 'iCloud', 'Outlook.com', 'Yahoo', 'Zoho', 'Other']);
    assert.equal(await picker.locator('.ns-preset-segments').isVisible(), true);
    assert.equal(await picker.locator('.ns-preset-select').isVisible(), false, 'the dropdown is for narrow screens');
    assert.equal(await picker.locator('.ns-preset-segments input:checked').getAttribute('value'), 'other');
    assert.equal(await card.locator('details.ns-common-settings').count(), 0, 'the Common settings table is gone');
    assert.equal(await card.locator('.ns-server-help').textContent(),
      'Your mail provider\'s outgoing server settings. For example: smtp.fastmail.com, 465, SSL.');
    assert.equal(await card.locator('[data-path="providers[1].host"] input').evaluate((node) => node.readOnly), false, 'Other leaves the server editable');

    // A second Twilio provider gets a numeric suffix; the existing one is twilio-main, so the first is plain twilio.
    await page.getByRole('button', { name: 'Add provider' }).click();
    await page.locator('.ns-chooser-tile[data-type="twilio"]').click();
    await page.getByRole('button', { name: 'Add provider' }).click();
    await page.locator('.ns-chooser-tile[data-type="twilio"]').click();
    config = await pushed(page, () => window.__hb.updates.at(-1)?.[0].providers.length === 4);
    assert.deepEqual(config.providers.map((p) => p.id), ['twilio-main', 'email', 'twilio', 'twilio-2']);
    assert.deepEqual(config.providers.map((p) => p.name), ['Twilio', 'Email', 'Twilio', 'Twilio']);
    assert.equal(await page.locator('.card[data-path="providers[3]"] .card-header .badge').textContent(), 'Twilio');

    // The chooser's Cancel is an outlined secondary button, and the tiles fill the width in four equal columns (SPEC section 11.2, item 13).
    await page.getByRole('button', { name: 'Add provider' }).click();
    assert.match(await page.locator('.ns-chooser').getByRole('button', { name: 'Cancel' }).getAttribute('class'), /\bbtn-outline-secondary\b/);
    const tileBoxes = async () => page.locator('.ns-chooser .ns-chooser-tile').evaluateAll((nodes) => nodes.map((node) => {
      const rect = node.getBoundingClientRect();
      return { top: Math.round(rect.top), width: Math.round(rect.width), left: Math.round(rect.left) };
    }));
    const tilesWidth = Math.round((await page.locator('.ns-chooser .ns-chooser-tiles').boundingBox()).width);
    let boxes = await tileBoxes();
    assert.equal(new Set(boxes.map((b) => b.top)).size, 1, 'four across at 900px');
    assert.ok(boxes.every((b) => Math.abs(b.width - boxes[0].width) <= 1), `equal columns: ${boxes.map((b) => b.width).join(', ')}`);
    const last = boxes[boxes.length - 1];
    assert.ok(Math.abs(last.left + last.width - boxes[0].left - tilesWidth) <= 1, 'the tiles fill the card width');
    await page.setViewportSize({ width: 700, height: 900 });
    boxes = await tileBoxes();
    assert.equal(new Set(boxes.map((b) => b.top)).size, 2, 'two rows between 600px and 768px');
    await page.setViewportSize({ width: 400, height: 900 });
    boxes = await tileBoxes();
    assert.equal(new Set(boxes.map((b) => b.left)).size, 1, 'stacked below 600px');
    assert.ok(boxes[0].top < boxes[1].top && boxes[1].top < boxes[2].top && boxes[2].top < boxes[3].top);
    await page.setViewportSize({ width: 900, height: 900 });
  } finally {
    await browser.close();
  }
});

test('fresh cards: no errors until a field is touched, then errors appear; the id follows the name until referenced or edited', async (t) => {
  const browser = await launchOrSkip(t);
  if (!browser) {
    return;
  }
  try {
    const page = await openSettings(browser, CONFIG);
    assert.equal(await page.locator('.issues').isHidden(), true, 'the loaded configuration is valid');
    await page.getByRole('button', { name: 'Add provider' }).click();
    await page.locator('.ns-chooser-tile[data-type="twilio"]').click();
    const card = page.locator('.card[data-path="providers[1]"]');
    assert.equal(await card.locator('.is-invalid').count(), 0, 'a new card shows no errors');
    assert.equal(await card.locator('.invalid-feedback:visible').count(), 0);
    assert.equal(await card.locator('[data-path="providers[1].accountSid"] input').getAttribute('placeholder'), 'AC…', 'placeholders instead');
    await page.waitForFunction(() => window.__hb.save.at(-1) === false);
    assert.equal(await page.locator('.issues').isVisible(), true);
    assert.equal(await page.locator('.issues li').count(), 0, 'no issue is listed for the untouched card');
    assert.equal(await page.locator('.issues .fw-semibold').textContent(), 'Fill in the new provider to enable Save.');
    assert.match(await page.locator('.issues').getAttribute('class'), /\balert-info\b/);

    // Touching a field (blur) reveals that field's error, with the rewritten message; the card's other errors go into
    // the issue list but stay off the untouched fields (SPEC section 11.2, item 15).
    const accountSid = card.locator('[data-path="providers[1].accountSid"] input');
    await accountSid.fill('AC12');
    assert.equal(await card.locator('.is-invalid').count(), 0, 'typing alone does not reveal errors');
    await accountSid.blur();
    assert.equal(await card.locator('.is-invalid').count(), 1, 'only the blurred field shows its error');
    assert.equal(await card.locator('[data-path="providers[1].accountSid"] .invalid-feedback').textContent(),
      'That does not look like an Account SID. It starts with AC and is 34 characters; copy it from the Twilio Console.');
    assert.equal(await card.locator('[data-path="providers[1].apiKeySid"] .invalid-feedback').textContent(), '', 'an untouched field shows nothing');
    assert.equal(await page.locator('.issues li').count(), 3, 'the issue list fills in: Account SID, API Key SID, API Key Secret');
    assert.equal(await page.locator('.issues .fw-semibold').textContent(), 'Fix these before saving:', 'three entries are shown in full');
    assert.equal(await page.locator('.issues .ns-issues-toggle').isVisible(), false);
    // Each entry is a link that marks the field touched, focuses it and shows its message.
    const apiKeyLink = page.locator('.issues .ns-issue-link[data-issue-path="providers[1].apiKeySid"]');
    assert.equal(await apiKeyLink.count(), 1);
    await apiKeyLink.click();
    assert.equal(await card.locator('[data-path="providers[1].apiKeySid"] .invalid-feedback').textContent(),
      'That does not look like an API Key SID. It starts with SK and is 34 characters; copy it from the Twilio Console.');
    assert.equal(await card.locator('[data-path="providers[1].apiKeySid"] input').evaluate((node) => node === document.activeElement), true);

    // The id follows the name until the provider is referenced by a switch.
    const name = card.locator('[data-path="providers[1].name"] input');
    const idInput = card.locator('[data-path="providers[1].id"] input');
    await name.fill('Twilio Backup');
    assert.equal(await idInput.inputValue(), 'twilio-backup');
    await pushed(page, () => window.__hb.updates.at(-1)?.[0].providers[1]?.id === 'twilio-backup');
    // The existing provider is referenced by the switch, so renaming it leaves its id alone.
    const existing = page.locator('.card[data-path="providers[0]"]');
    await existing.locator('[data-path="providers[0].name"] input').fill('Twilio Main');
    assert.equal(await existing.locator('[data-path="providers[0].id"] input').inputValue(), 'twilio-main');
    await pushed(page, () => window.__hb.updates.at(-1)?.[0].providers[0]?.name === 'Twilio Main');
    assert.equal(await page.evaluate(() => window.__hb.updates.at(-1)[0].providers[0].id), 'twilio-main');

    // Edit under Advanced makes the id editable; a duplicate is still rejected and the disclosure opens to show it.
    const advanced = card.locator('details.ns-advanced[data-advanced="providers[1]"]');
    await advanced.locator('summary').click();
    await advanced.getByRole('button', { name: 'Edit ID' }).click();
    assert.equal(await idInput.evaluate((node) => node.readOnly), false);
    await idInput.fill('twilio-main');
    await idInput.blur();
    assert.equal(await advanced.locator('[data-path="providers[1].id"] .invalid-feedback').textContent(), 'ID "twilio-main" is used by another provider.');
    await idInput.fill('backup');
    await pushed(page, () => window.__hb.updates.at(-1)?.[0].providers[1]?.id === 'backup');
    await name.fill('Twilio Backup 2');
    assert.equal(await idInput.inputValue(), 'backup', 'a hand-edited id no longer follows the name');
    await advanced.locator('summary').click();
    assert.equal(await advanced.evaluate((node) => node.open), false, 'the disclosure was closed again');
    // Clear the id while the disclosure is closed (as a stale config.json edit would): the issue opens it.
    await idInput.evaluate((node) => {
      node.value = '';
      node.dispatchEvent(new node.ownerDocument.defaultView.Event('input', { bubbles: true }));
    });
    assert.equal(await advanced.evaluate((node) => node.open), true, 'an issue on the ID opens the disclosure');
    assert.equal(await advanced.locator('[data-path="providers[1].id"] .invalid-feedback').textContent(), 'ID is required.');

    // Groups: Add group creates a fresh card whose id follows the name; the ID is under Advanced too.
    await page.getByRole('button', { name: 'Add group' }).click();
    const group = page.locator('.card[data-path="groups[1]"]');
    assert.equal(await group.locator('.is-invalid').count(), 0);
    assert.equal(await group.locator('.card-body > .ns-grid [data-path="groups[1].id"], .card-body > [data-path="groups[1].id"]').count(), 0);
    await group.locator('[data-path="groups[1].name"] input').fill('Neighbours');
    const groupId = group.locator('details.ns-advanced [data-path="groups[1].id"] input');
    assert.equal(await groupId.inputValue(), 'neighbours');
    await pushed(page, () => window.__hb.updates.at(-1)?.[0].groups[1]?.id === 'neighbours');
    await group.locator('[data-path="groups[1].name"] input').fill('Family');
    assert.equal(await groupId.inputValue(), 'family-2', 'a name already used gets a numeric suffix');

    // Switches: a new switch card is fresh as well.
    await page.getByRole('button', { name: 'Add switch' }).click();
    const sw = page.locator('.card[data-path="switches[1]"]');
    assert.equal(await sw.locator('.is-invalid').count(), 0);
    assert.equal(await sw.locator('[data-path="switches[1].groups"] > .invalid-feedback').textContent(), '', 'the recipients message waits too');
    await sw.locator('[data-path="switches[1].name"] input').fill('Bad-Name!');
    await sw.locator('[data-path="switches[1].name"] input').blur();
    assert.equal(await sw.locator('[data-path="switches[1].name"] .invalid-feedback').textContent(),
      'Use letters, numbers, spaces, and apostrophes, starting and ending with a letter or number.');
    assert.equal(await sw.locator('[data-path="switches[1].groups"] > .invalid-feedback').textContent(),
      'Pick at least one group, or add an extra recipient.');
  } finally {
    await browser.close();
  }
});

test('show help toggle and Variables toggle', async (t) => {
  const browser = await launchOrSkip(t);
  if (!browser) {
    return;
  }
  try {
    const page = await openSettings(browser, CONFIG);
    const card = page.locator('.card[data-path="providers[0]"]');
    const toggle = card.locator('.card-header .ns-help-toggle');
    assert.equal(await toggle.textContent(), 'Hide help', 'help is expanded on a wide screen');
    const help = card.locator('[data-path="providers[0].accountSid"] .ns-help');
    assert.equal(await help.isVisible(), true);
    assert.equal(await help.textContent(), 'Copy from the Twilio Console home page. It starts with AC and is not a secret. Where do I find this?');
    assert.equal(await help.locator('a').getAttribute('href'), 'https://github.com/arodbuilds/homebridge-notify-switch#twilio-sms-and-email');
    assert.equal(await card.locator('[data-path="providers[0].apiKeySid"] .ns-help a').textContent(), 'Why not the Auth Token?');
    assert.equal(await card.locator('.ns-senders-note').textContent(),
      'US numbers must be registered for A2P 10DLC or carriers will block messages. How do I register?');
    await toggle.click();
    assert.equal(await toggle.textContent(), 'Show help');
    assert.equal(await help.isVisible(), false, 'field help collapses');
    assert.equal(await card.locator('.phone-feedback').first().isVisible(), true, 'status lines stay visible');
    // The choice is remembered for the card while the page lives, across re-renders.
    await page.getByRole('button', { name: 'Add group' }).click();
    assert.equal(await page.locator('.card[data-path="providers[0]"] .ns-help-toggle').textContent(), 'Show help');
    assert.equal(await page.locator('.card[data-path="groups[0]"] .ns-help-toggle').textContent(), 'Hide help', 'other cards keep their own state');

    // Variables toggle next to the message field lists the four variables; the help itself no longer lists them.
    const message = page.locator('[data-path="switches[0].body"]');
    const bodyHelp = message.locator('.ns-help');
    assert.equal(await bodyHelp.textContent(), 'Up to 160 plain characters. Emoji and special symbols are not allowed for SMS.');
    const variables = message.locator('.ns-variables-toggle');
    assert.equal(await variables.count(), 1);
    assert.equal(await message.getByRole('button', { name: 'Show variables' }).count(), 1);
    assert.match(await variables.getAttribute('class'), /\bbtn-link\b/, 'a link-styled toggle');
    assert.equal(await variables.locator('.ns-chevron').count(), 1, 'with a chevron');
    assert.equal(await message.locator('.ns-variables').isVisible(), false);
    await variables.click();
    assert.equal(await message.locator('.ns-variables').isVisible(), true);
    assert.equal(await variables.textContent(), 'Hide variables');
    assert.equal(await variables.getAttribute('aria-expanded'), 'true');
    assert.deepEqual(await message.locator('.ns-variables code').allTextContents(), ['{{switchName}}', '{{time}}', '{{date}}', '{{datetime}}']);
    assert.equal(await message.locator('.ns-variables a').getAttribute('href'), 'https://github.com/arodbuilds/homebridge-notify-switch#template-variables');
    // The old per-action editor is gone: no Channel dropdown, no action cards, no Add action button.
    assert.equal(await page.locator('.action-card').count(), 0);
    assert.equal(await page.getByRole('button', { name: 'Add action' }).count(), 0);
    await page.close();

    // Below 600px help starts collapsed.
    const phone = await openSettings(browser, CONFIG, { viewport: { width: 360, height: 800 } });
    assert.equal(await phone.locator('.card[data-path="providers[0]"] .ns-help-toggle').textContent(), 'Show help');
    assert.equal(await phone.locator('.card[data-path="providers[0]"] [data-path="providers[0].accountSid"] .ns-help').isVisible(), false);
    await phone.locator('.card[data-path="providers[0]"] .ns-help-toggle').click();
    assert.equal(await phone.locator('.card[data-path="providers[0]"] [data-path="providers[0].accountSid"] .ns-help').isVisible(), true);
  } finally {
    await browser.close();
  }
});
