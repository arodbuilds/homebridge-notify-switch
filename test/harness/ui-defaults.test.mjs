import assert from 'node:assert/strict';
import { test } from 'node:test';

import { launchOrSkip, openSettings } from './browser.mjs';
import { SMTP, TWILIO } from './helpers.mjs';

/**
 * Platform defaults per channel in the built settings UI (SPEC section 5.7, section 11.2, item 25, and section
 * 11.3): the prompt on the card of a second provider for a channel once it validates, the summary box warning
 * that never disables Save, the Default provider dropdown under Settings, and what removing a provider does.
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

test('defaults: a second email provider prompts on its card once it validates, the summary warns without blocking Save, the answer is stored', async (t) => {
  const browser = await launchOrSkip(t);
  if (!browser) {
    return;
  }
  try {
    const page = await openSettings(browser, CONFIG);
    assert.equal(await page.locator('.ns-default-prompt').count(), 0, 'one provider per channel: nothing to ask');
    assert.equal(await page.locator('#section-settings [data-path^="defaultProviders"]').count(), 0, 'and nothing to choose under Settings');
    await page.getByRole('button', { name: 'Add provider' }).click();
    await page.locator('.ns-chooser-tile[data-type="smtp"]').click();
    const card = page.locator('.card[data-path="providers[1]"]');
    assert.equal(await page.locator('.ns-default-prompt').count(), 0, 'the new card has errors, so no prompt yet');
    await card.locator('.ns-preset-segments label', { hasText: 'Fastmail' }).click();
    await card.locator('[data-path="providers[1].username"] input').fill('alex@example.com');
    await card.locator('[data-path="providers[1].password"] input').fill('app-password');
    await card.locator('[data-path="providers[1].from.address"] input').fill('alex@example.com');
    await card.locator('[data-path="providers[1].from.address"] input').blur();

    // The prompt, on the new card only, with the current default (first in config order) preselected.
    const prompt = card.locator('.ns-default-prompt[data-channel="email"]');
    assert.equal(await prompt.count(), 1);
    assert.equal(await page.locator('.card[data-path="providers[0]"] .ns-default-prompt').count(), 0);
    assert.equal(await prompt.locator('.fw-semibold').textContent(), 'You now have 2 ways to send email. Which should switches use unless told otherwise?');
    assert.deepEqual(await prompt.locator('.form-check-label').allTextContents(), ['Twilio Twilio', 'Email SMTP']);
    assert.deepEqual(await prompt.locator('input[type="radio"]').evaluateAll((nodes) => nodes.map((node) => node.checked)), [true, false]);
    assert.equal(await prompt.getByRole('button', { name: 'Use the selected provider' }).count(), 1);
    // The summary box lists the choice as a warning; Save stays enabled.
    await page.waitForFunction(() => window.__hb.save.at(-1) === true);
    const issues = page.locator('.issues');
    assert.equal(await issues.isVisible(), true);
    assert.equal(await issues.locator('.fw-semibold').textContent(), 'Optional before saving:');
    assert.match(await issues.getAttribute('class'), /\balert-warning\b/);
    assert.equal(await issues.getAttribute('role'), 'status');
    const warning = issues.locator('li.ns-issue-warning .ns-issue-link');
    assert.equal(await warning.count(), 1);
    assert.equal(await warning.textContent(), 'Settings: Choose a default email provider');
    assert.equal(await warning.getAttribute('data-issue-path'), 'defaultProviders.email');
    assert.equal(await card.locator('.is-invalid').count(), 0, 'a warning marks no field');
    // Settings shows the dropdown, unset (the section redraws shortly after a provider changes).
    const setting = page.locator('#section-settings [data-path="defaultProviders.email"]');
    await setting.waitFor();
    assert.equal(await setting.count(), 1);
    assert.equal(await setting.locator('label').first().textContent(), 'Default email provider');
    assert.deepEqual(await setting.locator('option').allTextContents(), ['Choose a provider…', 'Twilio (Twilio)', 'Email (SMTP)']);
    assert.equal(await setting.locator('select').inputValue(), '');
    assert.equal(await setting.locator('.ns-help').textContent(), 'Switches send email through this provider unless a switch says otherwise under Advanced.');
    assert.equal(await page.locator('#section-settings [data-path="defaultProviders.sms"]').count(), 0, 'one SMS provider: no dropdown');
    let config = await pushed(page, () => window.__hb.updates.at(-1)?.[0].providers.length === 2);
    assert.equal('defaultProviders' in config, false, 'nothing is stored until the question is answered');
    // The switch's email override names the current default (the Switches section redraws after the provider change).
    await page.waitForFunction(() => document.querySelector('[data-path="switches[0].providers.email"] option')?.textContent === 'Platform default (Twilio)');

    // Answering with the radio writes the default; the prompt, the warning and the dropdown follow.
    // A click, not check(): answering removes the prompt, so there is no radio left to verify afterwards.
    await prompt.locator('input[type="radio"]').nth(1).click();
    assert.equal(await page.locator('.ns-default-prompt').count(), 0);
    assert.equal(await issues.isVisible(), false);
    assert.equal(await page.locator('#section-settings [data-path="defaultProviders.email"] select').inputValue(), 'email');
    config = await pushed(page, () => window.__hb.updates.at(-1)?.[0].defaultProviders?.email === 'email');
    assert.deepEqual(config.defaultProviders, { email: 'email' });
    await page.waitForFunction(() => document.querySelector('[data-path="switches[0].providers.email"] option')?.textContent === 'Platform default (Email)');
    assert.equal(config.switches[0].actions[1].providerId, 'email',
      'a switch that never named a provider follows the default; only an override under Advanced pins one');
    assert.equal(await page.locator('[data-path="switches[0].providers.email"] select').inputValue(), '');

    // The dropdown under Settings changes it too, and the switch follows the default.
    await page.locator('#section-settings [data-path="defaultProviders.email"] select').selectOption('twilio-main');
    config = await pushed(page, () => window.__hb.updates.at(-1)?.[0].defaultProviders?.email === 'twilio-main');
    assert.equal(config.switches[0].actions[1].providerId, 'twilio-main');
    await page.locator('#section-settings [data-path="defaultProviders.email"] select').selectOption('email');
    config = await pushed(page, () => window.__hb.updates.at(-1)?.[0].defaultProviders?.email === 'email');
    assert.equal(config.switches[0].actions[1].providerId, 'email');

    // Removing the default provider with one left: the remaining one is the default and nothing is stored.
    await page.locator('.card[data-path="providers[1]"]').getByRole('button', { name: 'Remove provider' }).click();
    await page.locator('.card[data-path="providers[1]"] .ns-remove-confirm').getByRole('button', { name: 'Remove', exact: true }).click();
    config = await pushed(page, () => window.__hb.updates.at(-1)?.[0].providers.length === 1);
    assert.equal('defaultProviders' in config, false);
    assert.equal(config.switches[0].actions[1].providerId, 'twilio-main');
    assert.equal(await page.locator('#section-settings [data-path^="defaultProviders"]').count(), 0);
    assert.equal(await page.locator('.ns-default-prompt').count(), 0);
  } finally {
    await browser.close();
  }
});

test('defaults: three providers, the Confirm button keeps the preselected one, removing the default re-prompts, a stale id is dropped', async (t) => {
  const browser = await launchOrSkip(t);
  if (!browser) {
    return;
  }
  try {
    const three = { ...CONFIG, providers: [TWILIO, SMTP, GMAIL] };
    const page = await openSettings(browser, three);
    // Only the last card in configuration order asks, and the first provider is preselected.
    assert.equal(await page.locator('.ns-default-prompt').count(), 1);
    const prompt = page.locator('.card[data-path="providers[2]"] .ns-default-prompt[data-channel="email"]');
    assert.equal(await prompt.locator('.fw-semibold').textContent(), 'You now have 3 ways to send email. Which should switches use unless told otherwise?');
    assert.deepEqual(await prompt.locator('input[type="radio"]').evaluateAll((nodes) => nodes.map((node) => node.value)), ['twilio-main', 'fastmail', 'gmail']);
    assert.equal(await prompt.locator('input[type="radio"]').first().isChecked(), true);
    await page.waitForFunction(() => window.__hb.save.at(-1) === true);
    // The warning entry jumps to the prompt.
    await page.locator('.issues li.ns-issue-warning .ns-issue-link').click();
    await page.waitForFunction(() => {
      const rect = document.querySelector('.ns-default-prompt').getBoundingClientRect();
      return rect.top >= 0 && rect.bottom <= window.innerHeight;
    });
    await prompt.getByRole('button', { name: 'Use the selected provider' }).click();
    let config = await pushed(page, () => window.__hb.updates.at(-1)?.[0].defaultProviders?.email === 'twilio-main');
    assert.deepEqual(config.defaultProviders, { email: 'twilio-main' });
    assert.equal(await page.locator('.ns-default-prompt').count(), 0);

    // Removing the default with two left: no default, so the prompt is back on the last remaining card.
    await page.locator('.card[data-path="providers[0]"]').getByRole('button', { name: 'Remove provider' }).click();
    await page.locator('.card[data-path="providers[0]"] .ns-remove-confirm').getByRole('button', { name: 'Remove', exact: true }).click();
    config = await pushed(page, () => window.__hb.updates.at(-1)?.[0].providers.length === 2);
    assert.equal('defaultProviders' in config, false);
    assert.equal(await page.locator('.card[data-path="providers[1]"] .ns-default-prompt[data-channel="email"]').count(), 1);
    assert.equal(await page.locator('.issues li.ns-issue-warning .ns-issue-link').textContent(), 'Settings: Choose a default email provider');
    assert.equal(await page.locator('#section-settings [data-path="defaultProviders.email"] select').inputValue(), '');
    await page.close();

    // A stored id that names no provider is dropped, and the prompt asks again.
    const stale = { ...three, defaultProviders: { email: 'gone' } };
    const page2 = await openSettings(browser, stale);
    assert.equal(await page2.locator('.ns-default-prompt').count(), 1);
    config = await pushed(page2, () => window.__hb.updates.length > 0);
    assert.equal('defaultProviders' in config, false);
    assert.equal(await page2.locator('#section-settings [data-path="defaultProviders.email"] select').inputValue(), '');
    // Renaming a provider's id under Advanced carries a default that named it along.
    await page2.locator('.card[data-path="providers[2]"] .ns-default-prompt input[type="radio"][value="gmail"]').click();
    const advanced = page2.locator('.card[data-path="providers[2]"] details.ns-advanced[data-advanced="providers[2]"]');
    await advanced.locator('summary').click();
    await advanced.getByRole('button', { name: 'Edit ID' }).click();
    await advanced.locator('[data-path="providers[2].id"] input').fill('google');
    config = await pushed(page2, () => window.__hb.updates.at(-1)?.[0].providers[2].id === 'google');
    assert.deepEqual(config.defaultProviders, { email: 'google' });
  } finally {
    await browser.close();
  }
});
