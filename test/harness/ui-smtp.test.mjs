import assert from 'node:assert/strict';
import { test } from 'node:test';
import { URL } from 'node:url';

import { launchOrSkip, openSettings } from './browser.mjs';
import { SMTP } from './helpers.mjs';

/**
 * The SMTP card's Mail provider preset picker (SPEC section 11.2, item 22): presets fill and lock host, port
 * and security with an Edit link to unlock, Other leaves them editable, the password help names the chosen
 * provider and links to its app-password page, and the preset key is stored as `smtpPreset` for redisplay.
 */

const CONFIG = {
  platform: 'NotifySwitch',
  name: 'Notify Switch',
  defaultCountry: 'US',
  providers: [SMTP],
  groups: [{ id: 'family', name: 'Family', sms: [], email: ['a@example.com'], telegram: [] }],
  switches: [{
    id: '6f1c2a9e-2b1c-4b8f-9d1e-0c5a1e2f3a4b',
    name: 'Water Leak Alert',
    actions: [{ providerId: 'fastmail', channel: 'email', groups: ['family'], body: 'Water detected.' }],
  }],
};

const CARD = '.card[data-path="providers[0]"]';

test('smtp presets: choosing a preset fills and locks the server settings, Edit unlocks, Other leaves them editable', async (t) => {
  const browser = await launchOrSkip(t);
  if (!browser) {
    return;
  }
  try {
    const page = await openSettings(browser, CONFIG);
    const card = page.locator(CARD);
    const host = card.locator('[data-path="providers[0].host"] input');
    const port = card.locator('[data-path="providers[0].port"] input');
    const security = card.locator('[data-path="providers[0].security"] select');
    const passwordHelp = card.locator('[data-path="providers[0].password"] .ns-help');
    const edit = card.locator('.ns-server-edit');
    // No preset stored: Other, everything editable, the generic password help with the README link.
    assert.equal(await card.locator('.ns-preset-segments input:checked').getAttribute('value'), 'other');
    assert.equal(await host.evaluate((node) => node.readOnly), false);
    assert.equal(await edit.isVisible(), false);
    assert.equal(await passwordHelp.textContent(), 'Use an app password, not your login password. Most providers require it. Where do I create one?');
    assert.equal(await passwordHelp.locator('a').getAttribute('href'), 'https://github.com/arodbuilds/homebridge-notify-switch#app-passwords');

    // Gmail: host, port and security filled and locked; the help names Google, notes 2-Step Verification, and links to its page.
    await card.locator('.ns-preset-segments label', { hasText: 'Gmail' }).click();
    assert.equal(await host.inputValue(), 'smtp.gmail.com');
    assert.equal(await port.inputValue(), '465');
    assert.equal(await security.inputValue(), 'ssl');
    assert.equal(await host.evaluate((node) => node.readOnly), true, 'locked');
    assert.equal(await port.evaluate((node) => node.readOnly), true);
    assert.equal(await security.isDisabled(), true);
    assert.equal(await edit.isVisible(), true);
    assert.equal(await card.locator('.ns-server-help').textContent(), 'Filled in from the mail provider above. Click Edit to change them.');
    // Host, Port and Security share one row at 7, 2 and 3 columns; the help sits under the whole row (SPEC section 11.2, item 22).
    const serverRow = card.locator('.ns-server-help').evaluate((help) => {
      const row = help.previousElementSibling;
      return [...row.children].map((cell) => [cell.className, cell.firstElementChild.dataset.path]);
    });
    assert.deepEqual(await serverRow, [['ns-span-7', 'providers[0].host'], ['ns-span-2', 'providers[0].port'], ['ns-span-3', 'providers[0].security']]);
    assert.equal(await card.locator('.ns-server-help').evaluate((help) => help.parentElement.classList.contains('card-body')), true, 'not inside one column');
    // Advanced: ID and Credentials File side by side (item 28).
    const advancedCells = card.locator('details.ns-advanced .ns-grid > *').evaluateAll((nodes) => nodes.map((node) => node.className));
    assert.deepEqual(await advancedCells, ['ns-span-6', 'ns-span-6']);
    assert.match(await passwordHelp.textContent(), /^Use a Google app password, not your login password\. 2-Step Verification must be on first/);
    assert.equal(await passwordHelp.locator('a').textContent(), 'Create one at Google');
    assert.equal(await passwordHelp.locator('a').getAttribute('href'), 'https://myaccount.google.com/apppasswords');
    await page.waitForFunction(() => window.__hb.updates.at(-1)?.[0].providers[0].smtpPreset === 'gmail');
    const pushed = await page.evaluate(() => window.__hb.updates.at(-1)[0].providers[0]);
    assert.equal(pushed.host, 'smtp.gmail.com');
    assert.equal(pushed.port, 465);
    assert.equal(pushed.security, 'ssl');

    // iCloud switches to STARTTLS on 587; Edit unlocks the fields while the preset stays for the help.
    await card.locator('.ns-preset-segments label', { hasText: 'iCloud' }).click();
    assert.equal(await host.inputValue(), 'smtp.mail.me.com');
    assert.equal(await port.inputValue(), '587');
    assert.equal(await security.inputValue(), 'starttls');
    assert.equal(await passwordHelp.locator('a').getAttribute('href'), 'https://account.apple.com/account/manage');
    await edit.click();
    assert.equal(await host.evaluate((node) => node.readOnly), false, 'Edit unlocks');
    assert.equal(await security.isDisabled(), false);
    assert.equal(await edit.isVisible(), false);
    await host.fill('smtp.custom.example.com');
    await page.waitForFunction(() => window.__hb.updates.at(-1)?.[0].providers[0].host === 'smtp.custom.example.com');
    assert.equal(await page.evaluate(() => window.__hb.updates.at(-1)[0].providers[0].smtpPreset), 'icloud');

    // Other: nothing is overwritten, everything editable, the generic help is back and no preset is stored.
    await card.locator('.ns-preset-segments label', { hasText: 'Other' }).click();
    assert.equal(await host.inputValue(), 'smtp.custom.example.com');
    assert.equal(await host.evaluate((node) => node.readOnly), false);
    assert.equal(await passwordHelp.locator('a').textContent(), 'Where do I create one?');
    await page.waitForFunction(() => window.__hb.updates.at(-1)?.[0].providers[0].smtpPreset === undefined);

    // Every preset has a text label, no logo, and a direct app-password link.
    const labels = await card.locator('.ns-preset-segments label').allTextContents();
    assert.deepEqual(labels, ['Fastmail', 'Gmail', 'iCloud', 'Outlook.com', 'Yahoo', 'Zoho', 'Other']);
    assert.equal(await card.locator('.ns-preset-segments img, .ns-preset-segments svg').count(), 0);
    for (const label of ['Fastmail', 'Outlook.com', 'Yahoo', 'Zoho']) {
      await card.locator('.ns-preset-segments label', { hasText: label }).click();
      assert.match(await passwordHelp.textContent(), /app password/);
      const href = await passwordHelp.locator('a').getAttribute('href');
      assert.match(href, /^https:\/\//);
      assert.notEqual(new URL(href).hostname, 'github.com', `${label} links to the provider, not the README`);
    }
    // From name help mentions the display name replacement.
    assert.equal(await card.locator('[data-path="providers[0].from.name"] .ns-help').textContent(),
      'Optional. Some providers replace this with your account\'s display name.');
    await page.close();

    // Below 600px the dropdown stands in for the segments and binds to the same value.
    const phone = await openSettings(browser, CONFIG, { viewport: { width: 400, height: 900 } });
    const picker = phone.locator(`${CARD} .ns-preset-picker`);
    assert.equal(await picker.locator('.ns-preset-segments').isVisible(), false);
    assert.equal(await picker.locator('.ns-preset-select').isVisible(), true);
    assert.deepEqual(await picker.locator('.ns-preset-select option').allTextContents(),
      ['Fastmail', 'Gmail', 'iCloud', 'Outlook.com', 'Yahoo', 'Zoho', 'Other']);
    await picker.locator('.ns-preset-select').selectOption('fastmail');
    assert.equal(await phone.locator(`${CARD} [data-path="providers[0].host"] input`).inputValue(), 'smtp.fastmail.com');
    assert.equal(await phone.locator(`${CARD} [data-path="providers[0].host"] input`).evaluate((node) => node.readOnly), true);
    await phone.waitForFunction(() => window.__hb.updates.at(-1)?.[0].providers[0].smtpPreset === 'fastmail');
  } finally {
    await browser.close();
  }
});

test('smtp presets: a stored preset redisplays locked with the stored values; the runtime fields are never rewritten on load', async (t) => {
  const browser = await launchOrSkip(t);
  if (!browser) {
    return;
  }
  try {
    const stored = { ...CONFIG, providers: [{ ...SMTP, smtpPreset: 'fastmail', host: 'smtp.fastmail.example', port: 2525, security: 'starttls' }] };
    const page = await openSettings(browser, stored);
    const card = page.locator(CARD);
    assert.equal(await card.locator('.ns-preset-segments input:checked').getAttribute('value'), 'fastmail');
    assert.equal(await card.locator('[data-path="providers[0].host"] input').inputValue(), 'smtp.fastmail.example', 'the stored host stands');
    assert.equal(await card.locator('[data-path="providers[0].port"] input').inputValue(), '2525');
    assert.equal(await card.locator('[data-path="providers[0].security"] select').inputValue(), 'starttls');
    assert.equal(await card.locator('[data-path="providers[0].host"] input').evaluate((node) => node.readOnly), true);
    assert.equal(await card.locator('[data-path="providers[0].password"] .ns-help a').getAttribute('href'),
      'https://app.fastmail.com/settings/security/devices');
    await page.waitForFunction(() => window.__hb.updates.length > 0);
    const pushed = await page.evaluate(() => window.__hb.updates.at(-1)[0].providers[0]);
    assert.equal(pushed.host, 'smtp.fastmail.example');
    assert.equal(pushed.port, 2525);
    assert.equal(pushed.smtpPreset, 'fastmail');
    // An unknown stored key shows as Other and is dropped.
    await page.close();
    const unknown = await openSettings(browser, { ...CONFIG, providers: [{ ...SMTP, smtpPreset: 'aol' }] });
    assert.equal(await unknown.locator(`${CARD} .ns-preset-segments input:checked`).getAttribute('value'), 'other');
    assert.equal(await unknown.locator(`${CARD} [data-path="providers[0].host"] input`).evaluate((node) => node.readOnly), false);
  } finally {
    await browser.close();
  }
});
