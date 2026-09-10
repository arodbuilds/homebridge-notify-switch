import assert from 'node:assert/strict';
import { test } from 'node:test';

import { launchOrSkip, openSettings } from './browser.mjs';
import { SMTP, TWILIO } from './helpers.mjs';

/**
 * Platform defaults per channel in the built settings UI (SPEC section 5.7, section 11.2, item 25, and section
 * 11.3): the entry is written the moment a second provider for a channel validates, the prompt sits at the bottom
 * of that card with the new provider preselected and writes nothing until a button is pressed, the header badge
 * and the Make default button, the Settings dropdown, removal, and no prompt on a later load.
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
      { providerId: 'twilio-main', channel: 'sms', groups: ['family'], body: 'Water detected.' },
      { providerId: 'twilio-main', channel: 'email', groups: ['family'], body: 'Water detected.' },
    ],
  }],
};

const GMAIL = { ...SMTP, id: 'gmail', name: 'Gmail', host: 'smtp.gmail.com' };

async function pushed(page, predicate) {
  await page.waitForFunction(predicate);
  return page.evaluate(() => window.__hb.updates.at(-1)[0]);
}

/** The header slot of a provider card: the default badges and Make default buttons it shows, in order. */
async function headerDefaults(page, index) {
  return page.locator(`.card[data-path="providers[${index}]"] .card-header .ns-default-slot > *`).evaluateAll((nodes) => nodes.map((node) => [
    node.tagName === 'BUTTON' ? 'button' : 'badge', node.dataset.channel, node.textContent.trim(),
  ]));
}

test('defaults: the entry is written when the second provider validates; the prompt sits above the footer, preselects the new provider '
  + 'and writes nothing until a button is pressed', async (t) => {
  const browser = await launchOrSkip(t);
  if (!browser) {
    return;
  }
  try {
    const page = await openSettings(browser, CONFIG);
    assert.equal(await page.locator('.ns-default-prompt').count(), 0, 'one provider per channel: nothing to ask');
    assert.equal(await page.locator('#section-settings [data-path^="defaultProviders"]').count(), 0, 'and nothing to choose under Settings');
    assert.deepEqual(await headerDefaults(page, 0), [], 'no badge while one provider serves each channel');
    await page.getByRole('button', { name: 'Add provider' }).click();
    await page.locator('.ns-chooser-tile[data-type="smtp"]').click();
    const card = page.locator('.card[data-path="providers[1]"]');
    assert.equal(await page.locator('.ns-default-prompt').count(), 0, 'the new card has errors, so no prompt yet');
    // Two providers serve email as soon as the card exists: the header says which is the default, before the entry is written.
    assert.deepEqual(await headerDefaults(page, 0), [['badge', 'email', 'Default for email']]);
    assert.deepEqual(await headerDefaults(page, 1), [['button', 'email', 'Make default for email']]);
    let config = await pushed(page, () => window.__hb.updates.at(-1)?.[0].providers.length === 2);
    assert.equal('defaultProviders' in config, false, 'nothing is written while the second provider is invalid');
    const setting = page.locator('#section-settings [data-path="defaultProviders.email"]');
    await setting.waitFor();
    assert.deepEqual(await setting.locator('option').allTextContents(), ['Choose a provider…', 'Twilio (Twilio)', 'Email (SMTP)']);
    assert.equal(await setting.locator('select').inputValue(), '');
    assert.equal(await setting.locator('option').first().isDisabled(), true, 'the placeholder cannot be chosen');

    await card.locator('.ns-preset-segments label', { hasText: 'Fastmail' }).click();
    await card.locator('[data-path="providers[1].username"] input').fill('alex@example.com');
    await card.locator('[data-path="providers[1].password"] input').fill('app-password');
    await card.locator('[data-path="providers[1].from.address"] input').fill('alex@example.com');
    // The moment the card validates, the fallback (Twilio, first in configuration order) is written.
    config = await pushed(page, () => window.__hb.updates.at(-1)?.[0].defaultProviders?.email === 'twilio-main');
    assert.deepEqual(config.defaultProviders, { email: 'twilio-main' });
    assert.equal(config.switches[0].actions[1].providerId, 'twilio-main');
    await page.waitForFunction(() => document.querySelector('#section-settings [data-path="defaultProviders.email"] select')?.value === 'twilio-main');
    assert.deepEqual(await page.locator('#section-settings [data-path="defaultProviders.email"] option').allTextContents(),
      ['Twilio (Twilio)', 'Fastmail (SMTP)'], 'the placeholder goes once the entry is written; the preset renamed the provider (SPEC section 11.2, item 22)');
    // No warning, no "Optional before saving:" box: nothing is left to fix or choose.
    await page.waitForFunction(() => window.__hb.save.at(-1) === true);
    assert.equal(await page.locator('.issues').isVisible(), false);
    assert.equal(await page.locator('.ns-issue-warning').count(), 0);

    // The prompt, on the new card only, at the bottom of the body directly above the footer.
    const prompt = card.locator('.ns-default-prompt[data-channel="email"]');
    assert.equal(await prompt.count(), 1);
    assert.equal(await page.locator('.card[data-path="providers[0]"] .ns-default-prompt').count(), 0);
    assert.equal(await card.evaluate((node) => {
      const body = node.querySelector('.card-body');
      return body.lastElementChild.classList.contains('ns-default-prompts') && body.nextElementSibling.classList.contains('card-footer');
    }), true, 'the prompt box is the last thing in the body and the footer follows');
    assert.equal(await prompt.locator('.ns-default-question').textContent(),
      'You now have 2 ways to send email. Switches use Twilio unless told otherwise. Which should they use?');
    assert.deepEqual(await prompt.locator('.form-check-label').allTextContents(), ['Twilio Twilio', 'Fastmail SMTP']);
    assert.deepEqual(await prompt.locator('input[type="radio"]').evaluateAll((nodes) => nodes.map((node) => node.checked)), [false, true],
      'the card\'s own provider is preselected');
    const buttons = prompt.locator('button');
    assert.deepEqual(await buttons.allTextContents(), ['Use the selected provider', 'Keep Twilio']);
    assert.match(await buttons.nth(0).getAttribute('class'), /\bbtn-primary\b/);
    assert.match(await buttons.nth(1).getAttribute('class'), /\bbtn-link\b/);
    assert.equal(await buttons.nth(0).evaluate((a) => a.parentElement === a.nextElementSibling.parentElement), true, 'both buttons share one row');
    // The header follows the written entry.
    assert.deepEqual(await headerDefaults(page, 0), [['badge', 'email', 'Default for email']]);
    assert.deepEqual(await headerDefaults(page, 1), [['button', 'email', 'Make default for email']]);

    // A radio only selects: nothing is written and the prompt stays.
    await prompt.locator('input[type="radio"]').nth(0).check();
    await prompt.locator('input[type="radio"]').nth(1).check();
    await page.waitForTimeout(400);
    assert.equal(await prompt.count(), 1, 'the prompt is still open');
    assert.deepEqual(await page.evaluate(() => window.__hb.updates.at(-1)[0].defaultProviders), { email: 'twilio-main' });

    // Use the selected provider writes the selection and closes the prompt; the switch follows the default.
    await buttons.nth(0).click();
    assert.equal(await page.locator('.ns-default-prompt').count(), 0);
    config = await pushed(page, () => window.__hb.updates.at(-1)?.[0].defaultProviders?.email === 'fastmail');
    assert.deepEqual(config.defaultProviders, { email: 'fastmail' });
    assert.equal(config.switches[0].actions[1].providerId, 'fastmail', 'a switch that never named a provider follows the default');
    assert.equal(await page.locator('#section-settings [data-path="defaultProviders.email"] select').inputValue(), 'fastmail');
    await page.waitForFunction(() => document.querySelector('[data-path="switches[0].providers.email"] option')?.textContent === 'Platform default (Fastmail)');
    assert.deepEqual(await headerDefaults(page, 0), [['button', 'email', 'Make default for email']]);
    assert.deepEqual(await headerDefaults(page, 1), [['badge', 'email', 'Default for email']]);

    // Make default on the other card writes the entry back.
    await page.locator('.card[data-path="providers[0]"] .ns-make-default[data-channel="email"]').click();
    config = await pushed(page, () => window.__hb.updates.at(-1)?.[0].defaultProviders?.email === 'twilio-main');
    assert.equal(config.switches[0].actions[1].providerId, 'twilio-main');
    assert.deepEqual(await headerDefaults(page, 0), [['badge', 'email', 'Default for email']]);
    assert.deepEqual(await headerDefaults(page, 1), [['button', 'email', 'Make default for email']]);
    assert.equal(await page.locator('.ns-default-prompt').count(), 0, 'no prompt comes back for a written entry');

    // The dropdown under Settings changes it too.
    await page.locator('#section-settings [data-path="defaultProviders.email"] select').selectOption('fastmail');
    config = await pushed(page, () => window.__hb.updates.at(-1)?.[0].defaultProviders?.email === 'fastmail');
    assert.equal(config.switches[0].actions[1].providerId, 'fastmail');

    // Removing the default provider with one left: the remaining one is the default and nothing is stored.
    await page.locator('.card[data-path="providers[1]"]').getByRole('button', { name: 'Remove provider' }).click();
    await page.locator('.card[data-path="providers[1]"] .ns-remove-confirm').getByRole('button', { name: 'Remove', exact: true }).click();
    config = await pushed(page, () => window.__hb.updates.at(-1)?.[0].providers.length === 1);
    assert.equal('defaultProviders' in config, false);
    assert.equal(config.switches[0].actions[1].providerId, 'twilio-main');
    assert.equal(await page.locator('#section-settings [data-path^="defaultProviders"]').count(), 0);
    assert.equal(await page.locator('.ns-default-prompt').count(), 0);
    assert.deepEqual(await headerDefaults(page, 0), []);
  } finally {
    await browser.close();
  }
});

test('defaults: Keep closes without writing; removal with several left writes the new fallback and asks on the last card; a stale id is replaced; '
  + 'no prompt on reload', async (t) => {
  const browser = await launchOrSkip(t);
  if (!browser) {
    return;
  }
  try {
    // A hand-edited configuration with three email providers and no entry: the fallback is written on load and the last card asks.
    const three = { ...CONFIG, providers: [TWILIO, SMTP, GMAIL] };
    const page = await openSettings(browser, three);
    let config = await pushed(page, () => window.__hb.updates.at(-1)?.[0].defaultProviders?.email === 'twilio-main');
    assert.deepEqual(config.defaultProviders, { email: 'twilio-main' });
    assert.equal(await page.locator('.ns-default-prompt').count(), 1);
    const prompt = page.locator('.card[data-path="providers[2]"] .ns-default-prompt[data-channel="email"]');
    assert.equal(await prompt.locator('.ns-default-question').textContent(),
      'You now have 3 ways to send email. Switches use Twilio unless told otherwise. Which should they use?');
    assert.deepEqual(await prompt.locator('input[type="radio"]').evaluateAll((nodes) => nodes.map((node) => [node.value, node.checked])),
      [['twilio-main', false], ['fastmail', false], ['gmail', true]]);
    assert.deepEqual(await headerDefaults(page, 0), [['badge', 'email', 'Default for email']]);
    assert.deepEqual(await headerDefaults(page, 1), [['button', 'email', 'Make default for email']]);
    assert.deepEqual(await headerDefaults(page, 2), [['button', 'email', 'Make default for email']]);
    await page.waitForFunction(() => window.__hb.save.at(-1) === true);
    assert.equal(await page.locator('.issues').isVisible(), false, 'nothing to fix, nothing optional');
    // Keep closes the prompt and changes nothing, whatever radio was chosen.
    await prompt.locator('input[type="radio"][value="fastmail"]').check();
    await prompt.getByRole('button', { name: 'Keep Twilio' }).click();
    assert.equal(await page.locator('.ns-default-prompt').count(), 0);
    await page.waitForTimeout(400);
    assert.deepEqual(await page.evaluate(() => window.__hb.updates.at(-1)[0].defaultProviders), { email: 'twilio-main' });

    // Removing the default with two left: the new fallback is written at once and the last remaining card asks.
    await page.locator('.card[data-path="providers[0]"]').getByRole('button', { name: 'Remove provider' }).click();
    await page.locator('.card[data-path="providers[0]"] .ns-remove-confirm').getByRole('button', { name: 'Remove', exact: true }).click();
    config = await pushed(page, () => window.__hb.updates.at(-1)?.[0].providers.length === 2
      && window.__hb.updates.at(-1)?.[0].defaultProviders?.email === 'fastmail');
    assert.deepEqual(config.defaultProviders, { email: 'fastmail' });
    const again = page.locator('.card[data-path="providers[1]"] .ns-default-prompt[data-channel="email"]');
    assert.equal(await again.count(), 1);
    assert.equal(await again.locator('.ns-default-question').textContent(),
      'You now have 2 ways to send email. Switches use Fastmail unless told otherwise. Which should they use?');
    assert.deepEqual(await again.locator('button').allTextContents(), ['Use the selected provider', 'Keep Fastmail']);
    assert.equal(await page.locator('#section-settings [data-path="defaultProviders.email"] select').inputValue(), 'fastmail');
    assert.deepEqual(await headerDefaults(page, 0), [['badge', 'email', 'Default for email']]);
    assert.deepEqual(await headerDefaults(page, 1), [['button', 'email', 'Make default for email']]);
    // Make default on the asking card answers the question too.
    await page.locator('.card[data-path="providers[1]"] .ns-make-default[data-channel="email"]').click();
    assert.equal(await page.locator('.ns-default-prompt').count(), 0);
    config = await pushed(page, () => window.__hb.updates.at(-1)?.[0].defaultProviders?.email === 'gmail');
    assert.deepEqual(config.defaultProviders, { email: 'gmail' });
    await page.close();

    // A stored id that names no provider is replaced by the fallback, and the prompt asks again.
    const stale = { ...three, defaultProviders: { email: 'gone' } };
    const page2 = await openSettings(browser, stale);
    config = await pushed(page2, () => window.__hb.updates.at(-1)?.[0].defaultProviders?.email === 'twilio-main');
    assert.equal(await page2.locator('.ns-default-prompt').count(), 1);
    assert.equal(await page2.locator('#section-settings [data-path="defaultProviders.email"] select').inputValue(), 'twilio-main');
    // Renaming a provider's id under Advanced carries a default that named it along.
    await page2.locator('.card[data-path="providers[2]"] .ns-default-prompt input[type="radio"][value="gmail"]').check();
    await page2.locator('.card[data-path="providers[2]"] .ns-default-prompt').getByRole('button', { name: 'Use the selected provider' }).click();
    const advanced = page2.locator('.card[data-path="providers[2]"] details.ns-advanced[data-advanced="providers[2]"]');
    await advanced.locator('summary').click();
    await advanced.getByRole('button', { name: 'Edit ID' }).click();
    await advanced.locator('[data-path="providers[2].id"] input').fill('google');
    config = await pushed(page2, () => window.__hb.updates.at(-1)?.[0].providers[2].id === 'google');
    assert.deepEqual(config.defaultProviders, { email: 'google' });
    const written = config;
    await page2.close();

    // A later load of an already-written entry shows no prompt; the badges and the dropdown show it.
    const page3 = await openSettings(browser, written);
    await page3.waitForFunction(() => window.__hb.updates.length > 0);
    await page3.waitForTimeout(400);
    assert.equal(await page3.locator('.ns-default-prompt').count(), 0);
    assert.deepEqual(await page3.evaluate(() => window.__hb.updates.at(-1)[0].defaultProviders), { email: 'google' });
    assert.equal(await page3.locator('#section-settings [data-path="defaultProviders.email"] select').inputValue(), 'google');
    assert.deepEqual(await headerDefaults(page3, 2), [['badge', 'email', 'Default for email']]);
    assert.deepEqual(await headerDefaults(page3, 0), [['button', 'email', 'Make default for email']]);
  } finally {
    await browser.close();
  }
});

test('defaults: a Twilio provider with a from address asks for SMS and email separately, and names are text', async (t) => {
  const browser = await launchOrSkip(t);
  if (!browser) {
    return;
  }
  try {
    // Angle brackets are refused by the name rule; the other characters HTML would care about are inserted as text.
    const second = { ...TWILIO, id: 'twilio-backup', name: 'Backup & "co" \'x\'' };
    const page = await openSettings(browser, { ...CONFIG, providers: [TWILIO, second] });
    await pushed(page, () => window.__hb.updates.at(-1)?.[0].defaultProviders?.sms === 'twilio-main');
    const card = page.locator('.card[data-path="providers[1]"]');
    assert.deepEqual(await card.locator('.ns-default-prompt').evaluateAll((nodes) => nodes.map((node) => node.dataset.channel)), ['sms', 'email']);
    assert.deepEqual(await headerDefaults(page, 1), [['button', 'sms', 'Make default for SMS'], ['button', 'email', 'Make default for email']]);
    assert.deepEqual(await headerDefaults(page, 0), [['badge', 'sms', 'Default for SMS'], ['badge', 'email', 'Default for email']]);
    // The provider name is inserted as text, character for character.
    assert.deepEqual(await card.locator('.ns-default-prompt[data-channel="sms"] .form-check-label').allTextContents(),
      ['Twilio Twilio', 'Backup & "co" \'x\' Twilio']);
    assert.equal(await card.locator('.card-header .ns-card-title').evaluate((node) => node.querySelectorAll('*').length), 5,
      'title, type badge, slot and its two children only');
    await card.locator('.ns-default-prompt[data-channel="sms"]').getByRole('button', { name: 'Use the selected provider' }).click();
    const config = await pushed(page, () => window.__hb.updates.at(-1)?.[0].defaultProviders?.sms === 'twilio-backup');
    assert.deepEqual(config.defaultProviders, { sms: 'twilio-backup', email: 'twilio-main' });
    assert.equal(await card.locator('.ns-default-prompt').count(), 1, 'the email question is still open');
    assert.deepEqual(await headerDefaults(page, 1), [['badge', 'sms', 'Default for SMS'], ['button', 'email', 'Make default for email']]);
    assert.equal(await page.locator('.card[data-path="providers[0]"] .ns-make-default[data-channel="sms"]').textContent(), 'Make default for SMS');
    // With Twilio as the default for email, Keep names it as text too.
    await page.locator('.card[data-path="providers[0]"] .ns-make-default[data-channel="sms"]').click();
    await pushed(page, () => window.__hb.updates.at(-1)?.[0].defaultProviders?.sms === 'twilio-main');
    await page.locator('.card[data-path="providers[0]"] .ns-make-default[data-channel="email"]').count();
    await card.locator('.ns-default-prompt[data-channel="email"] input[type="radio"][value="twilio-backup"]').check();
    await card.locator('.ns-default-prompt[data-channel="email"]').getByRole('button', { name: 'Use the selected provider' }).click();
    await pushed(page, () => window.__hb.updates.at(-1)?.[0].defaultProviders?.email === 'twilio-backup');
    assert.equal(await page.locator('.card[data-path="providers[0]"] .ns-make-default[data-channel="email"]').textContent(), 'Make default for email');
  } finally {
    await browser.close();
  }
});

test('defaults: the on-appearance write happens before the page is drawn, so nothing redraws itself after load', async (t) => {
  const browser = await launchOrSkip(t);
  if (!browser) {
    return;
  }
  try {
    // Two email providers and no entry: the entry is written on load, and the page must then stay as drawn.
    const page = await openSettings(browser, { ...CONFIG, providers: [TWILIO, SMTP] });
    const advanced = page.locator('#section-settings details.ns-advanced[data-advanced="settings"]');
    await advanced.locator('summary').click();
    assert.equal(await advanced.evaluate((node) => node.open), true);
    await page.waitForTimeout(700);
    assert.equal(await advanced.evaluate((node) => node.open), true, 'Advanced is still open 700 ms after load');
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      advanced.getByRole('button', { name: 'Download backup', exact: true }).click(),
    ]);
    assert.match(download.suggestedFilename(), /^notify-switch-backup-\d{4}-\d{2}-\d{2}\.json$/);
    const config = await pushed(page, () => window.__hb.updates.length > 0);
    assert.deepEqual(config.defaultProviders, { email: 'twilio-main' }, 'the fallback was written');
    assert.equal(await page.locator('.ns-default-prompt').count(), 1);
    assert.equal(await page.locator('.card[data-path="providers[1]"] .ns-default-prompt[data-channel="email"]').count(), 1, 'the prompt is on the last card');
    assert.equal(await page.locator('#section-settings [data-path="defaultProviders.email"] select').inputValue(), 'twilio-main',
      'Settings was drawn with the entry already in place');
    await page.close();

    // A write during a later change (typing a from address makes Twilio the second email provider) still refreshes the
    // Settings dropdowns, but keeps the disclosure as the user left it.
    const later = await openSettings(browser, { ...CONFIG, providers: [{ ...TWILIO, emailFrom: undefined }, SMTP] });
    const laterAdvanced = later.locator('#section-settings details.ns-advanced[data-advanced="settings"]');
    await laterAdvanced.locator('summary').click();
    assert.equal(await later.locator('#section-settings [data-path^="defaultProviders"]').count(), 0, 'one email provider so far');
    await later.locator('[data-path="providers[0].emailFrom.address"] input').fill('alerts@example.com');
    await later.waitForFunction(() => document.querySelector('#section-settings [data-path="defaultProviders.email"] select')?.value === 'twilio-main');
    assert.equal(await laterAdvanced.evaluate((node) => node.open), true, 'the redraw kept Advanced open');
    const written = await pushed(later, () => window.__hb.updates.at(-1)?.[0].defaultProviders?.email === 'twilio-main');
    assert.deepEqual(written.defaultProviders, { email: 'twilio-main' });
    assert.equal(await later.locator('.card[data-path="providers[1]"] .ns-default-prompt[data-channel="email"]').count(), 1);
  } finally {
    await browser.close();
  }
});
