import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { test } from 'node:test';

import { launchOrSkip, lastPushed, openSettings } from './browser.mjs';
import { TELEGRAM } from './helpers.mjs';

/**
 * The switch editor derives its form from the stored `actions` array and writes it back (SPEC section 5.4
 * and section 11.2, item 8). Every fixture under test/fixtures is loaded into the built settings UI,
 * rendered, written through `updatePluginConfig`, and compared with the file: the round trip is lossless,
 * per-channel bodies and subjects, provider overrides, senders, BCC, ntfy options, an unticked channel,
 * the stored action order, and an action whose provider no longer exists included. (A fixture with more
 * than one action on the same channel lives under test/fixtures/legacy and never reaches the editor;
 * see ui-legacy.test.mjs.)
 */

const FIXTURES = resolve(import.meta.dirname, '..', 'fixtures');

/** Fixtures that round-trip unchanged but would not start: Save is disabled for them until the user acts. */
const INVALID = new Set(['missing-provider.json']);

test('round trip: every fixture configuration loads, renders and writes back unchanged', async (t) => {
  const browser = await launchOrSkip(t);
  if (!browser) {
    return;
  }
  const files = readdirSync(FIXTURES).filter((name) => name.endsWith('.json')).sort();
  assert.ok(files.length >= 6, `fixtures found: ${files.join(', ')}`);
  try {
    for (const file of files) {
      const fixture = JSON.parse(readFileSync(join(FIXTURES, file), 'utf8'));
      const page = await openSettings(browser, fixture);
      const pushed = await lastPushed(page);
      assert.deepEqual(pushed, fixture, `${file} round-trips through the editor unchanged`);
      assert.equal(await page.locator('.alert-danger').count(), 0, `${file} loads without an error`);
      assert.deepEqual(await page.evaluate(() => window.__hb.save.at(-1)), !INVALID.has(file),
        `${file} is ${INVALID.has(file) ? 'not valid, so Save is disabled' : 'valid, so Save is enabled'}`);
      // A second render (the Switches section is redrawn when a group changes) writes the same thing again.
      await page.locator('[data-path="groups[0].name"] input').fill(`${fixture.groups[0].name} `);
      await page.locator('[data-path="groups[0].name"] input').fill(fixture.groups[0].name);
      await page.waitForFunction(() => window.__hb.updates.length >= 2);
      await page.waitForTimeout(500);
      assert.deepEqual(await lastPushed(page), fixture, `${file} is stable across re-renders`);
      await page.close();
    }
  } finally {
    await browser.close();
  }
});

test('round trip: the editor shows what the fixture stored', async (t) => {
  const browser = await launchOrSkip(t);
  if (!browser) {
    return;
  }
  try {
    // Differing bodies open Customize per channel; a non-default provider, a sender and BCC open the override fields.
    const perChannel = JSON.parse(readFileSync(join(FIXTURES, 'per-channel.json'), 'utf8'));
    let page = await openSettings(browser, perChannel);
    const sw = page.locator('.card[data-path="switches[0]"]');
    assert.equal(await sw.locator('[data-path="switches[0].customize"] input').isChecked(), true);
    assert.equal(await sw.locator('details.ns-advanced[data-advanced="switches[0]"]').evaluate((node) => node.open), true, 'Advanced opens');
    assert.equal(await sw.locator('[data-path="switches[0].body"]').isVisible(), false, 'the shared message gives way to the per-channel ones');
    assert.equal(await sw.locator('.ns-customized-note').textContent(), 'Each channel has its own message under Advanced.');
    assert.equal(await sw.locator('[data-path="switches[0].bodies.sms"] textarea').inputValue(), 'Smoke!');
    assert.equal(await sw.locator('[data-path="switches[0].bodies.email"] textarea').inputValue(), 'Smoke detected at {{time}} on {{date}}.');
    assert.equal(await sw.locator('[data-path="switches[0].subjects.email"] input').inputValue(), 'Smoke detected');
    assert.equal(await sw.locator('[data-path="switches[0].subjects.ntfy"] input').inputValue(), 'Smoke');
    assert.equal(await sw.locator('[data-path="switches[0].bodies.telegram"]').isVisible(), false, 'no Telegram provider, no Telegram message');
    const emailProvider = sw.locator('[data-path="switches[0].providers.email"]');
    assert.equal(await emailProvider.isVisible(), true, 'two email providers: the override dropdown shows');
    assert.equal(await emailProvider.locator('select').inputValue(), 'twilio-main');
    assert.equal(await emailProvider.locator('option').first().textContent(), 'Platform default (Fastmail)');
    assert.equal(await sw.locator('[data-path="switches[0].providers.sms"]').isVisible(), false, 'one SMS provider: nothing to choose');
    assert.equal(await sw.locator('[data-path="switches[0].sender"] select').inputValue(), '+16785550199');
    assert.equal(await sw.locator('[data-path="switches[0].bcc"] input').isChecked(), true);
    assert.equal(await sw.locator('[data-path="switches[0].priority"] select').inputValue(), 'urgent');
    assert.equal(await sw.locator('[data-path="switches[0].tags"] input').inputValue(), 'fire, house');
    assert.deepEqual(await sw.locator('.ns-send-by .form-check-label').allTextContents(), ['SMS (3 numbers)', 'Email (2 addresses)', 'ntfy (1 topic)']);
    assert.equal(await sw.locator('.ns-send-preview').textContent(),
      'Will send SMS via Twilio to 3 numbers, email via Twilio to 2 addresses, ntfy via ntfy to 1 topic.');
    await page.close();

    // Identical bodies collapse to the shared field; a channel the switch does not send on is listed unticked.
    const shared = JSON.parse(readFileSync(join(FIXTURES, 'shared-message.json'), 'utf8'));
    page = await openSettings(browser, shared);
    const card = page.locator('.card[data-path="switches[0]"]');
    assert.equal(await card.locator('[data-path="switches[0].customize"] input').isChecked(), false);
    assert.equal(await card.locator('details.ns-advanced[data-advanced="switches[0]"]').evaluate((node) => node.open), false, 'nothing to show under Advanced');
    assert.equal(await card.locator('[data-path="switches[0].body"] textarea').inputValue(), 'Water at {{time}}.');
    assert.equal(await card.locator('[data-path="switches[0].subject"] input').inputValue(), 'Leak');
    assert.deepEqual(await card.locator('.ns-recipient-groups .form-check-label').allTextContents(),
      ['Family: 2 SMS, 1 email, 1 Telegram, 1 ntfy', 'Neighbours: 1 email']);
    assert.deepEqual(await card.locator('.ns-recipient-groups input').evaluateAll((nodes) => nodes.map((node) => node.checked)), [true, true]);
    await page.close();

    const unticked = JSON.parse(readFileSync(join(FIXTURES, 'unticked-channel.json'), 'utf8'));
    page = await openSettings(browser, unticked);
    assert.deepEqual(await page.locator('.ns-send-by .form-check-label').allTextContents(), ['SMS (2 numbers)', 'Telegram (1 chat)']);
    assert.deepEqual(await page.locator('.ns-send-by input').evaluateAll((nodes) => nodes.map((node) => node.checked)), [true, false]);
    await page.close();
  } finally {
    await browser.close();
  }
});

test('round trip: the only Telegram provider was removed; the action is kept, listed disabled with a note, and dropped only when unticked', async (t) => {
  const browser = await launchOrSkip(t);
  if (!browser) {
    return;
  }
  try {
    const fixture = JSON.parse(readFileSync(join(FIXTURES, 'missing-provider.json'), 'utf8'));
    const page = await openSettings(browser, fixture);
    const sw = page.locator('.card[data-path="switches[0]"]');
    const sendBy = sw.locator('.ns-send-by');
    // Both channels are listed: SMS as usual, Telegram ticked but disabled, with the note under it.
    assert.deepEqual(await sendBy.locator('.form-check-label').allTextContents(), ['SMS (1 number)', 'Telegram (2 chats)']);
    assert.deepEqual(await sendBy.locator('input').evaluateAll((nodes) => nodes.map((node) => node.checked)), [true, true]);
    const telegram = sendBy.locator('[data-path="switches[0].channels.telegram"]');
    assert.equal(await telegram.evaluate((node) => node.classList.contains('ns-send-by-unserved')), true);
    assert.equal(await telegram.locator('.ns-send-by-note').textContent(), 'No provider configured for Telegram; add one or untick to remove.');
    assert.equal(await telegram.locator('.form-check-label').evaluate((node) => Number(getComputedStyle(node).opacity) < 1), true, 'drawn as disabled');
    assert.equal(await telegram.locator('input').getAttribute('aria-describedby'), 'switches[0].channels.telegram.note');
    assert.equal(await telegram.locator('input').isEnabled(), true, 'the box can still be unticked');
    assert.equal(await sendBy.locator('[data-path="switches[0].channels.sms"]').evaluate((node) => node.classList.contains('ns-send-by-unserved')), false);
    // The stored action is written back as it was, and the missing provider stays out of the preview and Advanced.
    assert.deepEqual(await lastPushed(page), fixture);
    assert.equal(await sw.locator('.ns-send-preview').textContent(), 'Will send SMS via Twilio to 1 number.');
    assert.equal(await sw.locator('details.ns-advanced[data-advanced="switches[0]"]').evaluate((node) => node.open), false, 'nothing to show under Advanced');
    assert.equal(await sw.locator('[data-path="switches[0].providers.telegram"]').isVisible(), false);
    // Save waits for a provider or the untick; the note is the issue, listed once and linked to the checkbox.
    await page.waitForFunction(() => window.__hb.save.at(-1) === false);
    assert.deepEqual(await page.locator('.issues .ns-issue-link').allTextContents(),
      ['Switch 1 "Telegram Bot Removed": No provider configured for Telegram; add one or untick to remove.']);
    assert.equal(await page.locator('.issues .ns-issue-link').getAttribute('data-issue-path'), 'switches[0].channels.telegram');
    assert.equal(await sw.locator('.ns-test-send-hint').textContent(), 'Fix the errors above first');

    // Unticking drops the action and its row (a click, since the box is gone before an uncheck could confirm it); the rest is
    // written unchanged and Save is enabled.
    await telegram.locator('input').click();
    assert.deepEqual(await sendBy.locator('.form-check-label').allTextContents(), ['SMS (1 number)']);
    await page.waitForFunction(() => window.__hb.updates.at(-1)?.[0].switches[0].actions.length === 1);
    assert.deepEqual(await lastPushed(page), { ...fixture, switches: [{ ...fixture.switches[0], actions: [fixture.switches[0].actions[0]] }] });
    assert.equal(await page.evaluate(() => window.__hb.save.at(-1)), true);
    assert.equal(await page.locator('.issues .ns-issue-link').count(), 0);
    await page.close();

    // Adding a Telegram provider instead makes the channel an ordinary one; the stored action then names the new provider's id
    // through the platform default only when the ids match, so the override shows the old id as missing until it is changed.
    const restored = { ...fixture, providers: [...fixture.providers, { ...TELEGRAM, id: 'telegram-home' }] };
    const page2 = await openSettings(browser, restored);
    const sendBy2 = page2.locator('.card[data-path="switches[0]"] .ns-send-by');
    assert.deepEqual(await sendBy2.locator('.form-check-label').allTextContents(), ['SMS (1 number)', 'Telegram (2 chats)']);
    assert.equal(await sendBy2.locator('.ns-send-by-unserved').count(), 0);
    assert.equal(await page2.locator('.card[data-path="switches[0]"] .ns-send-preview').textContent(),
      'Will send SMS via Twilio to 1 number, Telegram via Telegram to 2 chats.');
    assert.deepEqual(await lastPushed(page2), restored, 'the action is written back unchanged with its provider in place again');
    await page2.waitForFunction(() => window.__hb.save.at(-1) === true);
  } finally {
    await browser.close();
  }
});
