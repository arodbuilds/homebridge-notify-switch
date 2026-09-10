import assert from 'node:assert/strict';
import { test } from 'node:test';

import { launchOrSkip, openSettings } from './browser.mjs';
import { SMTP, TWILIO } from './helpers.mjs';

/**
 * Provider names (SPEC section 11.2, items 13 and 22): a name the UI fills in follows the SMTP preset until it is
 * hand-edited, the id follows the name, and a prefilled name another provider already uses gets a numeric suffix.
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
    actions: [{ providerId: 'twilio-main', channel: 'sms', groups: ['family'], body: 'Water detected.' }],
  }],
};

async function pushed(page, predicate) {
  await page.waitForFunction(predicate);
  return page.evaluate(() => window.__hb.updates.at(-1)[0]);
}

test('provider names: the SMTP name follows the preset until hand-edited, and the id follows the name', async (t) => {
  const browser = await launchOrSkip(t);
  if (!browser) {
    return;
  }
  try {
    const page = await openSettings(browser, CONFIG);
    await page.getByRole('button', { name: 'Add provider' }).click();
    await page.locator('.ns-chooser-tile[data-type="smtp"]').click();
    const card = page.locator('.card[data-path="providers[1]"]');
    const name = card.locator('[data-path="providers[1].name"] input');
    const id = card.locator('[data-path="providers[1].id"] input');
    const title = card.locator('.card-header .fw-semibold');
    assert.equal(await name.inputValue(), 'Email');
    await card.locator('.ns-preset-segments label', { hasText: 'Gmail' }).click();
    assert.equal(await name.inputValue(), 'Gmail', 'the chooser\'s name follows the preset');
    assert.equal(await id.inputValue(), 'gmail', 'and the id follows the name');
    assert.equal(await title.textContent(), 'Gmail');
    await card.locator('.ns-preset-segments label', { hasText: 'iCloud' }).click();
    assert.equal(await name.inputValue(), 'iCloud', 'an earlier preset\'s name follows the next preset');
    assert.equal(await id.inputValue(), 'icloud');
    await card.locator('.ns-preset-segments label', { hasText: 'Outlook.com' }).click();
    assert.equal(await name.inputValue(), 'Outlook.com');
    assert.equal(await id.inputValue(), 'outlook-com');
    await card.locator('.ns-preset-segments label', { hasText: 'Other' }).click();
    assert.equal(await name.inputValue(), 'Email', 'Other keeps "Email"');
    assert.equal(await id.inputValue(), 'email');
    let config = await pushed(page, () => window.__hb.updates.at(-1)?.[0].providers[1]?.smtpPreset === undefined
      && window.__hb.updates.at(-1)?.[0].providers[1]?.name === 'Email');
    assert.equal(config.providers[1].id, 'email');
    // A hand-typed name is left alone by later presets; the id still follows the typed name.
    await name.fill('Home mailbox');
    await card.locator('.ns-preset-segments label', { hasText: 'Yahoo' }).click();
    assert.equal(await name.inputValue(), 'Home mailbox');
    assert.equal(await id.inputValue(), 'home-mailbox');
    config = await pushed(page, () => window.__hb.updates.at(-1)?.[0].providers[1]?.smtpPreset === 'yahoo');
    assert.equal(config.providers[1].name, 'Home mailbox');
    assert.equal(config.providers[1].host, 'smtp.mail.yahoo.com');
    await page.close();

    // A stored provider named after a preset (or "Email") follows a new preset too; one with a typed name does not.
    const stored = await openSettings(browser, { ...CONFIG, providers: [TWILIO, { ...SMTP, name: 'Fastmail', smtpPreset: 'fastmail' }] });
    const storedCard = stored.locator('.card[data-path="providers[1]"]');
    await storedCard.locator('.ns-preset-segments label', { hasText: 'Zoho' }).click();
    assert.equal(await storedCard.locator('[data-path="providers[1].name"] input').inputValue(), 'Zoho');
    assert.equal(await storedCard.locator('[data-path="providers[1].id"] input').inputValue(), 'zoho',
      'the id follows the name while no switch refers to it (SPEC section 11.2, item 14)');
    await stored.close();
    const typed = await openSettings(browser, { ...CONFIG, providers: [TWILIO, { ...SMTP, name: 'Alex at Fastmail', smtpPreset: 'fastmail' }] });
    await typed.locator('.card[data-path="providers[1]"] .ns-preset-segments label', { hasText: 'Zoho' }).click();
    assert.equal(await typed.locator('[data-path="providers[1].name"] input').inputValue(), 'Alex at Fastmail');
  } finally {
    await browser.close();
  }
});

test('provider names: a prefilled name another provider uses gets a numeric suffix, for chooser names and preset names alike', async (t) => {
  const browser = await launchOrSkip(t);
  if (!browser) {
    return;
  }
  try {
    const page = await openSettings(browser, { ...CONFIG, providers: [TWILIO, { ...SMTP, name: 'Email', id: 'email' }] });
    // Chooser names: "Twilio" is taken by twilio-main, "Email" by the stored SMTP provider.
    await page.getByRole('button', { name: 'Add provider' }).click();
    await page.locator('.ns-chooser-tile[data-type="twilio"]').click();
    await page.getByRole('button', { name: 'Add provider' }).click();
    await page.locator('.ns-chooser-tile[data-type="smtp"]').click();
    await page.getByRole('button', { name: 'Add provider' }).click();
    await page.locator('.ns-chooser-tile[data-type="smtp"]').click();
    let config = await pushed(page, () => window.__hb.updates.at(-1)?.[0].providers.length === 5);
    assert.deepEqual(config.providers.map((p) => p.name), ['Twilio', 'Email', 'Twilio 2', 'Email 2', 'Email 3']);
    assert.deepEqual(config.providers.map((p) => p.id), ['twilio-main', 'email', 'twilio-2', 'email-2', 'email-3']);
    // Preset names: the third card takes Gmail; the fourth, also prefilled ("Email 3"), picking Gmail becomes "Gmail 2".
    await page.locator('.card[data-path="providers[3]"] .ns-preset-segments label', { hasText: 'Gmail' }).click();
    assert.equal(await page.locator('[data-path="providers[3].name"] input').inputValue(), 'Gmail');
    await page.locator('.card[data-path="providers[4]"] .ns-preset-segments label', { hasText: 'Gmail' }).click();
    assert.equal(await page.locator('[data-path="providers[4].name"] input').inputValue(), 'Gmail 2');
    assert.equal(await page.locator('[data-path="providers[4].id"] input').inputValue(), 'gmail-2');
    // A suffixed preset name is still a prefilled one: it follows the next preset (and drops the suffix when free).
    await page.locator('.card[data-path="providers[4]"] .ns-preset-segments label', { hasText: 'Zoho' }).click();
    assert.equal(await page.locator('[data-path="providers[4].name"] input').inputValue(), 'Zoho');
    assert.equal(await page.locator('[data-path="providers[4].id"] input').inputValue(), 'zoho');
    config = await pushed(page, () => window.__hb.updates.at(-1)?.[0].providers[4]?.name === 'Zoho');
    assert.deepEqual(config.providers.map((p) => p.name), ['Twilio', 'Email', 'Twilio 2', 'Gmail', 'Zoho']);
    assert.equal(new Set(config.providers.map((p) => p.id)).size, 5, 'every id differs');
    await page.waitForFunction(() => window.__hb.save.at(-1) === false, undefined, { timeout: 5000 }).catch(() => undefined);
  } finally {
    await browser.close();
  }
});
