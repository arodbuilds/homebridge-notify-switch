import assert from 'node:assert/strict';
import { test } from 'node:test';

import { launchOrSkip, openSettings } from './browser.mjs';
import { NTFY, SMTP, TWILIO } from './helpers.mjs';

/**
 * Duplicate switch and Duplicate group (SPEC section 11.2, item 11): a copy directly below the source, named
 * "{name} copy" (then "copy 2", within the 64-character cap; "Copy" for an empty name), with a new id (a UUID for a
 * switch; a slug from the new name for a group) and everything else identical, treated as a new card.
 */

const CAPPED = 'Water Leak Alert In The Basement Next To The Boiler And The Wash'; // 64 characters, a valid HAP name

const CONFIG = {
  platform: 'NotifySwitch',
  name: 'Notify Switch',
  defaultCountry: 'US',
  defaultProviders: { email: 'fastmail' },
  providers: [TWILIO, SMTP, NTFY],
  groups: [
    { id: 'family', name: 'Family', sms: ['+16785550101'], email: ['a@example.com'], telegram: [], ntfy: ['home-alerts'] },
    { id: 'neighbours', name: 'Neighbours', sms: [], email: ['n@example.com'], telegram: [], ntfy: [] },
  ],
  switches: [
    {
      id: '6f1c2a9e-2b1c-4b8f-9d1e-0c5a1e2f3a4b',
      name: 'Water Leak Alert',
      enabled: false,
      cooldownSeconds: 90,
      failureMode: 'all',
      failureSensor: true,
      failureSensorResetSeconds: 120,
      actions: [
        { providerId: 'twilio-main', channel: 'sms', groups: ['family'], recipients: ['+13055550123'], sender: '+16785550100', body: 'Leak!' },
        { providerId: 'twilio-main', channel: 'email', groups: ['family'], recipients: [], subject: 'Leak', bcc: true, body: 'Water at {{time}}.' },
      ],
    },
    { id: '7a2d3b4c-5e6f-4a7b-8c9d-0e1f2a3b4c5d', name: CAPPED, actions: [{ providerId: 'fastmail', channel: 'email', groups: ['neighbours'], body: 'Hi' }] },
  ],
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

async function pushedSwitches(page, predicate) {
  await page.waitForFunction(predicate);
  return page.evaluate(() => window.__hb.updates.at(-1)[0].switches);
}

test('duplicate switch: a copy directly below with a new UUID, the copy name and identical actions and settings', async (t) => {
  const browser = await launchOrSkip(t);
  if (!browser) {
    return;
  }
  try {
    const page = await openSettings(browser, CONFIG);
    const source = page.locator('.card[data-path="switches[0]"]');
    const duplicate = source.locator('.card-footer').getByRole('button', { name: 'Duplicate switch' });
    assert.match(await duplicate.getAttribute('class'), /\bbtn-link\b/, 'a text button');
    assert.doesNotMatch(await duplicate.getAttribute('class'), /text-danger/, 'not red');
    assert.deepEqual(await source.locator('.card-footer .ns-footer-left button').allTextContents(), ['Remove switch', 'Duplicate switch'],
      'beside Remove switch');
    await duplicate.click();
    assert.equal(await page.locator('.card[data-path^="switches"]').count(), 3);
    const copy = page.locator('.card[data-path="switches[1]"]');
    assert.equal(await copy.locator('[data-path="switches[1].name"] input').inputValue(), 'Water Leak Alert copy');
    assert.equal(await page.locator('.card[data-path="switches[2]"] [data-path="switches[2].name"] input').inputValue(), CAPPED,
      'the copy sits directly below the source, before the other switch');
    assert.equal(await copy.locator('[data-path="switches[1].name"] input').evaluate((node) => node === document.activeElement), true,
      'the copy\'s Name field has focus');
    assert.match(await copy.getAttribute('class'), /\bns-fresh\b/, 'treated as a new switch');
    assert.equal(await copy.locator('.is-invalid').count(), 0);
    const switches = await pushedSwitches(page, () => window.__hb.updates.at(-1)?.[0].switches.length === 3);
    const [original, copied] = switches;
    assert.match(copied.id, UUID);
    assert.notEqual(copied.id, original.id, 'a new UUID');
    assert.deepEqual(copied.actions, original.actions, 'actions are equal');
    assert.deepEqual(
      { ...copied, id: undefined, name: undefined }, { ...original, id: undefined, name: undefined },
      'cooldown, failure mode, failure sensor and enabled state are copied');
    assert.equal(copied.enabled, false);
    assert.equal(copied.cooldownSeconds, 90);
    assert.equal(copied.failureMode, 'all');
    assert.equal(copied.failureSensor, true);
    assert.equal(copied.failureSensorResetSeconds, 120);
    // The copy is its own switch (the source's differing bodies open Customize on both): editing it leaves the source alone.
    assert.equal(await copy.locator('[data-path="switches[1].customize"] input').isChecked(), true);
    await copy.locator('[data-path="switches[1].bodies.sms"] textarea').fill('Copy says hi');
    const edited = await pushedSwitches(page, () => window.__hb.updates.at(-1)?.[0].switches[1].actions[0].body === 'Copy says hi');
    assert.equal(edited[0].actions[0].body, 'Leak!');
    assert.equal(edited[1].actions[1].body, 'Water at {{time}}.');
    await page.waitForFunction(() => window.__hb.save.at(-1) === true);

    // A second copy of the source: "copy 2"; a copy of the copy: "Water Leak Alert copy copy".
    await source.locator('.card-footer').getByRole('button', { name: 'Duplicate switch' }).click();
    assert.equal(await page.locator('.card[data-path="switches[1]"] [data-path="switches[1].name"] input').inputValue(), 'Water Leak Alert copy 2');
    await page.locator('.card[data-path="switches[2]"] .card-footer').getByRole('button', { name: 'Duplicate switch' }).click();
    assert.equal(await page.locator('.card[data-path="switches[3]"] [data-path="switches[3].name"] input').inputValue(), 'Water Leak Alert copy copy');
    // The 64-character cap: the source name is cut to make room for the suffix.
    await page.locator('.card[data-path="switches[4]"] .card-footer').getByRole('button', { name: 'Duplicate switch' }).click();
    const capped = await page.locator('.card[data-path="switches[5]"] [data-path="switches[5].name"] input').inputValue();
    assert.equal(capped.length, 64);
    assert.equal(capped, `${CAPPED.slice(0, 59).trimEnd()} copy`);
    await page.locator('.card[data-path="switches[4]"] .card-footer').getByRole('button', { name: 'Duplicate switch' }).click();
    const capped2 = await page.locator('.card[data-path="switches[5]"] [data-path="switches[5].name"] input').inputValue();
    assert.equal(capped2.length, 64);
    assert.equal(capped2, `${CAPPED.slice(0, 57).trimEnd()} copy 2`);
    const all = await pushedSwitches(page, () => window.__hb.updates.at(-1)?.[0].switches.length === 7);
    assert.equal(new Set(all.map((s) => s.id)).size, 7, 'every id differs');
    assert.equal(new Set(all.map((s) => s.name)).size, 7, 'every name differs');
    await page.waitForFunction(() => window.__hb.save.at(-1) === true);
    await page.close();

    // An unnamed source: the copy is "Copy".
    const unnamed = await openSettings(browser, { ...CONFIG, switches: [{ ...CONFIG.switches[0], name: '' }] });
    await unnamed.locator('.card[data-path="switches[0]"] .card-footer').getByRole('button', { name: 'Duplicate switch' }).click();
    assert.equal(await unnamed.locator('.card[data-path="switches[1]"] [data-path="switches[1].name"] input').inputValue(), 'Copy');
    await unnamed.locator('.card[data-path="switches[0]"] .card-footer').getByRole('button', { name: 'Duplicate switch' }).click();
    assert.equal(await unnamed.locator('.card[data-path="switches[1]"] [data-path="switches[1].name"] input').inputValue(), 'Copy 2');
  } finally {
    await browser.close();
  }
});
