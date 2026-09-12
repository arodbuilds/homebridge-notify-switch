import assert from 'node:assert/strict';
import { test } from 'node:test';

import { launchOrSkip, openSettings } from './browser.mjs';
import { SMTP, TWILIO } from './helpers.mjs';

/**
 * Per-field validation in the built settings UI (SPEC section 11.2, item 15): a field shows its error only
 * after it has been left or jumped to from the issue list, never gains one while it has focus, and carries
 * a green check once it passes; validation messages sit on their own line so inputs keep their width; the
 * issue list links to fields and collapses past three entries; Test send is gated; Remove asks in place.
 */

const CONFIG = {
  platform: 'NotifySwitch',
  name: 'Notify Switch',
  defaultCountry: 'US',
  defaultProviders: { email: 'fastmail' },
  providers: [TWILIO, SMTP],
  groups: [{ id: 'family', name: 'Family', sms: ['+16785550101'], email: ['a@example.com'], telegram: [] }],
  switches: [{
    id: '6f1c2a9e-2b1c-4b8f-9d1e-0c5a1e2f3a4b',
    name: 'Water Leak Alert',
    actions: [{ providerId: 'twilio-main', channel: 'sms', groups: ['family'], body: 'Water detected.' }],
  }],
};

/** A saved configuration with errors in several fields, as a hand-edited config.json could leave it. */
const BROKEN = {
  ...CONFIG,
  providers: [{ ...TWILIO, accountSid: 'AC12', apiKeySid: 'nope' }, { ...SMTP, host: '', from: { address: 'not-an-address' } }],
  switches: [{ ...CONFIG.switches[0], name: 'Bad-Name!' }, { id: '0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d', name: 'Empty', actions: [] }],
};

const box = (locator) => locator.evaluate((node) => {
  const rect = node.getBoundingClientRect();
  const round = (n) => Math.round(n * 10) / 10;
  return { x: round(rect.x), y: round(rect.y), width: round(rect.width), height: round(rect.height) };
});

test('per-field validation: an error appears only after blur, never while typing, and a passing field gets a green check', async (t) => {
  const browser = await launchOrSkip(t);
  if (!browser) {
    return;
  }
  try {
    const page = await openSettings(browser, CONFIG);
    assert.equal(await page.locator('.issues').isHidden(), true, 'the loaded configuration is valid');
    const list = page.locator('.address-list[data-path="groups[0].email"]');
    await list.getByRole('button', { name: 'Add email address' }).click();
    const row = page.locator('.address-row[data-path="groups[0].email[1]"]');
    const input = row.locator('input');
    assert.equal(await input.evaluate((node) => node === document.activeElement), true, 'the new entry takes focus');
    await input.type('bad');
    assert.equal(await row.locator('.invalid-feedback').textContent(), '', 'no error while the field has focus');
    assert.equal(await input.evaluate((node) => node.classList.contains('is-invalid')), false);
    // The row is already in the issue list (the group card is not new), but the field itself waits for blur.
    await page.waitForFunction(() => window.__hb.save.at(-1) === false);
    assert.equal(await page.locator('.issues .ns-issue-link[data-issue-path="groups[0].email[1]"]').count(), 1);
    await input.blur();
    assert.equal(await row.locator('.invalid-feedback').textContent(), 'Email "bad" is not a valid email address.');
    assert.equal(await row.locator('.invalid-feedback').isVisible(), true);
    assert.equal(await input.evaluate((node) => node.classList.contains('is-invalid')), true);

    // While the error shows, typing only clears it: a valid value removes the message at once ...
    await input.focus();
    await input.fill('ok@example.com');
    assert.equal(await row.locator('.invalid-feedback').textContent(), '', 'the error clears on input');
    assert.equal(await input.evaluate((node) => node.classList.contains('is-invalid')), false);
    // ... and typing an invalid value again adds nothing until the field is left.
    await input.fill('bad again');
    assert.equal(await row.locator('.invalid-feedback').textContent(), '', 'no new error while focused');
    await input.blur();
    assert.equal(await row.locator('.invalid-feedback').textContent(), 'Email "bad again" is not a valid email address.');

    // A touched field that passes gets the green check inside the input.
    await input.fill('ok@example.com');
    await input.blur();
    assert.equal(await row.locator('.invalid-feedback').textContent(), '');
    assert.equal(await input.evaluate((node) => node.classList.contains('ns-valid')), true, 'green check after it passes');
    const icon = await input.evaluate((node) => getComputedStyle(node).backgroundImage);
    assert.match(icon, /^url\("data:image\/svg\+xml/, 'the check is drawn inside the control');
    assert.equal(await page.locator('.address-row[data-path="groups[0].email[0]"] input').evaluate((node) => node.classList.contains('ns-valid')), false,
      'untouched fields carry no check');

    // A new card shows nothing until its fields are touched; a switch name error belongs to the name field only.
    await page.getByRole('button', { name: 'Add switch' }).click();
    const sw = page.locator('.card[data-path="switches[1]"]');
    assert.equal(await sw.locator('.is-invalid').count(), 0);
    assert.equal(await sw.locator('[data-path="switches[1].groups"] > .invalid-feedback').textContent(), '');
    const name = sw.locator('[data-path="switches[1].name"] input');
    await name.fill('Water Leak Alert');
    await name.blur();
    assert.equal(await sw.locator('[data-path="switches[1].name"] .invalid-feedback').textContent(), 'Another switch already uses this name.');
    // The duplicate belongs to both name fields: the other switch's name shows it too once touched.
    const other = page.locator('.card[data-path="switches[0]"] [data-path="switches[0].name"]');
    assert.equal(await other.locator('.invalid-feedback').textContent(), '', 'untouched until the user goes there');
    await other.locator('input').focus();
    await other.locator('input').blur();
    assert.equal(await other.locator('.invalid-feedback').textContent(), '', 'the first switch owns the name; the duplicate is reported on the second');
    // "Pick at least one group" belongs to the name field as well, so it shows once the name was touched.
    assert.equal(await sw.locator('[data-path="switches[1].groups"] > .invalid-feedback').textContent(), 'Pick at least one group, or add an extra recipient.');
  } finally {
    await browser.close();
  }
});

test('error layout: the message sits on its own line and the input keeps its bounding box, for an email entry and a phone entry', async (t) => {
  const browser = await launchOrSkip(t);
  if (!browser) {
    return;
  }
  try {
    for (const width of [900, 400]) {
      const page = await openSettings(browser, CONFIG, { viewport: { width, height: 900 } });
      // Email entry.
      await page.locator('.address-list[data-path="groups[0].email"]').getByRole('button', { name: 'Add email address' }).click();
      const emailRow = page.locator('.address-row[data-path="groups[0].email[1]"]');
      const email = emailRow.locator('input');
      await email.type('bad');
      const emailBefore = await box(email);
      const removeBefore = await box(emailRow.getByRole('button', { name: /Remove/ }));
      await email.blur();
      assert.equal(await emailRow.locator('.invalid-feedback').isVisible(), true);
      assert.deepEqual(await box(email), emailBefore, `the email input keeps its box at ${width}px`);
      assert.deepEqual(await box(emailRow.getByRole('button', { name: /Remove/ })), removeBefore, 'so does its Remove button');
      const emailFeedback = await box(emailRow.locator('.invalid-feedback'));
      assert.ok(emailFeedback.y >= emailBefore.y + emailBefore.height - 1, 'the message is below the input');
      assert.equal(await emailRow.locator('.invalid-feedback').evaluate((node) => node.parentElement.classList.contains('address-row')), true,
        'the message is a block child of the row, not a flex item beside the input');
      assert.equal(await emailRow.locator('.invalid-feedback').evaluate((node) => getComputedStyle(node.parentElement).display), 'block');

      // Phone entry.
      await page.locator('.address-list[data-path="groups[0].sms"]').getByRole('button', { name: 'Add phone number' }).click();
      const phoneRow = page.locator('.address-row[data-path="groups[0].sms[1]"]');
      const phone = phoneRow.locator('input.phone-national');
      await phone.type('12');
      const phoneBefore = await box(phone);
      const countryBefore = await box(phoneRow.locator('select.phone-country'));
      await phone.blur();
      assert.match(await phoneRow.locator('.phone-feedback').textContent(), /^Not a valid number/);
      assert.deepEqual(await box(phone), phoneBefore, `the phone input keeps its box at ${width}px`);
      assert.deepEqual(await box(phoneRow.locator('select.phone-country')), countryBefore, 'so does the country dropdown');
      assert.equal(await phone.evaluate((node) => node.classList.contains('is-invalid')), true);
      assert.equal(await phoneRow.locator('.invalid-feedback').textContent(), '', 'the phone row explains itself once, under the number');
      const phoneFeedback = await box(phoneRow.locator('.phone-feedback'));
      assert.ok(phoneFeedback.y >= phoneBefore.y + phoneBefore.height - 1, 'the message is below the number');
      await page.close();
    }
  } finally {
    await browser.close();
  }
});

test('issue list: entries link to their fields, mark them touched and focus them; more than three collapse to a count', async (t) => {
  const browser = await launchOrSkip(t);
  if (!browser) {
    return;
  }
  try {
    const page = await openSettings(browser, BROKEN);
    await page.waitForFunction(() => window.__hb.save.at(-1) === false);
    const issues = page.locator('.issues');
    assert.equal(await issues.isVisible(), true);
    // Nothing is touched yet: the fields show no message, the list holds every issue behind a one-line count.
    assert.equal(await page.locator('.invalid-feedback:visible').count(), 0, 'no inline errors before any field is touched');
    assert.equal(await page.locator('.is-invalid').count(), 0);
    const links = issues.locator('.ns-issue-link');
    const count = await links.count();
    assert.ok(count > 3, `several fields (${count})`);
    assert.equal(await issues.locator('.fw-semibold').textContent(), `${count} fields need attention`);
    assert.equal(await issues.locator('.ns-issue-list').isVisible(), false, 'collapsed');
    const toggle = issues.locator('.ns-issues-toggle');
    assert.equal(await toggle.textContent(), 'Show all');
    await toggle.click();
    assert.equal(await issues.locator('.fw-semibold').textContent(), 'Fix these before saving:');
    assert.equal(await issues.locator('.ns-issue-list').isVisible(), true);
    assert.equal(await toggle.textContent(), 'Hide');

    // Clicking an entry scrolls to the field, marks it touched (its message appears) and focuses it.
    const host = page.locator('[data-path="providers[1].host"]');
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await links.filter({ hasText: 'Host is required.' }).click();
    assert.equal(await host.locator('.invalid-feedback').textContent(), 'Host is required.');
    assert.equal(await host.locator('input').evaluate((node) => node === document.activeElement), true, 'the field has focus');
    await page.waitForFunction(() => {
      const rect = document.querySelector('[data-path="providers[1].host"] input').getBoundingClientRect();
      return rect.top >= 0 && rect.bottom <= window.innerHeight;
    });
    assert.equal(await page.locator('.invalid-feedback:visible').count(), 1, 'the other fields stay quiet');

    // Fixing fields shrinks the list; at three or fewer it shows the plain list without a toggle.
    await host.locator('input').fill('smtp.example.com');
    await page.locator('[data-path="providers[1].from.address"] input').fill('alex@example.com');
    await page.locator('[data-path="providers[0].accountSid"] input').fill(TWILIO.accountSid);
    await page.locator('[data-path="providers[0].apiKeySid"] input').fill(TWILIO.apiKeySid);
    await page.waitForFunction(() => document.querySelectorAll('.issues .ns-issue-link').length <= 3);
    assert.equal(await toggle.isVisible(), false);
    assert.equal(await issues.locator('.fw-semibold').textContent(), 'Fix these before saving:');
    assert.equal(await issues.locator('.ns-issue-list').isVisible(), true);
    // A field made valid after being touched shows the check.
    await host.locator('input').blur();
    assert.equal(await host.locator('input').evaluate((node) => node.classList.contains('ns-valid')), true);
  } finally {
    await browser.close();
  }
});

test('test send gating and remove confirmation', async (t) => {
  const browser = await launchOrSkip(t);
  if (!browser) {
    return;
  }
  try {
    const page = await openSettings(browser, CONFIG);
    const card = page.locator('.card[data-path="switches[0]"]');
    const testSend = card.getByRole('button', { name: 'Test send' });
    assert.equal(await testSend.isEnabled(), true);
    assert.equal(await card.locator('.ns-test-send-hint').isVisible(), false);

    // A validation error on the switch disables Test send with a hint beside it.
    const body = card.locator('[data-path="switches[0].body"] textarea');
    await body.fill('');
    assert.equal(await testSend.isEnabled(), false);
    assert.equal(await card.locator('.ns-test-send-hint').textContent(), 'Fix the errors above first');
    await body.fill('Water detected.');
    assert.equal(await testSend.isEnabled(), true);

    // No recipients: the group's only number is removed, so the confirmation can never read "Send to 0 recipients".
    await page.locator('.address-row[data-path="groups[0].sms[0]"]').getByRole('button', { name: /Remove/ }).click();
    await page.waitForFunction(() => window.__hb.updates.at(-1)?.[0].groups[0].sms.length === 0);
    // Zero recipients is also a validation error on the action, so the hint names the errors first.
    assert.equal(await page.locator('.card[data-path="switches[0]"] .ns-test-send-hint').textContent(), 'Fix the errors above first');
    assert.equal(await page.locator('.card[data-path="switches[0]"]').getByRole('button', { name: 'Test send' }).isEnabled(), false);
    // An error on a provider the switch uses blocks it too.
    await page.locator('.address-list[data-path="groups[0].sms"]').getByRole('button', { name: 'Add phone number' }).click();
    await page.locator('.address-row[data-path="groups[0].sms[0]"] input.phone-national').fill('305 555 0123');
    await page.locator('.address-row[data-path="groups[0].sms[0]"] input.phone-national').blur();
    await page.waitForFunction(() => document.querySelector('.card[data-path="switches[0]"] .ns-test-send-hint')?.hidden === true);
    await page.locator('[data-path="providers[0].accountSid"] input').fill('AC12');
    assert.equal(await page.locator('.card[data-path="switches[0]"] .ns-test-send-hint').textContent(), 'Fix the errors above first');
    await page.locator('[data-path="providers[0].accountSid"] input').fill(TWILIO.accountSid);
    await page.waitForFunction(() => document.querySelector('.card[data-path="switches[0]"] .ns-test-send-hint')?.hidden === true);

    // Remove switch asks in place: the text button becomes the question, a red Remove and a text Cancel.
    const footer = page.locator('.card[data-path="switches[0]"] .card-footer');
    await footer.getByRole('button', { name: 'Remove switch' }).click();
    const confirm = footer.locator('.ns-remove-confirm');
    // The question names the switch (SPEC section 11.2, item 28).
    assert.equal(await confirm.locator('.ns-confirm-question').textContent(), 'Remove Water Leak Alert?');
    const remove = confirm.getByRole('button', { name: 'Remove', exact: true });
    assert.match(await remove.getAttribute('class'), /\bbtn-danger\b/);
    assert.match(await confirm.getByRole('button', { name: 'Cancel' }).getAttribute('class'), /\bbtn-link\b/);
    assert.equal(await footer.getByRole('button', { name: 'Remove switch' }).count(), 0, 'replaced, not duplicated');
    await page.keyboard.press('Escape');
    assert.equal(await footer.getByRole('button', { name: 'Remove switch' }).count(), 1, 'Escape restores the button');
    await footer.getByRole('button', { name: 'Remove switch' }).click();
    await confirm.getByRole('button', { name: 'Cancel' }).click();
    assert.equal(await footer.getByRole('button', { name: 'Remove switch' }).count(), 1, 'so does Cancel');
    assert.equal(await page.locator('.card[data-path="switches[0]"]').count(), 1, 'nothing was removed');
    // Confirming removes the card. Group and provider cards ask the same way.
    await footer.getByRole('button', { name: 'Remove switch' }).click();
    await confirm.getByRole('button', { name: 'Remove', exact: true }).click();
    assert.equal(await page.locator('.card[data-path^="switches"]').count(), 0);
    await page.getByRole('button', { name: 'Remove group' }).click();
    assert.equal(await page.locator('.ns-remove-confirm .ns-confirm-question').textContent(), 'Remove Family?');
    await page.locator('.ns-remove-confirm').getByRole('button', { name: 'Remove', exact: true }).click();
    assert.equal(await page.locator('.card[data-path^="groups"]').count(), 0);
  } finally {
    await browser.close();
  }
});
