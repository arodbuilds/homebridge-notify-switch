import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { test } from 'node:test';

import { launchOrSkip, lastPushed, openSettings } from './browser.mjs';

/**
 * The switch editor derives its form from the stored `actions` array and writes it back (SPEC section 5.4
 * and section 11.2, item 8). Every fixture under test/fixtures is loaded into the built settings UI,
 * rendered, written through `updatePluginConfig`, and compared with the file: the round trip is lossless,
 * per-channel bodies and subjects, provider overrides, senders, BCC, ntfy options, an unticked channel,
 * the stored action order, and actions past the first per channel included.
 */

const FIXTURES = resolve(import.meta.dirname, '..', 'fixtures');

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
      assert.deepEqual(await page.evaluate(() => window.__hb.save.at(-1)), true, `${file} is valid, so Save is enabled`);
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

    // Actions past the first per channel are kept aside with a note.
    const extra = JSON.parse(readFileSync(join(FIXTURES, 'extra-actions.json'), 'utf8'));
    page = await openSettings(browser, extra);
    assert.equal(await page.locator('.ns-extra-actions .form-text').textContent(),
      'config.json has more than one SMS action on this switch. The extra ones are kept as they are.');
    assert.equal(await page.locator('.card[data-path="switches[0]"] details.ns-advanced').evaluate((node) => node.open), true);
    await page.close();
  } finally {
    await browser.close();
  }
});
