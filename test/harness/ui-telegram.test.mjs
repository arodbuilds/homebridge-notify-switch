import assert from 'node:assert/strict';
import { test } from 'node:test';

import { launchOrSkip, openSettings } from './browser.mjs';
import { TELEGRAM } from './helpers.mjs';

/**
 * Telegram onboarding flow in the built settings UI (SPEC section 11.2, item 10): three guided steps
 * with links and QR codes built from the bot's username, then Find people and groups adding chat ids
 * to the chosen recipient group.
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

test('telegram card: the three steps, their links and QR codes, and the invite copy buttons', async (t) => {
  const browser = await launchOrSkip(t);
  if (!browser) {
    return;
  }
  try {
    const page = await openSettings(browser, CONFIG, { requestScript: REQUESTS });
    await page.evaluate(() => {
      window.__copied = [];
      const writeText = async (text) => {
        window.__copied.push(text);
      };
      Object.defineProperty(window.navigator, 'clipboard', { value: { writeText } });
    });
    const card = page.locator(CARD);
    const steps = card.locator('.ns-step');
    assert.deepEqual(await steps.locator('.ns-step-title').allTextContents(),
      ['1Create your bot', '2Choose how people receive messages', '3Invite people', '4Find people and groups']);

    // Step 1: BotFather link, its QR code, and the four instructions.
    const botFather = steps.nth(0).getByRole('button', { name: 'Open BotFather' });
    assert.equal(await botFather.getAttribute('href'), 'https://t.me/BotFather');
    assert.equal(await steps.nth(0).locator('.ns-qr').getAttribute('data-qr'), 'https://t.me/BotFather');
    assert.equal(await steps.nth(0).locator('.ns-qr svg').count(), 1);
    assert.deepEqual(await steps.nth(0).locator('ol li').allTextContents(),
      ['Send /newbot.', 'Choose a display name such as Home Alerts.', 'Choose a username ending in bot.', 'Paste the token below.']);
    await page.waitForSelector(`${CARD} .ns-step[data-step="1"] .status-box.alert-success`);
    assert.equal(await steps.nth(0).locator('.status-box').textContent(), 'Connected to @home_alerts_bot');

    // Step 2: two selectable cards, the group option preselected, with the startgroup link and QR.
    const cards = steps.nth(1).locator('.ns-mode-card');
    assert.deepEqual(await cards.evaluateAll((nodes) => nodes.map((node) => node.getAttribute('aria-checked'))), ['true', 'false']);
    assert.match(await cards.nth(0).textContent(), /Family group chat \(recommended\)/);
    assert.match(await cards.nth(0).textContent(), /Everyone in the group gets every message\. Nobody has to opt in individually\./);
    assert.match(await cards.nth(1).textContent(), /Individual chats/);
    assert.match(await cards.nth(1).textContent(), /Each person opens the bot and taps Start once\./);
    const addToGroup = cards.nth(0).getByRole('button', { name: 'Add bot to a group' });
    assert.equal(await addToGroup.getAttribute('href'), 'https://t.me/home_alerts_bot?startgroup=true');
    assert.equal(await cards.nth(0).locator('.ns-qr').getAttribute('data-qr'), 'https://t.me/home_alerts_bot?startgroup=true');
    await cards.nth(1).click();
    assert.deepEqual(await cards.evaluateAll((nodes) => nodes.map((node) => node.getAttribute('aria-checked'))), ['false', 'true']);

    // Step 3: invite QR with Enlarge, Copy link, Copy invite message.
    assert.equal(await steps.nth(2).locator('.ns-qr').getAttribute('data-qr'), 'https://t.me/home_alerts_bot?start=join');
    await steps.nth(2).getByRole('button', { name: 'Copy link' }).click();
    await steps.nth(2).getByRole('button', { name: 'Copy invite message' }).click();
    assert.deepEqual(await page.evaluate(() => window.__copied), [
      'https://t.me/home_alerts_bot?start=join',
      'Tap this link and press Start to get alerts from our home: https://t.me/home_alerts_bot?start=join',
    ]);
    await steps.nth(2).getByRole('button', { name: 'Enlarge' }).click();
    const modal = page.locator('.ns-modal');
    assert.equal(await modal.count(), 1);
    assert.equal(await modal.locator('.ns-qr-large').getAttribute('data-qr'), 'https://t.me/home_alerts_bot?start=join');
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('.ns-modal').count(), 0, 'Escape closes the modal');

    // The chat id help on the group card points at the renamed button.
    assert.match(await page.locator('.card[data-path="groups[0]"]').textContent(), /Use Find people and groups on the Telegram provider/);
    assert.equal(await page.getByRole('button', { name: 'Find chat IDs' }).count(), 0);
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
    await find.getByRole('button', { name: 'Find people and groups' }).click();
    await page.waitForSelector(`${CARD} .chat-result`);
    const rows = find.locator('.chat-result');
    assert.equal(await rows.count(), 2);
    assert.match(await rows.nth(0).textContent(), /123456789.*Alex \(@alexr\).*\(private\)/);
    assert.match(await rows.nth(1).textContent(), /-1001234567890.*Home Alerts.*\(supergroup\)/);

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
