import assert from 'node:assert/strict';
import { test } from 'node:test';

import { launchOrSkip, openSettings } from './browser.mjs';
import { TELEGRAM } from './helpers.mjs';

/**
 * Telegram onboarding flow in the built settings UI (SPEC section 11.2, item 10): three guided steps
 * with links and QR codes built from the bot's username, step 2 deciding what step 3 shows, the
 * phone-friendly alternative to QR codes, then Find people and groups adding chat ids to the chosen
 * recipient group.
 */

const CONFIG = {
  platform: 'NotifySwitch',
  name: 'Notify Switch',
  providers: [TELEGRAM],
  groups: [
    { id: 'family', name: 'Family', sms: [], email: [], telegram: ['123456789'] },
    { id: 'neighbours', name: 'Neighbours', sms: [], email: [], telegram: [] },
  ],
  switches: [{
    id: '6f1c2a9e-2b1c-4b8f-9d1e-0c5a1e2f3a4b',
    name: 'Water Leak Alert',
    actions: [{ providerId: 'telegram-home', channel: 'telegram', groups: ['family'], body: 'Water detected.' }],
  }],
};

const REQUESTS = `async (path) => {
  if (path === '/telegram-bot') { return { ok: true, message: 'Connected to @home_alerts_bot', username: 'home_alerts_bot' }; }
  if (path === '/find-chats') {
    return { ok: true, message: 'Found 2 chats.', chats: [
      { id: '123456789', title: 'Alex (@alexr)', type: 'private' },
      { id: '-1001234567890', title: 'Home Alerts', type: 'supergroup' },
    ] };
  }
  return { ok: true, message: 'stub' };
}`;

const CARD = '.card[data-path="providers[0]"]';
const START_GROUP = 'https://t.me/home_alerts_bot?startgroup=true';
const INVITE = 'https://t.me/home_alerts_bot?start=join';
const INVITE_MESSAGE = `Tap this link and press Start to get alerts from our home: ${INVITE}`;

/** Records clipboard writes in `window.__copied` (the page prefers the async clipboard API when present). */
const CLIPBOARD = `(() => {
  window.__copied = [];
  Object.defineProperty(window.navigator, 'clipboard', { value: { writeText: async (text) => { window.__copied.push(text); } } });
})()`;

test('telegram card: step 1 copy, step 2 driving step 3, and the invite copy buttons', async (t) => {
  const browser = await launchOrSkip(t);
  if (!browser) {
    return;
  }
  try {
    const page = await openSettings(browser, CONFIG, { requestScript: REQUESTS });
    await page.evaluate(CLIPBOARD);
    const card = page.locator(CARD);
    const steps = card.locator('.ns-step');
    assert.deepEqual(await steps.locator('.ns-step-title').allTextContents(),
      ['1Create your bot', '2Choose how people receive messages', '3Add the bot to your group', '4Find people and groups']);

    // Step 1: intro sentence, BotFather link, its QR code with caption, and the four instructions.
    const step1 = steps.nth(0);
    assert.equal(await step1.locator('.ns-step-intro').textContent(),
      'On your phone, scan this code with the camera to open BotFather in Telegram. On a computer with Telegram installed, '
      + 'click Open BotFather instead. Then, in the BotFather chat:');
    assert.equal(await step1.getByRole('button', { name: 'Open BotFather' }).getAttribute('href'), 'https://t.me/BotFather');
    assert.equal(await step1.locator('.ns-qr').getAttribute('data-qr'), 'https://t.me/BotFather');
    assert.equal(await step1.locator('.ns-qr svg').count(), 1);
    assert.equal(await step1.locator('.ns-qr-caption').textContent(), 'Scan to open BotFather');
    assert.deepEqual(await step1.locator('ol li').allTextContents(), [
      'Send /newbot.',
      'Choose a display name such as Home Alerts.',
      'Choose a username ending in bot, for example homealerts_bot.',
      'BotFather replies with a token. Copy it and paste it below.',
    ]);
    assert.match(await step1.locator('[data-path="providers[0].botToken"] .ns-help').textContent(),
      /^BotFather sends the token\. It looks like 123456789:AAF… Treat it like a password\. Where do I find this\?$/);
    await page.waitForSelector(`${CARD} .ns-step[data-step="1"] .status-box.alert-success`);
    assert.equal(await step1.locator('.status-box').textContent(), 'Connected to @home_alerts_bot');

    // Step 2: two selectable cards, the group option preselected, and no QR code or link inside the tiles.
    const cards = steps.nth(1).locator('.ns-mode-card');
    assert.deepEqual(await cards.evaluateAll((nodes) => nodes.map((node) => node.getAttribute('aria-checked'))), ['true', 'false']);
    assert.match(await cards.nth(0).textContent(), /Family group chat \(recommended\)/);
    assert.match(await cards.nth(0).textContent(), /Everyone in the group gets every message\. Nobody has to opt in individually\./);
    assert.match(await cards.nth(1).textContent(), /Individual chats/);
    assert.match(await cards.nth(1).textContent(), /Each person opens the bot and taps Start once\./);
    assert.equal(await steps.nth(1).locator('.ns-qr').count(), 0, 'no QR code inside step 2');
    assert.equal(await steps.nth(1).locator('a').count(), 0, 'no link inside step 2');

    // Step 3 with the group option: the startgroup QR, link, Copy link and the sentence; never the invite QR.
    const step3 = steps.nth(2);
    assert.equal(await step3.getAttribute('data-mode'), 'group');
    assert.equal(await step3.locator('.ns-qr').count(), 1);
    assert.equal(await step3.locator('.ns-qr').getAttribute('data-qr'), START_GROUP);
    assert.equal(await step3.locator('.ns-qr-caption').textContent(), 'Scan to add the bot to a group');
    assert.equal(await step3.locator('.ns-step-link').getAttribute('href'), START_GROUP);
    assert.equal(await step3.getByRole('button', { name: 'Add bot to a group' }).getAttribute('href'), START_GROUP);
    assert.equal(await step3.getByRole('button', { name: 'Enlarge' }).count(), 0);
    assert.equal(await step3.getByRole('button', { name: 'Copy invite message' }).count(), 0);
    assert.match(await step3.textContent(),
      /Open Telegram on your phone and scan, or click the button, then pick your family group or create one\. Everyone in the group will get alerts\./);
    await step3.getByRole('button', { name: 'Copy link' }).click();
    assert.deepEqual(await page.evaluate(() => window.__copied), [START_GROUP]);

    // Step 3 with individual chats: the invite QR with Enlarge, Copy link and Copy invite message; never the startgroup QR.
    await cards.nth(1).click();
    assert.deepEqual(await cards.evaluateAll((nodes) => nodes.map((node) => node.getAttribute('aria-checked'))), ['false', 'true']);
    assert.equal(await step3.locator('.ns-step-title').textContent(), '3Invite people');
    assert.equal(await step3.getAttribute('data-mode'), 'individual');
    assert.equal(await step3.locator('.ns-qr').count(), 1);
    assert.equal(await step3.locator('.ns-qr').getAttribute('data-qr'), INVITE);
    assert.equal(await step3.locator('.ns-qr-caption').textContent(), 'Scan to start receiving alerts');
    assert.equal(await step3.locator('.ns-step-link').getAttribute('href'), INVITE);
    assert.equal(await step3.getByRole('button', { name: 'Add bot to a group' }).count(), 0);
    assert.equal(await page.locator(`[data-qr="${START_GROUP}"]`).count(), 0, 'the startgroup QR is gone');
    await step3.getByRole('button', { name: 'Copy link' }).click();
    await step3.getByRole('button', { name: 'Copy invite message' }).click();
    assert.deepEqual(await page.evaluate(() => window.__copied), [START_GROUP, INVITE, INVITE_MESSAGE]);
    await step3.getByRole('button', { name: 'Enlarge' }).click();
    const modal = page.locator('.ns-modal');
    assert.equal(await modal.count(), 1);
    assert.equal(await modal.locator('.ns-qr-large').getAttribute('data-qr'), INVITE);
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('.ns-modal').count(), 0, 'Escape closes the modal');

    // Back to the group option restores step 3 for the group.
    await cards.nth(0).click();
    assert.equal(await step3.locator('.ns-step-title').textContent(), '3Add the bot to your group');
    assert.equal(await step3.locator('.ns-qr').getAttribute('data-qr'), START_GROUP);

    // Parse Mode lives under Advanced, closed while it is plain text, next to the ID and the credentials file.
    const advanced = card.locator('details.ns-advanced[data-advanced="providers[0]"]');
    assert.equal(await advanced.evaluate((node) => node.open), false);
    assert.equal(await advanced.locator('[data-path="providers[0].parseMode"] select').inputValue(), 'none');
    assert.equal(await card.locator('.card-body > [data-path="providers[0].parseMode"]').count(), 0, 'Parse Mode is not in the main form');
    // ID and Parse Mode share a row at 6 columns; the credentials file takes 12 (SPEC section 11.2, item 28).
    assert.deepEqual(await advanced.locator('.ns-grid > *').evaluateAll((nodes) => nodes.map((node) => [node.className, node.firstElementChild.dataset.path])),
      [['ns-span-6', 'providers[0].id'], ['ns-span-6', 'providers[0].parseMode'], ['ns-span-12', 'providers[0].credentialsFile']]);

    // The chat id help on the group card points at the renamed button.
    assert.match(await page.locator('.card[data-path="groups[0]"]').textContent(), /Use Find people and groups on your Telegram provider/);
    assert.equal(await page.getByRole('button', { name: 'Find chat IDs' }).count(), 0);
  } finally {
    await browser.close();
  }
});

test('telegram card: on a phone the QR codes give way to Open in Telegram, Copy link and Share', async (t) => {
  const browser = await launchOrSkip(t);
  if (!browser) {
    return;
  }
  try {
    // A narrow viewport with a stubbed Web Share API.
    const share = `(() => {
      window.__shared = [];
      Object.defineProperty(window.navigator, 'share', { value: async (data) => { window.__shared.push(data); } });
    })()`;
    const page = await openSettings(browser, CONFIG, { requestScript: REQUESTS, viewport: { width: 360, height: 800 }, initScript: share });
    await page.evaluate(CLIPBOARD);
    await page.waitForSelector(`${CARD} .ns-step[data-step="1"] .status-box.alert-success`);
    const step3 = page.locator(`${CARD} .ns-step[data-step="3"]`);
    assert.equal(await step3.locator('.ns-qr-block').isVisible(), false, 'the QR code is hidden on a phone');
    assert.equal(await page.locator(`${CARD} .ns-step[data-step="1"] .ns-qr-block`).isVisible(), false);
    assert.equal(await step3.getByRole('button', { name: 'Add bot to a group' }).count(), 0, 'the desktop actions are hidden');
    const open = step3.getByRole('button', { name: 'Open in Telegram' });
    assert.equal(await open.getAttribute('href'), START_GROUP);
    await step3.getByRole('button', { name: 'Copy link' }).click();
    assert.deepEqual(await page.evaluate(() => window.__copied), [START_GROUP]);
    await step3.getByRole('button', { name: 'Share' }).click();
    assert.deepEqual(await page.evaluate(() => window.__shared.map((data) => data.url)), [START_GROUP]);

    await page.locator(`${CARD} .ns-mode-card[data-mode="individual"]`).click();
    assert.equal(await step3.getByRole('button', { name: 'Enlarge' }).count(), 0, 'Enlarge is hidden with the QR code');
    assert.equal(await step3.getByRole('button', { name: 'Open in Telegram' }).getAttribute('href'), INVITE);
    assert.equal(await step3.getByRole('button', { name: 'Copy invite message' }).count(), 1, 'the invite message can still be copied');
    await page.close();

    // Without the Web Share API the Share button is not shown; a touch device with a wide screen still gets the compact actions.
    const touch = await openSettings(browser, CONFIG, { requestScript: REQUESTS, viewport: { width: 900, height: 900 }, hasTouch: true });
    await touch.waitForSelector(`${CARD} .ns-step[data-step="1"] .status-box.alert-success`);
    const touchStep3 = touch.locator(`${CARD} .ns-step[data-step="3"]`);
    assert.equal(await touch.evaluate(() => document.body.classList.contains('ns-touch')), true);
    assert.equal(await touchStep3.locator('.ns-qr-block').isVisible(), false);
    assert.equal(await touchStep3.getByRole('button', { name: 'Open in Telegram' }).count(), 1);
    assert.equal(await touchStep3.getByRole('button', { name: 'Share' }).count(), 0, 'Share is hidden when the browser has no Web Share API');
  } finally {
    await browser.close();
  }
});

test('telegram card: Find people and groups adds to the chosen recipient group and prompts when none is chosen', async (t) => {
  const browser = await launchOrSkip(t);
  if (!browser) {
    return;
  }
  try {
    const page = await openSettings(browser, CONFIG, { requestScript: REQUESTS });
    const find = page.locator(`${CARD} .find-chats`);
    assert.equal(await find.locator('.ns-after-find').isVisible(), false, 'no hint before a search');
    await find.getByRole('button', { name: 'Find people and groups' }).click();
    await page.waitForSelector(`${CARD} .chat-result`);
    const rows = find.locator('.chat-result');
    assert.equal(await rows.count(), 2);
    assert.match(await rows.nth(0).textContent(), /123456789.*Alex \(@alexr\).*\(private\)/);
    assert.match(await rows.nth(1).textContent(), /-1001234567890.*Home Alerts.*\(supergroup\)/);
    assert.equal(await find.locator('.ns-after-find').textContent(), 'Added people appear in the group\'s Telegram chat IDs list. Save when you\'re done.');
    assert.equal(await find.locator('.ns-after-find').isVisible(), true);

    // Two groups, none chosen yet: Add prompts for a group.
    const groupSelect = find.locator('select');
    assert.equal(await groupSelect.inputValue(), '');
    await rows.nth(1).getByRole('button', { name: 'Add' }).click();
    assert.equal(await find.locator('.status-box').textContent(), 'Choose a recipient group first.');
    assert.equal(await page.evaluate(() => document.activeElement?.tagName), 'SELECT', 'the group dropdown is focused');

    await groupSelect.selectOption('neighbours');
    await rows.nth(1).getByRole('button', { name: 'Add' }).click();
    await page.waitForFunction(() => window.__hb.updates.at(-1)?.[0].groups[1].telegram.length === 1);
    assert.deepEqual(await page.evaluate(() => window.__hb.updates.at(-1)[0].groups[1].telegram), ['-1001234567890']);
    assert.equal(await page.locator('.card[data-path="groups[1]"] .address-row input').inputValue(), '-1001234567890');
    assert.equal(await rows.nth(1).getByRole('button', { name: 'Added to Neighbours' }).count(), 1);
  } finally {
    await browser.close();
  }
});
