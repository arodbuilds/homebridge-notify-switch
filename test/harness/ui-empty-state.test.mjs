import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { test } from 'node:test';

import { launchOrSkip, openSettings } from './browser.mjs';
import { TWILIO } from './helpers.mjs';

/**
 * The guided empty state, the Save status area, the version and credit footer, and the default country
 * prefilled from the browser locale (SPEC section 11.2, items 19 to 21) in the built settings UI.
 */

/** A fresh install: the Homebridge UI hands the page no platform block, so the stub returns an empty list. */
const EMPTY = { platform: 'NotifySwitch', name: 'Notify Switch' };

const WITH_PROVIDER = {
  platform: 'NotifySwitch',
  name: 'Notify Switch',
  defaultCountry: 'US',
  providers: [TWILIO],
  groups: [],
  switches: [],
};

const ROOT = resolve(import.meta.dirname, '..', '..');
const PACKAGE_VERSION = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version;

/** A server stub that answers the footer's version request like the real server.js does. */
const VERSION_SERVER = `async (path) => path === '/version'
  ? { ok: true, message: '', version: ${JSON.stringify(PACKAGE_VERSION)} }
  : { ok: true, message: 'stub' }`;

test('guided empty state: a Get started card with the chooser tiles, disabled Add buttons, and "Nothing to save yet"', async (t) => {
  const browser = await launchOrSkip(t);
  if (!browser) {
    return;
  }
  try {
    const page = await openSettings(browser, EMPTY);
    // The Providers section body is the Get started card and nothing else: no intro, no Add provider button.
    const providers = page.locator('#section-providers');
    const card = providers.locator('.card.ns-get-started');
    assert.equal(await card.count(), 1);
    assert.equal(await card.locator('.card-header').textContent(), 'Get started');
    assert.equal(await card.locator('.ns-get-started-intro').textContent(), 'Choose how you want to send messages. You can add more providers later.');
    assert.deepEqual(await card.locator('.ns-chooser-tile .fw-semibold').allTextContents(), ['Twilio', 'Email (SMTP)', 'Telegram']);
    assert.equal(await providers.locator('.section-copy').count(), 0, 'the section intro gives way to the card');
    assert.equal(await providers.getByRole('button', { name: 'Add provider' }).count(), 0);
    assert.equal(await providers.locator('.form-text').count(), 0, 'no "No providers yet" line either');

    // Groups and Switches stay visible; their Add buttons are disabled with the hint beside them.
    for (const [section, label] of [['groups', 'Add group'], ['switches', 'Add switch']]) {
      const button = page.locator(`#section-${section}`).getByRole('button', { name: label });
      assert.equal(await button.count(), 1, `${label} is still there`);
      assert.equal(await button.isDisabled(), true, `${label} is disabled`);
      assert.equal(await button.getAttribute('title'), 'Add a provider first.');
      assert.equal(await page.locator(`#section-${section} .ns-add-hint`).textContent(), 'Add a provider first.');
      assert.equal(await page.locator(`#section-${section} .section-copy`).count(), 1, `the ${section} intro is still shown`);
    }
    assert.equal(await page.locator('#section-groups .form-text').first().textContent(), 'No groups yet.');

    // The Save status area reads "Nothing to save yet" and Save is enabled: the empty configuration is valid.
    const status = page.locator('.issues');
    assert.equal(await status.isVisible(), true);
    assert.equal(await status.locator('.fw-semibold').textContent(), 'Nothing to save yet');
    assert.equal(await status.locator('li').count(), 0);
    assert.equal(await status.getAttribute('role'), 'status');
    assert.match(await status.getAttribute('class'), /\balert-secondary\b/);
    await page.waitForFunction(() => window.__hb.save.length > 0);
    assert.equal(await page.evaluate(() => window.__hb.save.at(-1)), true);

    // Picking a tile creates the provider and the page renders as it does today.
    await card.locator('.ns-chooser-tile[data-type="telegram"]').click();
    assert.equal(await page.locator('.ns-get-started').count(), 0, 'the Get started card is gone');
    assert.equal(await page.locator('.card[data-path="providers[0]"] .card-header .badge').textContent(), 'Telegram');
    assert.equal(await providers.getByRole('button', { name: 'Add provider' }).count(), 1, 'Add provider is back');
    assert.equal(await providers.locator('.section-copy').count(), 1, 'so is the section intro');
    for (const [section, label] of [['groups', 'Add group'], ['switches', 'Add switch']]) {
      const button = page.locator(`#section-${section}`).getByRole('button', { name: label });
      assert.equal(await button.isDisabled(), false, `${label} is enabled again`);
      assert.match(await button.getAttribute('class'), /\bbtn-primary\b/);
      assert.equal(await page.locator(`#section-${section} .ns-add-hint`).count(), 0, 'the hint is gone');
    }
    // The new card is fresh, so the status area now explains why Save is disabled instead.
    assert.equal(await status.locator('.fw-semibold').textContent(), 'Fill in the new provider to enable Save.');
    await page.waitForFunction(() => window.__hb.updates.at(-1)?.[0].providers.length === 1);

    // Removing the last provider (through the in-place confirmation) brings the guided empty state back and disables the Add buttons again.
    await page.getByRole('button', { name: 'Remove provider' }).click();
    assert.equal(await page.locator('.ns-remove-confirm .ns-confirm-question').textContent(), 'Remove this provider?');
    await page.locator('.ns-remove-confirm').getByRole('button', { name: 'Remove', exact: true }).click();
    assert.equal(await page.locator('.ns-get-started').count(), 1);
    assert.equal(await page.locator('#section-groups').getByRole('button', { name: 'Add group' }).isDisabled(), true);
    assert.equal(await page.locator('#section-switches').getByRole('button', { name: 'Add switch' }).isDisabled(), true);
    assert.equal(await status.locator('.fw-semibold').textContent(), 'Nothing to save yet');

    // With a provider but no group, "Nothing to save yet" does not apply and the status area is hidden.
    await page.locator('.ns-chooser-tile[data-type="smtp"]').click();
    await page.getByRole('button', { name: 'Add group' }).click();
    assert.equal(await page.locator('.card[data-path="groups[0]"]').count(), 1);
  } finally {
    await browser.close();
  }
});

test('footer: the mark, version from the server, credit, and two links that open in a new tab, as the last element of the page', async (t) => {
  const browser = await launchOrSkip(t);
  if (!browser) {
    return;
  }
  try {
    const page = await openSettings(browser, WITH_PROVIDER, { requestScript: VERSION_SERVER });
    const footer = page.locator('#app > footer.ns-footer');
    assert.equal(await footer.count(), 1);
    await page.waitForFunction((version) => document.querySelector('.ns-footer')?.textContent.includes(`v${version}`), PACKAGE_VERSION);
    assert.equal(await footer.textContent(),
      `Notify Switch v${PACKAGE_VERSION} · Made by Alex Rodriguez · alex-rodriguez.com · Report an issue`);
    assert.equal(await page.evaluate(() => document.getElementById('app').lastElementChild.classList.contains('ns-footer')), true,
      'the footer is the last element of the page');
    assert.ok(await page.evaluate(() => window.__hb.requests.some((r) => r.path === '/version')), 'the version was asked from the server');
    // The brand mark: inline SVG at 20px, first thing in the credit, in the text colour (currentColor) and hidden from readers.
    const mark = footer.locator('.ns-footer-item svg.ns-mark-svg');
    assert.equal(await mark.count(), 1);
    assert.equal(await mark.evaluate((svg) => svg.parentElement.firstChild === svg), true, 'the mark comes before the name');
    assert.equal(await mark.getAttribute('aria-hidden'), 'true');
    const box = await mark.boundingBox();
    assert.equal(Math.round(box.width), 20);
    assert.equal(Math.round(box.height), 20);
    assert.equal(await mark.evaluate((svg) => [...svg.querySelectorAll('[stroke], [fill]')].every((node) => {
      const allowed = ['currentColor', 'none', null];
      return allowed.includes(node.getAttribute('stroke')) && allowed.includes(node.getAttribute('fill'));
    })), true, 'the mark carries no colour of its own');
    assert.equal(await mark.evaluate((svg) => getComputedStyle(svg).color === getComputedStyle(svg.closest('.ns-footer')).color), true,
      'the mark takes the footer text colour');
    const links = footer.locator('a');
    assert.deepEqual(await links.allTextContents(), ['alex-rodriguez.com', 'Report an issue']);
    assert.deepEqual(await links.evaluateAll((nodes) => nodes.map((a) => [a.getAttribute('href'), a.getAttribute('target'), a.getAttribute('rel')])), [
      ['https://alex-rodriguez.com/?ref=notify-switch#building', '_blank', 'noopener noreferrer'],
      ['https://github.com/arodbuilds/homebridge-notify-switch/issues', '_blank', 'noopener noreferrer'],
    ]);
    // One line on a wide screen; it wraps between items, never past the edge, on a phone.
    const wide = await footer.boundingBox();
    const lineHeight = await footer.evaluate((node) => Number.parseFloat(getComputedStyle(node).lineHeight));
    assert.ok(wide.height < lineHeight * 1.5 + 12, `one line at 900px (height ${wide.height})`);
    await page.setViewportSize({ width: 320, height: 800 });
    const narrow = await footer.boundingBox();
    assert.ok(narrow.height > wide.height, 'wraps on a narrow screen');
    assert.ok(narrow.x + narrow.width <= 320, 'stays inside the viewport');
    await page.close();

    // When the server does not answer with a version, the footer shows the name alone.
    const fallback = await openSettings(browser, WITH_PROVIDER);
    await fallback.waitForFunction(() => window.__hb.requests.some((r) => r.path === '/version'));
    assert.equal(await fallback.locator('.ns-footer').textContent(), 'Notify Switch · Made by Alex Rodriguez · alex-rodriguez.com · Report an issue');
  } finally {
    await browser.close();
  }
});

/** A server stub that answers the host time zone request with the given zone (or a failure when `zone` is null). */
function timeZoneServer(zone) {
  return `async (path) => path === '/host-timezone'
    ? ${zone === null ? '{ ok: false, message: "no zone", timeZone: "" }' : `{ ok: true, message: '', timeZone: ${JSON.stringify(zone)} }`}
    : { ok: true, message: 'stub' }`;
}

test('default country: the locale region, else the host time zone, else US on first load; a saved value is never overridden', async (t) => {
  const browser = await launchOrSkip(t);
  if (!browser) {
    return;
  }
  try {
    // First load, no saved defaultCountry: the locale's region wins, whatever the host's zone says.
    let page = await openSettings(browser, EMPTY, { locale: 'en-GB', requestScript: timeZoneServer('Europe/Berlin') });
    assert.equal(await page.evaluate(() => navigator.language), 'en-GB');
    assert.equal(await page.locator('[data-path="defaultCountry"] select').inputValue(), 'GB');
    await page.waitForFunction(() => window.__hb.updates.length > 0);
    assert.equal(await page.evaluate(() => window.__hb.updates.at(-1)[0].defaultCountry), 'GB', 'the prefilled value is what Save will write');
    assert.equal(await page.evaluate(() => window.__hb.requests.some((r) => r.path === '/host-timezone')), false, 'the host is not asked');
    await page.close();

    // A locale without a region: the country of the Homebridge host's time zone (SPEC section 11.2, item 21).
    page = await openSettings(browser, EMPTY, { locale: 'de', requestScript: timeZoneServer('Europe/Berlin') });
    assert.equal(await page.locator('[data-path="defaultCountry"] select').inputValue(), 'DE');
    assert.equal(await page.evaluate(() => window.__hb.requests.some((r) => r.path === '/host-timezone')), true, 'the host was asked');
    await page.waitForFunction(() => window.__hb.updates.length > 0);
    assert.equal(await page.evaluate(() => window.__hb.updates.at(-1)[0].defaultCountry), 'DE');
    await page.close();

    // A host zone that names no country (UTC), or a server that cannot answer, falls back to US.
    page = await openSettings(browser, EMPTY, { locale: 'de', requestScript: timeZoneServer('UTC') });
    assert.equal(await page.locator('[data-path="defaultCountry"] select').inputValue(), 'US');
    await page.close();
    page = await openSettings(browser, EMPTY, { locale: 'de', requestScript: timeZoneServer(null) });
    assert.equal(await page.locator('[data-path="defaultCountry"] select').inputValue(), 'US');
    await page.close();
    page = await openSettings(browser, EMPTY, { locale: 'de' });
    assert.equal(await page.locator('[data-path="defaultCountry"] select').inputValue(), 'US', 'a server without the endpoint is US too');
    await page.close();

    // A saved value wins over the locale and the host zone.
    page = await openSettings(browser, { ...WITH_PROVIDER, defaultCountry: 'CA' }, { locale: 'de', requestScript: timeZoneServer('Europe/Berlin') });
    assert.equal(await page.locator('[data-path="defaultCountry"] select').inputValue(), 'CA');
    await page.waitForFunction(() => window.__hb.updates.length > 0);
    assert.equal(await page.evaluate(() => window.__hb.updates.at(-1)[0].defaultCountry), 'CA');
    await page.close();

    page = await openSettings(browser, { ...WITH_PROVIDER, defaultCountry: 'CA' }, { locale: 'en-GB' });
    assert.equal(await page.locator('[data-path="defaultCountry"] select').inputValue(), 'CA');
  } finally {
    await browser.close();
  }
});
