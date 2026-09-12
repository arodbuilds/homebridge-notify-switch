import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { test } from 'node:test';

import { launchOrSkip, openSettings } from './browser.mjs';
import { SMTP, TWILIO } from './helpers.mjs';

/**
 * The shared settings shell (SPEC section 11.2, item 28): the page banner served from the plugin's own folder, the
 * 31px and 38px buttons, the card header clusters and badges, the body padding and the Advanced disclosure line,
 * the result bar between the body and the footer strip, the "Remove {title}?" confirmation, the gated Add buttons
 * and the chooser tiles, the sticky summary box, and the dark-mode colours of text buttons, alerts and variable
 * tokens. Everything is measured on the built page the way the Homebridge UI shows it.
 */

const ROOT = resolve(import.meta.dirname, '..', '..');
const PUBLIC = join(ROOT, 'homebridge-ui', 'public');

/** A long provider name, so the header badges have to wrap under the title on a phone. */
const LONG_NAME = 'Household mail for everyone at home';

const CONFIG = {
  platform: 'NotifySwitch',
  name: 'Notify Switch',
  defaultCountry: 'US',
  defaultProviders: { email: 'fastmail' },
  providers: [TWILIO, { ...SMTP, name: LONG_NAME, smtpPreset: 'fastmail' }],
  groups: [{ id: 'family', name: 'Family', sms: ['+16785550101'], email: ['a@example.com'], telegram: [] }],
  switches: [{
    id: '6f1c2a9e-2b1c-4b8f-9d1e-0c5a1e2f3a4b',
    name: 'Water Leak Alert',
    actions: [
      { providerId: 'twilio-main', channel: 'sms', groups: ['family'], body: 'Water detected.' },
      { providerId: 'fastmail', channel: 'email', groups: ['family'], body: 'Water detected.' },
    ],
  }],
};

/** A fresh install: nothing configured, so the Providers section shows the Get started card and the other sections are gated. */
const EMPTY_CONFIG = { platform: 'NotifySwitch', name: 'Notify Switch' };

/** Answers Test connection with the SMTP success line and Test send with one recipient result; everything else with a stub. */
const REQUESTS = `async (path) => path === '/test-send'
  ? {
    ok: true, message: 'Sent.',
    actions: [{ index: 0, providerId: 'twilio-main', channel: 'sms', results: [{ recipient: '+16785550101', ok: true, id: 'SM1' }] }],
  }
  : path === '/test-provider' ? { ok: true, message: 'Connected to smtp.fastmail.com:465 and logged in.' } : { ok: true, message: 'stub' }`;

/** Everything on the page that loads a resource (links to other pages are navigation, not loading). */
const RESOURCE_TAGS = 'img, script, link[rel="stylesheet"], iframe, source, video, audio, object, embed';

/** Computed box metrics of the first visible match of `selector` inside `scope`. */
async function metrics(page, selector, scope = 'body') {
  return page.evaluate(([scopeSelector, target]) => {
    const node = [...document.querySelector(scopeSelector).querySelectorAll(target)].find((candidate) => candidate.checkVisibility());
    if (!node) {
      return null;
    }
    const style = getComputedStyle(node);
    const rect = node.getBoundingClientRect();
    return {
      text: node.textContent.trim(),
      height: Math.round(rect.height * 10) / 10,
      top: rect.top,
      bottom: rect.bottom,
      left: rect.left,
      width: rect.width,
      fontSize: style.fontSize,
      fontWeight: style.fontWeight,
      transform: style.textTransform,
      radius: style.borderTopLeftRadius,
      padding: style.padding,
      paddingLeft: style.paddingLeft,
      color: style.color,
      background: style.backgroundColor,
      borderTop: `${style.borderTopWidth} ${style.borderTopStyle}`,
      borderColor: style.borderTopColor,
      cursor: style.cursor,
      textAlign: style.textAlign,
      marginTop: style.marginTop,
      marginBottom: style.marginBottom,
      position: style.position,
      columnGap: style.columnGap,
      aspectRatio: style.aspectRatio,
      className: node.className,
    };
  }, [scope, selector]);
}

test('shell: the banner is the first element, served from the plugin folder at 4:1, and nothing on the page loads from another host', async (t) => {
  const browser = await launchOrSkip(t);
  if (!browser) {
    return;
  }
  try {
    // The build copies the artwork beside the bundle; the page references it by a relative path only.
    const original = readFileSync(join(ROOT, 'assets', 'notify-switch-banner.png'));
    const copy = readFileSync(join(PUBLIC, 'notify-switch-banner.png'));
    assert.ok(original.equals(copy), 'homebridge-ui/public carries the banner exactly as in assets/');
    assert.equal(copy.readUInt32BE(16) / copy.readUInt32BE(20), 4, 'the artwork is 4:1');

    const page = await openSettings(browser, CONFIG);
    const banner = await page.evaluate(() => {
      const node = document.getElementById('app').firstElementChild;
      const style = getComputedStyle(node);
      const rect = node.getBoundingClientRect();
      const app = document.getElementById('app').getBoundingClientRect();
      return {
        tag: node.tagName, src: node.getAttribute('src'), alt: node.getAttribute('alt'), aspectRatio: style.aspectRatio, radius: style.borderTopLeftRadius,
        marginTop: style.marginTop, width: rect.width, containerWidth: app.width - 32, ratio: rect.width / rect.height,
      };
    });
    assert.equal(banner.tag, 'IMG');
    assert.equal(banner.src, 'notify-switch-banner.png', 'a relative path into the plugin folder, never a URL');
    assert.equal(banner.alt, 'Notify Switch, Homebridge switches that send SMS, email, Telegram, or ntfy messages when turned on.');
    assert.equal(banner.aspectRatio, '4 / 1');
    assert.equal(banner.radius, '6px');
    assert.equal(banner.marginTop, '16px');
    assert.ok(Math.abs(banner.width - banner.containerWidth) <= 1, `full container width (${banner.width} vs ${banner.containerWidth})`);
    assert.ok(Math.abs(banner.ratio - 4) < 0.05, `drawn at 4:1 (${banner.ratio.toFixed(2)})`);
    // Below 600px it stays full width.
    await page.setViewportSize({ width: 400, height: 800 });
    const narrow = await page.evaluate(() => {
      const node = document.getElementById('app').firstElementChild.getBoundingClientRect();
      return { width: node.width, containerWidth: document.getElementById('app').getBoundingClientRect().width - 32 };
    });
    assert.ok(Math.abs(narrow.width - narrow.containerWidth) <= 1, 'full width at 400px');

    // Every resource the page loads is its own: relative paths (the banner) or the harness's file URLs, no other host.
    const resources = await page.evaluate((tags) => [...document.querySelectorAll(tags)]
      .map((node) => node.getAttribute('src') ?? node.getAttribute('href') ?? node.getAttribute('data') ?? ''), RESOURCE_TAGS);
    assert.ok(resources.length >= 3, `resources were listed (${resources.length})`);
    for (const url of resources) {
      assert.ok(!/^(https?:)?\/\//i.test(url), `${url} is not loaded from another host`);
    }
    const css = readFileSync(join(PUBLIC, 'index.css'), 'utf8');
    for (const match of css.matchAll(/url\(["']?([^"')]+)/g)) {
      assert.ok(match[1].startsWith('data:'), `the stylesheet loads nothing from a host: ${match[1]}`);
    }
    const bundle = readFileSync(join(PUBLIC, 'index.js'), 'utf8');
    assert.ok(!/notify-switch-banner\.png[^"']*["']\s*,?\s*(https?:)?\/\//.test(bundle));
    assert.ok(!/https?:\/\/[^"'\s]*notify-switch-banner/.test(bundle), 'the bundle never points the banner at a host');
  } finally {
    await browser.close();
  }
});

test('shell: small buttons are 31px uppercase, the section Add button is 38px, text buttons keep their case, and touch targets stay 44px', async (t) => {
  const browser = await launchOrSkip(t);
  if (!browser) {
    return;
  }
  try {
    const page = await openSettings(browser, CONFIG);
    await page.locator('#section-settings details.ns-advanced summary').click();
    const small = [
      ['.card[data-path="providers[0]"]', '.address-row .btn'], // list REMOVE
      ['.card[data-path="providers[0]"]', '.address-list > .btn'], // ADD SENDER NUMBER
      ['.card[data-path="groups[0]"]', '.address-list > .btn'], // ADD PHONE NUMBER
      ['.card[data-path="providers[0]"]', '.ns-lookup .btn'], // LOOK UP NUMBERS
      ['#section-settings', '.ns-backup-actions .btn'], // DOWNLOAD BACKUP
      ['.card[data-path="providers[0]"]', '.ns-footer-action'], // TEST CONNECTION
      ['.card[data-path="switches[0]"]', '.ns-footer-action'], // TEST SEND
    ];
    for (const [scope, selector] of small) {
      const button = await metrics(page, selector, scope);
      assert.ok(button, `${scope} ${selector} renders`);
      assert.ok(Math.abs(button.height - 31) <= 0.5, `${button.text} is 31px tall (${button.height})`);
      assert.equal(button.fontSize, '13.5px', `${button.text} is 13.5px`);
      assert.equal(button.transform, 'uppercase', `${button.text} is uppercase`);
      assert.equal(button.radius, '4px', `${button.text} has a 4px radius`);
    }
    // The footer's primary action is outlined in the link colour, not the host's primary fill.
    const test = await metrics(page, '.ns-footer-action', '.card[data-path="providers[0]"]');
    assert.equal(test.color, 'rgb(13, 110, 253)');
    assert.equal(test.borderColor, 'rgb(13, 110, 253)');
    assert.equal(test.background, 'rgba(0, 0, 0, 0)', 'outlined');
    // The in-place REMOVE and SEND confirms are 31px too.
    await page.locator('.card[data-path="groups[0]"]').getByRole('button', { name: 'Remove group' }).click();
    const remove = await metrics(page, '.ns-remove-confirm .btn-danger', '.card[data-path="groups[0]"]');
    assert.ok(Math.abs(remove.height - 31) <= 0.5 && remove.transform === 'uppercase', `REMOVE confirm (${remove.height})`);
    await page.keyboard.press('Escape');
    await page.locator('.card[data-path="switches[0]"]').getByRole('button', { name: 'Test send' }).click();
    const send = await metrics(page, '.ns-test-send .btn-primary', '.card[data-path="switches[0]"]');
    assert.ok(Math.abs(send.height - 31) <= 0.5 && send.transform === 'uppercase', `SEND confirm (${send.height})`);
    const cancel = await metrics(page, '.ns-test-send .btn-link', '.card[data-path="switches[0]"]');
    assert.equal(cancel.transform, 'none', 'the Cancel link keeps its case');
    await page.keyboard.press('Escape');
    // Section Add buttons: 38px primary with uppercase 16px text.
    for (const [section, label] of [['providers', 'Add provider'], ['groups', 'Add group'], ['switches', 'Add switch']]) {
      const add = await page.locator(`#section-${section}`).getByRole('button', { name: label }).evaluate((node) => {
        const style = getComputedStyle(node);
        return {
          height: node.getBoundingClientRect().height, fontSize: style.fontSize, transform: style.textTransform,
          radius: style.borderTopLeftRadius, cls: node.className,
        };
      });
      assert.ok(Math.abs(add.height - 38) <= 0.5, `${label} is 38px (${add.height})`);
      assert.equal(add.fontSize, '16px');
      assert.equal(add.transform, 'uppercase');
      assert.equal(add.radius, '4px');
      assert.match(add.cls, /\bbtn-primary\b/);
      assert.doesNotMatch(add.cls, /\bbtn-sm\b/);
    }
    // Text buttons keep their case and size.
    for (const label of ['Remove provider', 'Duplicate switch', 'Hide help', 'Edit', 'Show variables']) {
      const node = page.getByRole('button', { name: label }).first();
      assert.equal(await node.evaluate((button) => getComputedStyle(button).textTransform), 'none', `${label} keeps its case`);
    }
    // The password field's attached Show / Hide follows the 38px control it is joined to, with the small-button lettering.
    const show = await metrics(page, '.input-group > .btn', '.card[data-path="providers[0]"]');
    assert.ok(Math.abs(show.height - 38) <= 0.5, `Show is as tall as its input (${show.height})`);
    assert.equal(show.transform, 'uppercase');
    await page.close();

    // Touch devices keep the 44px minimum on every button, the 31px ones included.
    const touch = await openSettings(browser, CONFIG, { viewport: { width: 390, height: 844 }, hasTouch: true });
    const short = await touch.evaluate(() => [...document.querySelectorAll('.btn-sm, .ns-section-add')]
      .filter((node) => node.checkVisibility())
      .map((node) => ({ label: node.textContent.trim(), height: node.getBoundingClientRect().height }))
      .filter((entry) => entry.height < 44));
    assert.deepEqual(short, []);
  } finally {
    await browser.close();
  }
});

test('shell: card header clusters and badges, body padding and grid, the Advanced disclosure line, and the phone wrap', async (t) => {
  const browser = await launchOrSkip(t);
  if (!browser) {
    return;
  }
  try {
    const page = await openSettings(browser, CONFIG);
    const smtp = '.card[data-path="providers[1]"]';
    const twilio = '.card[data-path="providers[0]"]';
    // Left cluster: bold title, type badge, status badge. Right cluster: Make default link, then the help toggle.
    const title = await metrics(page, '.ns-card-title > .fw-semibold', smtp);
    assert.equal(title.text, LONG_NAME);
    assert.ok(Number(title.fontWeight) >= 600, 'the title is bold');
    const type = await metrics(page, '.ns-card-title .ns-type-badge', smtp);
    assert.equal(type.text, 'SMTP');
    assert.equal(type.fontSize, '11.5px');
    assert.equal(type.fontWeight, '600');
    assert.equal(type.padding, '3px 7px');
    assert.equal(type.radius, '4px');
    assert.equal(type.background, 'rgb(108, 117, 125)', 'the secondary fill');
    assert.equal(type.color, 'rgb(255, 255, 255)');
    const status = await metrics(page, '.ns-card-title .ns-status-badge', smtp);
    assert.equal(status.text, 'Default for email');
    assert.equal(status.background, 'rgb(25, 135, 84)', 'the success fill');
    assert.equal(status.color, 'rgb(255, 255, 255)');
    assert.equal(status.fontSize, '11.5px');
    const clusters = await page.locator(`${smtp} .ns-card-actions > *`)
      .evaluateAll((nodes) => nodes.map((node) => node.className.split(' ')[0] || node.tagName));
    assert.deepEqual(clusters, ['ns-default-actions', 'btn'], 'the right cluster holds the actions slot, then the help toggle');
    assert.deepEqual(await page.locator(`${twilio} .ns-card-actions button`).allTextContents(), ['Make default for email', 'Hide help']);
    assert.equal(await page.locator(`${twilio} .ns-card-title .ns-status-badge`).count(), 0, 'no status badge on the card that is not the default');
    const make = await metrics(page, '.ns-make-default', twilio);
    assert.equal(make.fontSize, '12.6px', 'header links are 12.6px');
    assert.equal(make.color, 'rgb(13, 110, 253)', 'Make default is in the link colour');
    const help = await metrics(page, '.ns-help-toggle', twilio);
    assert.equal(help.fontSize, '12.6px');
    assert.notEqual(help.color, make.color, 'the help toggle is in the secondary colour');
    assert.equal(await page.locator(`${twilio} .ns-card-actions`).evaluate((node) => getComputedStyle(node).columnGap), '12px');
    const header = await metrics(page, '.ns-card-header', smtp);
    assert.equal(header.padding, '8px 16px');
    assert.equal(header.background, 'rgba(33, 37, 41, 0.03)', 'the subtle strip');

    // Body: 16px padding with none at the bottom; the grid has an 8px column gap and every field 16px below it.
    const body = await metrics(page, '.card-body', smtp);
    assert.equal(body.padding, '16px 16px 0px');
    assert.equal(await page.locator(`${smtp} .card-body .ns-grid`).first().evaluate((node) => getComputedStyle(node).columnGap), '8px');
    const field = await metrics(page, '[data-path="providers[1].username"]', smtp);
    assert.equal(field.marginBottom, '16px');

    // The Advanced line reads "▸ Advanced" closed and "▾ Advanced" open, in 12.6px secondary text, and opens a 12-column grid.
    const summary = page.locator(`${smtp} details.ns-advanced > summary`);
    const glyph = () => summary.evaluate((node) => getComputedStyle(node, '::before').content);
    assert.equal(await summary.textContent(), 'Advanced');
    assert.equal(await glyph(), '"\u25B8\u00A0"', 'a right-pointing triangle and a space before the word while closed');
    assert.equal(await summary.evaluate((node) => getComputedStyle(node).fontSize), '12.6px');
    await summary.click();
    assert.equal(await glyph(), '"\u25BE\u00A0"', 'a down-pointing triangle while open');
    assert.equal(await page.locator(`${smtp} details.ns-advanced > div > .ns-grid`).count(), 1, 'Advanced holds a second grid');
    const tracks = await page.locator(`${smtp} details.ns-advanced .ns-grid`).evaluate((node) => getComputedStyle(node).gridTemplateColumns.split(' ').length);
    assert.equal(tracks, 12);

    // Below 600px the badges wrap under the title while the right cluster stays on the first row.
    await page.setViewportSize({ width: 400, height: 900 });
    const wrapped = await page.locator(`${smtp} .ns-card-header`).evaluate((node) => {
      const range = document.createRange();
      range.selectNodeContents(node.querySelector('.ns-card-title > .fw-semibold'));
      const firstLine = range.getClientRects()[0];
      const badge = node.querySelector('.ns-status-badge').getBoundingClientRect();
      const actions = node.querySelector('.ns-card-actions').getBoundingClientRect();
      const headerRect = node.getBoundingClientRect();
      return {
        badgeBelowTitle: badge.top >= firstLine.bottom - 1, actionsOnFirstRow: actions.top < firstLine.bottom && actions.bottom > firstLine.top,
        inside: actions.right <= headerRect.right && badge.right <= headerRect.right,
      };
    });
    assert.equal(wrapped.badgeBelowTitle, true, 'the status badge wraps under the title');
    assert.equal(wrapped.actionsOnFirstRow, true, 'the right cluster stays on the first row');
    assert.equal(wrapped.inside, true);
  } finally {
    await browser.close();
  }
});

test('shell: the result bar sits between the body and the footer strip, Remove confirms with the title, and footers are strips', async (t) => {
  const browser = await launchOrSkip(t);
  if (!browser) {
    return;
  }
  try {
    const page = await openSettings(browser, CONFIG, { requestScript: REQUESTS });
    const smtp = '.card[data-path="providers[1]"]';
    const order = (card) => page.locator(card).evaluate((node) => [...node.children]
      .map((child) => child.className.split(' ').filter((cls) => cls.startsWith('card-') || cls.startsWith('ns-card') || cls === 'test-results').join(' ')));
    assert.deepEqual(await order(smtp), ['card-header ns-card-header', 'card-body', 'ns-card-results', 'card-footer ns-card-footer']);
    assert.deepEqual(await order('.card[data-path="switches[0]"]'),
      ['card-header ns-card-header', 'card-body', 'ns-card-results test-results', 'card-footer ns-card-footer']);
    assert.equal(await page.locator(`${smtp} .ns-card-results`).evaluate((node) => node.getBoundingClientRect().height), 0, 'empty, the bar takes no space');

    // Test connection: the message and a Dismiss link in the bar, above the footer strip.
    await page.locator(smtp).getByRole('button', { name: 'Test connection' }).click();
    await page.waitForSelector(`${smtp} .ns-card-results .alert-success`);
    assert.equal(await page.locator(`${smtp} .ns-card-results .status-box`).textContent(), 'Connected to smtp.fastmail.com:465 and logged in.');
    const bar = await metrics(page, '.ns-card-results', smtp);
    assert.equal(bar.padding, '12px 16px');
    assert.equal(bar.borderTop, '1px solid');
    const footer = await metrics(page, '.card-footer', smtp);
    assert.ok(bar.bottom <= footer.top + 1, 'the bar is above the footer');
    assert.ok(bar.top >= (await metrics(page, '.card-body', smtp)).bottom - 1, 'and below the body');
    assert.equal(await page.locator(`${smtp} .ns-card-results`).getByRole('button', { name: 'Dismiss' }).count(), 1);
    await page.locator(`${smtp} .ns-card-results`).getByRole('button', { name: 'Dismiss' }).click();
    assert.equal(await page.locator(`${smtp} .ns-card-results`).evaluate((node) => node.childElementCount), 0, 'Dismiss clears the bar');

    // Test send: the per-recipient table in the same bar.
    const sw = '.card[data-path="switches[0]"]';
    await page.locator(sw).getByRole('button', { name: 'Test send' }).click();
    await page.locator(sw).getByRole('button', { name: 'Send', exact: true }).click();
    await page.waitForSelector(`${sw} .ns-card-results table`);
    assert.deepEqual(await page.locator(`${sw} .ns-card-results td`).allTextContents(), ['+16785550101', 'Sent (SM1)']);
    assert.equal(await page.locator(`${sw} .ns-card-results`).getByRole('button', { name: 'Dismiss' }).count(), 1);
    assert.equal(await page.locator(`${sw} .ns-card-results`).evaluate((node) => node.nextElementSibling.classList.contains('card-footer')), true);

    // Footer strip: 8px 16px on the subtle fill with a rule above; Remove confirms with the card's title, and a nameless card with the noun.
    assert.equal(footer.padding, '8px 16px');
    assert.equal(footer.borderTop, '1px solid');
    assert.equal(footer.background, 'rgba(33, 37, 41, 0.03)');
    await page.locator(smtp).getByRole('button', { name: 'Remove provider' }).click();
    assert.equal(await page.locator(`${smtp} .ns-confirm-question`).textContent(), `Remove ${LONG_NAME}?`);
    await page.keyboard.press('Escape');
    await page.locator(sw).getByRole('button', { name: 'Remove switch' }).click();
    assert.equal(await page.locator(`${sw} .ns-confirm-question`).textContent(), 'Remove Water Leak Alert?');
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Add group' }).click();
    const group = '.card[data-path="groups[1]"]';
    await page.locator(group).getByRole('button', { name: 'Remove group' }).click();
    assert.equal(await page.locator(`${group} .ns-confirm-question`).textContent(), 'Remove this group?', 'unnamed: the noun');
    await page.keyboard.press('Escape');
    // A name with markup characters is inserted as text.
    await page.locator(`${group} [data-path="groups[1].name"] input`).fill('Tom & "Jerry"');
    await page.locator(group).getByRole('button', { name: 'Remove group' }).click();
    assert.equal(await page.locator(`${group} .ns-confirm-question`).textContent(), 'Remove Tom & "Jerry"?');
    assert.equal(await page.locator(`${group} .ns-confirm-question`).evaluate((node) => node.childElementCount), 0);
  } finally {
    await browser.close();
  }
});

test('shell: gated Add buttons, inline chooser tiles, the sticky summary box in both themes, and dark-mode intent colours', async (t) => {
  const browser = await launchOrSkip(t);
  if (!browser) {
    return;
  }
  try {
    const page = await openSettings(browser, EMPTY_CONFIG);
    for (const [section, label] of [['groups', 'Add group'], ['switches', 'Add switch']]) {
      const add = page.locator(`#section-${section}`).getByRole('button', { name: label });
      assert.equal(await add.isDisabled(), true);
      const style = await add.evaluate((node) => ({
        cls: node.className, cursor: getComputedStyle(node).cursor, background: getComputedStyle(node).backgroundColor,
        height: node.getBoundingClientRect().height,
      }));
      assert.match(style.cls, /\bbtn-outline-secondary\b/);
      assert.equal(style.cursor, 'not-allowed');
      assert.equal(style.background, 'rgba(0, 0, 0, 0)', 'outlined, no fill');
      assert.ok(Math.abs(style.height - 38) <= 0.5);
      assert.equal(await page.locator(`#section-${section} .ns-add-hint`).textContent(), 'Add a provider first.');
    }
    // The Get started card holds the tiles inline with no Cancel, in an auto-fit grid: four across on a desktop, one column on a phone.
    const started = page.locator('.ns-get-started');
    assert.equal(await started.getByRole('button', { name: 'Cancel' }).count(), 0);
    const columns = () => started.locator('.ns-chooser-tiles').evaluate((node) => getComputedStyle(node).gridTemplateColumns.split(' ')
      .filter((track) => parseFloat(track) > 0).length);
    assert.equal(await columns(), 4, 'four tiles across on a desktop');
    const rows = await started.locator('.ns-chooser-tile')
      .evaluateAll((nodes) => new Set(nodes.map((node) => Math.round(node.getBoundingClientRect().top))).size);
    assert.equal(rows, 1);
    await page.setViewportSize({ width: 400, height: 800 });
    assert.equal(await columns(), 1, 'one column on a phone');
    await page.close();

    for (const dark of [true, false]) {
      const themed = await openSettings(browser, CONFIG, { dark, viewport: { width: 700, height: 600 } });
      // An issue keeps the summary box on screen: sticky at the bottom of the scroll area.
      await themed.locator('[data-path="switches[0].name"] input').fill('Bad-Name!');
      await themed.locator('[data-path="switches[0].name"] input').blur();
      await themed.evaluate(() => window.scrollTo(0, 0));
      const box = await metrics(themed, '.issues');
      assert.equal(box.position, 'sticky', `${dark ? 'dark' : 'light'}: the summary box is sticky`);
      assert.ok(box.bottom <= 600 && box.top >= 0, `${dark ? 'dark' : 'light'}: the box is inside the viewport at the bottom (${box.top}..${box.bottom})`);
      assert.equal(box.textAlign, 'start', 'alerts are left-aligned');
      assert.equal((await metrics(themed, '.ns-draft-banner, .ns-default-prompt, .alert')).textAlign, 'start');

      // Text buttons keep their intent colours: danger stays red, links stay link-coloured, the help toggle secondary, issue entries inherit.
      const link = dark ? 'rgb(110, 168, 254)' : 'rgb(13, 110, 253)';
      assert.equal((await metrics(themed, '.ns-danger-link')).color, 'rgb(220, 53, 69)');
      assert.equal((await metrics(themed, '.ns-duplicate')).color, link);
      assert.equal((await metrics(themed, '.ns-make-default')).color, link);
      const issue = await themed.locator('.issues .ns-issue-link').first()
        .evaluate((node) => [getComputedStyle(node).color, getComputedStyle(node.parentElement).color]);
      assert.equal(issue[0], issue[1], 'summary box entries take the surrounding colour');
      assert.notEqual((await metrics(themed, '.ns-help-toggle')).color, link, 'the help toggle is secondary, not a link');
      // Variable tokens are drawn in the link colour so they read as clickable.
      await themed.locator('[data-path="switches[0].body"] .ns-variables-toggle').click();
      assert.equal((await metrics(themed, '.ns-variable code')).color, link);
      await themed.close();
    }
  } finally {
    await browser.close();
  }
});
