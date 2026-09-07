import assert from 'node:assert/strict';
import { test } from 'node:test';

import { launchOrSkip, openSettings } from './browser.mjs';
import { NTFY, TWILIO } from './helpers.mjs';

/**
 * The ntfy provider in the built settings UI (SPEC section 11.2, items 8, 13 and 24, and section 11.3):
 * the fourth chooser tile and its card copy, the auth mode switching the credential fields, Test
 * connection through the server, the group's topic list, the action's Title, Priority and Tags, the
 * uncovered-channel warning, and the name rule; plus the restore and draft guards from the 1.1.0 review.
 */

const CONFIG = {
  platform: 'NotifySwitch',
  name: 'Notify Switch',
  defaultCountry: 'US',
  providers: [TWILIO],
  groups: [{ id: 'family', name: 'Family', sms: ['+16785550101'], email: [], telegram: [], ntfy: [] }],
  switches: [{
    id: '6f1c2a9e-2b1c-4b8f-9d1e-0c5a1e2f3a4b',
    name: 'Water Leak Alert',
    actions: [{ providerId: 'twilio-main', channel: 'sms', groups: ['family'], body: 'Water detected.' }],
  }],
};

const WITH_NTFY = {
  ...CONFIG,
  providers: [TWILIO, NTFY],
  groups: [{ id: 'family', name: 'Family', sms: ['+16785550101'], email: [], telegram: [], ntfy: ['home-alerts'] }],
};

const NTFY_CARD_COPY = 'ntfy delivers to the ntfy app on your phone. Install the app, subscribe to a topic name of your choosing, and add that topic '
  + 'to a group. Anyone who knows the topic name can read it, so pick something unguessable or use an access token.';

async function pushed(page, predicate) {
  await page.waitForFunction(predicate);
  return page.evaluate(() => window.__hb.updates.at(-1)[0]);
}

test('ntfy card: the fourth tile creates the card with its copy, the server default and the auth mode driving the credential fields', async (t) => {
  const browser = await launchOrSkip(t);
  if (!browser) {
    return;
  }
  try {
    const page = await openSettings(browser, CONFIG, { requestScript: 'async () => ({ ok: true, message: "Connected to https://ntfy.sh." })' });
    await page.getByRole('button', { name: 'Add provider' }).click();
    const tile = page.locator('.ns-chooser-tile[data-type="ntfy"]');
    assert.equal(await tile.locator('.fw-semibold').textContent(), 'ntfy');
    assert.equal(await tile.locator('.ns-secondary').textContent(), 'Free push notifications to the ntfy app. No account needed for public topics.');
    await tile.click();
    const card = page.locator('.card[data-path="providers[1]"]');
    assert.equal(await card.locator('.card-header .badge').textContent(), 'ntfy');
    assert.equal(await card.locator('[data-path="providers[1].name"] input').inputValue(), 'ntfy');
    assert.equal(await card.locator('.ns-card-intro').textContent(), `${NTFY_CARD_COPY} Where do I find this?`);
    assert.equal(await card.locator('.ns-card-intro a').getAttribute('href'), 'https://github.com/arodbuilds/homebridge-notify-switch#ntfy');
    const server = card.locator('[data-path="providers[1].server"]');
    assert.equal(await server.locator('input').inputValue(), 'https://ntfy.sh');
    assert.equal(await server.locator('.ns-help').textContent(), 'Leave as ntfy.sh unless you run your own server.');
    let config = await pushed(page, () => window.__hb.updates.at(-1)?.[0].providers.length === 2);
    assert.deepEqual(config.providers[1], { id: 'ntfy', type: 'ntfy', name: 'ntfy', server: 'https://ntfy.sh', auth: 'none' });

    // Auth: None by default, with the token and basic fields out of the form; the help follows the choice.
    const auth = card.locator('[data-path="providers[1].auth"]');
    assert.deepEqual(await auth.locator('option').allTextContents(), ['None', 'Access token (recommended)', 'Username and password']);
    assert.equal(await auth.locator('select').inputValue(), 'none');
    assert.match(await auth.locator('.ns-help').textContent(), /^No credentials\. Works for public topics on ntfy\.sh/);
    assert.equal(await card.locator('[data-path="providers[1].token"]').isVisible(), false);
    assert.equal(await card.locator('[data-path="providers[1].username"]').isVisible(), false);
    assert.equal(await card.locator('[data-path="providers[1].password"]').isVisible(), false);
    await auth.locator('select').selectOption('token');
    assert.match(await auth.locator('.ns-help').textContent(), /^Recommended\. Create an access token/);
    const token = card.locator('[data-path="providers[1].token"]');
    assert.equal(await token.isVisible(), true);
    assert.equal(await token.locator('input').getAttribute('type'), 'password');
    assert.equal(await card.locator('[data-path="providers[1].username"]').isVisible(), false);
    // A missing token is an error once the field is left; the card was touched by the select change.
    await token.locator('input').focus();
    await token.locator('input').blur();
    assert.equal(await token.locator('.invalid-feedback').textContent(), 'Access token is required.');
    await token.locator('input').fill('tk_abc123');
    config = await pushed(page, () => window.__hb.updates.at(-1)?.[0].providers[1]?.token === 'tk_abc123');
    assert.deepEqual(config.providers[1], { id: 'ntfy', type: 'ntfy', name: 'ntfy', server: 'https://ntfy.sh', auth: 'token', token: 'tk_abc123' });

    await auth.locator('select').selectOption('basic');
    assert.equal(await token.isVisible(), false);
    assert.equal(await card.locator('[data-path="providers[1].username"]').isVisible(), true);
    assert.equal(await card.locator('[data-path="providers[1].password"]').isVisible(), true);
    await card.locator('[data-path="providers[1].username"] input').fill('alex');
    await card.locator('[data-path="providers[1].password"] input').fill('pw');
    config = await pushed(page, () => window.__hb.updates.at(-1)?.[0].providers[1]?.password === 'pw');
    const basic = { id: 'ntfy', type: 'ntfy', name: 'ntfy', server: 'https://ntfy.sh', auth: 'basic', username: 'alex', password: 'pw' };
    assert.deepEqual(config.providers[1], basic);

    // Test connection sends the block as it would be saved, and shows the server's answer.
    await card.getByRole('button', { name: 'Test connection' }).click();
    await page.waitForSelector('.card[data-path="providers[1]"] .status-box.alert-success');
    const request = await page.evaluate(() => window.__hb.requests.find((r) => r.path === '/test-provider'));
    assert.deepEqual(request.payload.provider, basic);

    // A server that is not an http or https URL is rejected with the copy from section 11.3.
    await server.locator('input').fill('ntfy.sh');
    await server.locator('input').blur();
    assert.equal(await server.locator('.invalid-feedback').textContent(),
      'That does not look like a server address. It starts with https:// or http://, for example https://ntfy.sh.');
  } finally {
    await browser.close();
  }
});

test('ntfy topics and actions: the group card has a topic list, an action gets Title, Priority and Tags, and the uncovered warning names ntfy', async (t) => {
  const browser = await launchOrSkip(t);
  if (!browser) {
    return;
  }
  try {
    const page = await openSettings(browser, WITH_NTFY);
    // The group card's fourth list.
    const group = page.locator('.card[data-path="groups[0]"]');
    const topics = group.locator('[data-path="groups[0].ntfy"]');
    assert.equal(await topics.count(), 1);
    assert.equal(await topics.locator('.address-row input').inputValue(), 'home-alerts');
    assert.equal(await topics.locator('.address-row input').getAttribute('placeholder'), 'e.g. home-alerts-x7q2');
    await topics.getByRole('button', { name: 'Add topic' }).click();
    const added = topics.locator('.address-row').nth(1).locator('input');
    await added.fill('bad topic!');
    await added.blur();
    assert.equal(await topics.locator('.address-row').nth(1).locator('.invalid-feedback').textContent(),
      'Topic "bad topic!" is not a topic name. Use letters, numbers, dashes and underscores, up to 64 characters.');
    await added.fill('garage_x7');
    await pushed(page, () => window.__hb.updates.at(-1)?.[0].groups[0].ntfy.length === 2);
    assert.deepEqual(await page.evaluate(() => window.__hb.updates.at(-1)[0].groups[0].ntfy), ['home-alerts', 'garage_x7']);

    // The switch targets a group with topics but has no ntfy action: the warning and its one-click fix.
    const sw = page.locator('.card[data-path="switches[0]"]');
    const warning = sw.locator('.coverage-warning[data-channel="ntfy"]');
    assert.equal(await warning.locator('.coverage-warning-text').textContent(),
      'This switch sends to a group with ntfy topics, but it has no ntfy action. Those recipients will not receive anything.');
    await warning.getByRole('button', { name: 'Add ntfy action' }).click();
    const action = page.locator('.card[data-path="switches[0]"] .action-card').nth(1);
    assert.equal(await action.locator('[data-path="switches[0].actions[1].providerId"] select').inputValue(), 'ntfy-home', 'the ntfy provider is preselected');
    assert.equal(await action.locator('[data-path="switches[0].actions[1].channel"] select').inputValue(), 'ntfy');
    assert.deepEqual(await action.locator('[data-path="switches[0].actions[1].channel"] option').allTextContents(), ['ntfy']);
    assert.equal(await action.locator('[data-path="switches[0].actions[1].groups"] input[type="checkbox"]').isChecked(), true);
    assert.equal(await page.locator('.card[data-path="switches[0]"] .coverage-warning[data-channel="ntfy"]').count(), 0, 'the warning is gone');
    // Title, Priority and Tags, with no BCC checkbox.
    const title = action.locator('[data-path="switches[0].actions[1].subject"]');
    assert.equal(await title.locator('label').first().textContent(), 'Title');
    assert.equal(await title.locator('input').getAttribute('placeholder'), 'Defaults to the switch name: Water Leak Alert');
    assert.equal(await action.locator('.ns-variables-toggle').count(), 2, 'the Variables toggle sits on the title and the message');
    assert.equal(await action.locator('[data-path="switches[0].actions[1].bcc"]').count(), 0);
    const priority = action.locator('[data-path="switches[0].actions[1].priority"]');
    assert.deepEqual(await priority.locator('option').allTextContents(), ['Min', 'Low', 'Default', 'High', 'Urgent']);
    assert.equal(await priority.locator('select').inputValue(), 'default');
    const tags = action.locator('[data-path="switches[0].actions[1].tags"]');
    assert.equal(await tags.locator('input').getAttribute('placeholder'), 'e.g. warning, house');
    await priority.locator('select').selectOption('high');
    await tags.locator('input').fill('warning, house');
    await action.locator('[data-path="switches[0].actions[1].body"] textarea').fill('Leak at {{time}}');
    const config = await pushed(page, () => window.__hb.updates.at(-1)?.[0].switches[0].actions[1]?.body === 'Leak at {{time}}');
    assert.deepEqual(config.switches[0].actions[1], {
      providerId: 'ntfy-home', channel: 'ntfy', groups: ['family'], recipients: [], priority: 'high', tags: ['warning', 'house'], body: 'Leak at {{time}}',
    });
    // Bad tags are reported on the Tags field.
    await tags.locator('input').fill('ok, bad!tag');
    await tags.locator('input').blur();
    assert.equal(await tags.locator('.invalid-feedback').textContent(),
      'Tag "bad!tag" is not a tag. Use letters, numbers, dashes, underscores and plus signs, up to 32 characters.');
    await tags.locator('input').fill('a,b,c,d,e,f,g,h,i');
    await tags.locator('input').blur();
    assert.equal(await tags.locator('.invalid-feedback').textContent(), 'Use at most 8 tags.');
    // Extra recipients on an ntfy action are topics.
    const extra = action.locator('[data-path="switches[0].actions[1].recipients"]');
    await extra.getByRole('button', { name: 'Add topic' }).click();
    assert.equal(await extra.locator('.address-row input').getAttribute('aria-label'), 'topic 1');
    // Test send is gated like every other channel: the confirmation counts distinct topics.
    await tags.locator('input').fill('warning');
    await extra.locator('.address-row input').fill('garage_x7');
    await extra.locator('.address-row input').blur();
    await page.waitForFunction(() => !document.querySelector('.card[data-path="switches[0]"] .ns-test-send button').disabled);
    await sw.locator('.ns-test-send').getByRole('button', { name: 'Test send' }).click();
    assert.equal(await sw.locator('.ns-confirm-question').textContent(), 'Send to 3 recipients now?');
  } finally {
    await browser.close();
  }
});

test('name rule: a provider or group name with angle brackets or over 64 characters shows the section 11.3 message and disables Save', async (t) => {
  const browser = await launchOrSkip(t);
  if (!browser) {
    return;
  }
  try {
    const page = await openSettings(browser, CONFIG);
    const message = 'Use letters, numbers, spaces, and punctuation, up to 64 characters.';
    const provider = page.locator('.card[data-path="providers[0]"] [data-path="providers[0].name"]');
    await provider.locator('input').fill('Twilio <home>');
    await provider.locator('input').blur();
    assert.equal(await provider.locator('.invalid-feedback').textContent(), message);
    await page.waitForFunction(() => window.__hb.save.at(-1) === false);
    await provider.locator('input').fill('x'.repeat(65));
    await provider.locator('input').blur();
    assert.equal(await provider.locator('.invalid-feedback').textContent(), message);
    await provider.locator('input').fill('Alex\'s Twilio (home), #1 & co.');
    await provider.locator('input').blur();
    assert.equal(await provider.locator('.invalid-feedback').textContent(), '');
    const group = page.locator('.card[data-path="groups[0]"] [data-path="groups[0].name"]');
    await group.locator('input').fill('Family>');
    await group.locator('input').blur();
    assert.equal(await group.locator('.invalid-feedback').textContent(), message);
    await group.locator('input').fill('Family');
    await group.locator('input').blur();
    await page.waitForFunction(() => window.__hb.save.at(-1) === true);
  } finally {
    await browser.close();
  }
});

test('restore and drafts: a file with a __proto__ key or over 1 MB is refused before anything changes; such a draft is discarded on load', async (t) => {
  const browser = await launchOrSkip(t);
  if (!browser) {
    return;
  }
  try {
    const page = await openSettings(browser, CONFIG);
    const advanced = page.locator('#section-settings details.ns-advanced');
    await advanced.locator('summary').click();
    const picker = advanced.locator('input[type="file"]');
    const file = (name, text) => ({ name, mimeType: 'application/json', buffer: Buffer.from(text) });

    const polluted = `${JSON.stringify(CONFIG).slice(0, -1)},"switches":[{"__proto__":{"polluted":true}}]}`;
    await picker.setInputFiles(file('polluted.json', polluted));
    await page.waitForFunction(() => /not allowed/.test(document.querySelector('.restore-status')?.textContent ?? ''));
    assert.match(await advanced.locator('.restore-status').textContent(), /contains a key named "switches\[0\]\.__proto__", which is not allowed\./);
    assert.equal(await page.evaluate(() => ({}).polluted), undefined);
    assert.equal(await page.locator('[data-path="name"] input').inputValue(), 'Notify Switch', 'the form is untouched');

    const huge = `${JSON.stringify(CONFIG).slice(0, -1)},"pad":"${'x'.repeat(1024 * 1024)}"}`;
    await picker.setInputFiles(file('huge.json', huge));
    await page.waitForFunction(() => /larger than 1 MB/.test(document.querySelector('.restore-status')?.textContent ?? ''));
    assert.match(await advanced.locator('.restore-status').textContent(), /The file is larger than 1 MB, which a Notify Switch backup never is\./);
    await page.close();

    // A draft that carries a forbidden key is removed instead of being offered.
    const draft = JSON.stringify({ savedAt: Date.now(), config: JSON.parse(`${JSON.stringify(CONFIG).slice(0, -1)},"name":"Changed","constructor":{}}`) });
    const initScript = `window.localStorage.setItem('homebridge-notify-switch:draft', ${JSON.stringify(draft)});`;
    const withDraft = await openSettings(browser, CONFIG, { initScript });
    assert.equal(await withDraft.locator('.ns-draft-banner').isVisible(), false, 'no banner for a draft with a forbidden key');
    await withDraft.waitForFunction(() => window.__hb.updates.length > 0);
    const stored = await withDraft.evaluate(() => JSON.parse(window.localStorage.getItem('homebridge-notify-switch:draft')));
    assert.equal(stored.config.name, 'Notify Switch', 'the poisoned draft was replaced by the page\'s own');
    assert.equal(await withDraft.evaluate(() => ({}).polluted), undefined);
  } finally {
    await browser.close();
  }
});
