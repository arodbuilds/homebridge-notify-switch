import assert from 'node:assert/strict';
import { test } from 'node:test';

import { launchOrSkip, openSettings } from './browser.mjs';
import { TWILIO } from './helpers.mjs';

/**
 * Twilio card in the built settings UI (SPEC section 11.2, item 9): "Look up numbers" is enabled once
 * the three credentials are filled, lists numbers and Messaging Services as dropdowns, and selecting
 * adds a sender or fills the Messaging Service SID under Advanced. Manual entry stays available.
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

const LOOKUP_OK = {
  ok: true,
  message: 'Found 2 phone numbers and 1 Messaging Service.',
  numbers: [{ phoneNumber: '+16785550100', friendlyName: 'Line 1' }, { phoneNumber: '+16785550199', friendlyName: 'Line 2' }],
  services: [{ sid: 'MG00000000000000000000000000000000', friendlyName: 'Alerts' }],
  truncated: false,
};

/** Answers Look up numbers with the fixture the test hands to the page as `window.__fixture` (data, never source). */
const REQUESTS = 'async (path) => path === \'/twilio-lookup\' ? window.__fixture : { ok: true, message: \'stub\' }';

const CARD = '.card[data-path="providers[0]"]';

test('twilio card: Look up numbers fills the dropdowns and selecting adds a sender or a Messaging Service', async (t) => {
  const browser = await launchOrSkip(t);
  if (!browser) {
    return;
  }
  try {
    const page = await openSettings(browser, CONFIG, { requestScript: REQUESTS, fixture: LOOKUP_OK });
    const lookup = page.locator(CARD).getByRole('button', { name: 'Look up numbers' });
    assert.equal(await lookup.isEnabled(), true, 'enabled: all three credentials are filled');

    // Clearing a credential disables the button; filling it again re-enables it.
    const secret = page.locator(`${CARD} [data-path="providers[0].apiKeySecret"] input`);
    await secret.fill('');
    assert.equal(await lookup.isEnabled(), false);
    await secret.fill(TWILIO.apiKeySecret);
    assert.equal(await lookup.isEnabled(), true);

    // Messaging Service SID lives under the Advanced disclosure, collapsed by default when empty.
    const advanced = page.locator(`${CARD} details.ns-advanced`);
    assert.equal(await advanced.evaluate((node) => node.open), false);
    assert.equal(await advanced.locator('[data-path="providers[0].messagingServiceSid"] input').count(), 1);
    assert.equal(await advanced.locator('[data-path="providers[0].credentialsFile"] input').count(), 1);
    assert.match(await advanced.locator('[data-path="providers[0].messagingServiceSid"] .form-text').textContent(),
      /^Optional\. Use a Messaging Service instead/);
    // The Advanced grid (SPEC section 11.2, item 28): ID and Messaging Service SID share a row at 6 columns, the credentials file takes 12.
    assert.deepEqual(await advanced.locator('.ns-grid > *').evaluateAll((nodes) => nodes.map((node) => [node.className, node.firstElementChild.dataset.path])),
      [['ns-span-6', 'providers[0].id'], ['ns-span-6', 'providers[0].messagingServiceSid'], ['ns-span-12', 'providers[0].credentialsFile']]);
    assert.equal(await page.locator(`${CARD} [data-path="providers[0].apiKeySid"] input`).getAttribute('placeholder'), 'e.g. SK…');

    await lookup.click();
    await page.waitForSelector(`${CARD} select[data-lookup="numbers"]`);
    assert.equal(await page.locator(`${CARD} .ns-lookup .status-box`).textContent(), 'Found 2 phone numbers and 1 Messaging Service.');
    const numbers = page.locator(`${CARD} select[data-lookup="numbers"]`);
    assert.deepEqual(await numbers.locator('option').allTextContents(),
      ['Choose a phone number…', '+16785550100 (Line 1)', '+16785550199 (Line 2)']);
    const services = page.locator(`${CARD} select[data-lookup="services"]`);
    assert.deepEqual(await services.locator('option').allTextContents(), ['Choose a Messaging Service…', 'Alerts (MG00000000000000000000000000000000)']);
    const request = await page.evaluate(() => window.__hb.requests.find((entry) => entry.path === '/twilio-lookup'));
    assert.equal(request.payload.provider.apiKeySid, TWILIO.apiKeySid, 'the form values are sent to the server');

    // Selecting a number appends it to the senders list once and resets the dropdown.
    await numbers.selectOption('+16785550199');
    await page.waitForFunction(() => window.__hb.updates.at(-1)?.[0].providers[0].smsSenders.length === 2);
    assert.deepEqual(await page.evaluate(() => window.__hb.updates.at(-1)[0].providers[0].smsSenders), ['+16785550100', '+16785550199']);
    assert.equal(await page.locator(`${CARD} .address-row[data-path="providers[0].smsSenders[1]"] input.phone-national`).inputValue(), '(678) 555-0199');
    assert.equal(await numbers.inputValue(), '');
    await numbers.selectOption('+16785550199');
    assert.equal(await page.locator(`${CARD} .address-row`).count(), 2, 'a number already in the list is not added twice');

    // Selecting a Messaging Service fills the field under Advanced and opens the disclosure.
    await services.selectOption('MG00000000000000000000000000000000');
    assert.equal(await advanced.evaluate((node) => node.open), true);
    assert.equal(await advanced.locator('[data-path="providers[0].messagingServiceSid"] input').inputValue(), 'MG00000000000000000000000000000000');
    await page.waitForFunction(() => window.__hb.updates.at(-1)?.[0].providers[0].messagingServiceSid === 'MG00000000000000000000000000000000');

    // Manual entry still works alongside the lookup.
    await page.locator(CARD).getByRole('button', { name: 'Add sender number' }).click();
    assert.equal(await page.locator(`${CARD} .address-row`).count(), 3);
  } finally {
    await browser.close();
  }
});

test('twilio card: the paging note and the permission failure are shown as returned by the server', async (t) => {
  const browser = await launchOrSkip(t);
  if (!browser) {
    return;
  }
  try {
    const truncated = {
      ...LOOKUP_OK,
      truncated: true,
      message: 'Found 20 phone numbers and 1 Messaging Service. Showing the first 20; enter others manually.',
    };
    let page = await openSettings(browser, CONFIG, { requestScript: REQUESTS, fixture: truncated });
    await page.locator(CARD).getByRole('button', { name: 'Look up numbers' }).click();
    await page.waitForSelector(`${CARD} select[data-lookup="numbers"]`);
    assert.match(await page.locator(`${CARD} .ns-lookup .status-box`).textContent(), /Showing the first 20; enter others manually\.$/);
    await page.close();

    const denied = { ok: false, message: 'This API key cannot list numbers. Enter them manually.', numbers: [], services: [], truncated: false };
    page = await openSettings(browser, CONFIG, { requestScript: REQUESTS, fixture: denied });
    await page.locator(CARD).getByRole('button', { name: 'Look up numbers' }).click();
    await page.waitForSelector(`${CARD} .ns-lookup .status-box.alert-danger`);
    assert.equal(await page.locator(`${CARD} .ns-lookup .status-box`).textContent(), 'This API key cannot list numbers. Enter them manually.');
    assert.equal(await page.locator(`${CARD} select[data-lookup]`).count(), 0, 'no dropdowns without results');
    assert.equal(await page.locator(CARD).getByRole('button', { name: 'Add sender number' }).isEnabled(), true, 'manual entry remains available');
  } finally {
    await browser.close();
  }
});
