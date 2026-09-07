import assert from 'node:assert/strict';
import { test } from 'node:test';

import { HOST_BODY_CLASSES, launchOrSkip, openSettings } from './browser.mjs';
import { SMTP, TELEGRAM, TWILIO } from './helpers.mjs';

/**
 * Headless Chromium smoke test for the built settings UI (homebridge-ui/public). The page is loaded
 * the way the Homebridge UI loads it (see browser.mjs) and checked for:
 *   - no rendered element starting left of the viewport or ending past it, at 900, 599, 400 and 360px;
 *   - no horizontal page scroll;
 *   - the two-column grids stacking to one column below 600px, and phone rows stacking to the country
 *     on its own line with the number and Remove together on the next (SPEC section 11.2, item 16);
 *   - the uncovered channel warning with its copy and "Add … action" button, with Save left enabled;
 *   - the card footers (SPEC section 11.2, item 11): the red text button on the left, one outlined
 *     primary on the right, never two primary buttons next to each other, and the primary on top when
 *     the footer wraps;
 *   - 44px touch targets on a touch device;
 *   - secondary text contrast of at least 4.5:1 (WCAG AA) in dark mode and light mode, on a full
 *     configuration and on an empty one (SPEC section 11.2, item 18).
 */

/** A valid configuration whose only switch leaves the family group's Telegram chat uncovered. */
const CONFIG = {
  platform: 'NotifySwitch',
  name: 'Notify Switch',
  defaultCountry: 'US',
  masterSwitch: { enabled: true, name: 'Notifications Enabled' },
  providers: [TWILIO, { ...SMTP, credentialsFile: 'smtp.json' }, TELEGRAM],
  groups: [{ id: 'family', name: 'Family', sms: ['+16785550101', '+16785550102'], email: ['a@example.com'], telegram: ['123456789'] }],
  switches: [{
    id: '6f1c2a9e-2b1c-4b8f-9d1e-0c5a1e2f3a4b',
    name: 'Water Leak Alert',
    failureSensor: true,
    actions: [
      { providerId: 'twilio-main', channel: 'sms', groups: ['family'], recipients: ['+16785550103'], body: 'Water detected at {{time}}.' },
      { providerId: 'fastmail', channel: 'email', groups: ['family'], subject: 'Leak', body: 'Water detected under the kitchen sink at {{time}} on {{date}}.' },
    ],
  }],
};

/** Every rendered element whose box starts left of the viewport or ends past it, plus the page's scroll width. */
async function audit(page) {
  return page.evaluate(() => {
    const width = window.innerWidth;
    const skip = new Set(['SCRIPT', 'STYLE', 'LINK', 'OPTION', 'OPTGROUP']);
    const offenders = [];
    for (const node of document.querySelectorAll('body *')) {
      if (skip.has(node.tagName) || !node.checkVisibility()) {
        continue;
      }
      const rect = node.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) {
        continue;
      }
      if (rect.left < 0 || rect.right > width + 0.5) {
        offenders.push(`<${node.tagName.toLowerCase()} class="${node.className}"> left=${rect.left.toFixed(1)} right=${rect.right.toFixed(1)}`);
      }
    }
    return { width, scrollWidth: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth), offenders };
  });
}

/** For each grid with two or more visible children, the distinct left edges of those children. */
async function gridColumns(page) {
  return page.evaluate(() => [...document.querySelectorAll('.ns-grid')].map((grid) => {
    const children = [...grid.children].filter((child) => child.getBoundingClientRect().height > 0);
    const lefts = [...new Set(children.map((child) => Math.round(child.getBoundingClientRect().left)))];
    const widths = children.map((child) => Math.round(child.getBoundingClientRect().width));
    return { children: children.length, lefts, widths, gridWidth: Math.round(grid.getBoundingClientRect().width) };
  }).filter((grid) => grid.children >= 2));
}

/** For every phone row: the boxes of the country dropdown, the number field and its Remove button. */
async function phoneRows(page) {
  return page.evaluate(() => [...document.querySelectorAll('.phone-controls')].map((row) => {
    const box = (selector) => {
      const rect = row.querySelector(selector)?.getBoundingClientRect();
      return rect ? { top: Math.round(rect.top), left: Math.round(rect.left), right: Math.round(rect.right), width: Math.round(rect.width) } : null;
    };
    return {
      country: box('.phone-country'), number: box('.phone-national'), remove: box('.phone-number-line .btn'),
      rowWidth: Math.round(row.getBoundingClientRect().width),
    };
  }));
}

/**
 * For every card footer: the classes of its visible buttons in document order, plus whether any two
 * primary buttons (filled or outlined) are adjacent siblings and where the two sides sit.
 */
async function footerButtons(page) {
  return page.evaluate(() => [...document.querySelectorAll('.card-footer')].map((footer) => {
    const buttons = [...footer.querySelectorAll('button, a[role="button"]')].filter((node) => node.getBoundingClientRect().height > 0);
    const isPrimary = (node) => /\bbtn-(outline-)?primary\b/.test(node.className);
    let adjacentPrimary = false;
    for (const node of buttons) {
      if (!isPrimary(node)) {
        continue;
      }
      for (const sibling of [node.previousElementSibling, node.nextElementSibling]) {
        if (sibling && sibling.matches('button, a[role="button"]') && isPrimary(sibling)) {
          adjacentPrimary = true;
        }
      }
    }
    const left = footer.querySelector('.ns-footer-left');
    const right = footer.querySelector('.ns-footer-right');
    const leftRect = left?.getBoundingClientRect();
    const rightRect = right?.getBoundingClientRect();
    const hasRight = Boolean(rightRect && rightRect.width > 0);
    return {
      labels: buttons.map((node) => node.textContent.trim()),
      primary: buttons.filter(isPrimary).map((node) => node.textContent.trim()),
      red: buttons.filter((node) => /\btext-danger\b|\bbtn-(outline-)?danger\b/.test(node.className)).map((node) => node.textContent.trim()),
      adjacentPrimary,
      leftFirst: hasRight ? leftRect.left < rightRect.left : true,
      // Wrapped when the two sides do not overlap vertically (on one line they do, whatever their heights).
      wrapped: hasRight ? leftRect.top >= rightRect.bottom - 1 || rightRect.top >= leftRect.bottom - 1 : false,
      primaryOnTop: hasRight ? rightRect.top <= leftRect.top + 1 : true,
    };
  }));
}

/** WCAG relative luminance and contrast ratio for sRGB colours given as [r, g, b] in 0..255. */
function luminance([r, g, b]) {
  const channel = (v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

export function contrastRatio(foreground, background) {
  const [l1, l2] = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
  return (l1 + 0.05) / (l2 + 0.05);
}

function parseColor(text) {
  const match = /rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+([\d.]+))?\s*\)/.exec(text);
  if (!match) {
    throw new Error(`unexpected colour ${text}`);
  }
  return { rgb: [Number(match[1]), Number(match[2]), Number(match[3])], alpha: match[4] === undefined ? 1 : Number(match[4]) };
}

/** `foreground` composited over `background` (both opaque after compositing). */
function composite(foreground, background) {
  return foreground.rgb.map((value, i) => Math.round(value * foreground.alpha + background[i] * (1 - foreground.alpha)));
}

/**
 * The first visible element for each selector with its computed colour and the effective background
 * behind it (the nearest ancestor with a non-transparent background, composited over the page).
 */
async function textColors(page, selectors) {
  return page.evaluate((list) => list.map((selector) => {
    const node = [...document.querySelectorAll(selector)].find((candidate) => candidate.checkVisibility() && candidate.textContent.trim().length > 0);
    if (!node) {
      return { selector, missing: true };
    }
    const layers = [];
    for (let current = node; current; current = current.parentElement) {
      const background = getComputedStyle(current).backgroundColor;
      if (background && background !== 'rgba(0, 0, 0, 0)' && background !== 'transparent') {
        layers.push(background);
      }
    }
    return {
      selector, text: node.textContent.trim().slice(0, 40), color: getComputedStyle(node).color, layers,
      pageBackground: getComputedStyle(document.body).backgroundColor,
    };
  }), selectors);
}

function effectiveContrast(entry) {
  // Composite from the page outwards: the body background, then each ancestor layer from the outermost in.
  const pageBackground = parseColor(entry.pageBackground);
  let background = composite(pageBackground, [255, 255, 255]);
  for (const layer of [...entry.layers].reverse()) {
    background = composite(parseColor(layer), background);
  }
  return contrastRatio(composite(parseColor(entry.color), background), background);
}

/** One help element per card type, plus the disclosure label, the QR caption, a help link, the section intro and the footer. */
const SECONDARY_TEXT = [
  '.card[data-path^="providers"] .ns-help',
  '.card[data-path^="groups"] .ns-help',
  '.card[data-path^="switches"] .ns-help',
  '.card[data-path^="providers"] details.ns-advanced > summary',
  '.card[data-path^="providers"] .ns-qr-caption',
  '.card[data-path^="switches"] .ns-help-toggle',
  '.card[data-path^="providers"] .ns-help-link',
  '.section-copy',
  '.ns-footer',
  '.ns-footer a',
];

/**
 * The same kinds on a fresh, empty configuration, where nothing sits inside a provider, group or switch card:
 * an empty-state line, checkbox help, field help under Settings, the Settings > Advanced summary toggle, the
 * Get started card's caption and tile help, the "Add a provider first." hint, a disabled Add button and the
 * Save status line.
 */
const EMPTY_SECONDARY_TEXT = [
  '#section-groups .form-text',
  '#section-settings .form-check .ns-help',
  '#section-settings [data-path="name"] .ns-help',
  '#section-settings details.ns-advanced > summary',
  '.ns-get-started .ns-get-started-intro',
  '.ns-get-started .ns-chooser-tile .ns-secondary',
  '#section-switches .ns-add-hint',
  '#section-switches .btn:disabled',
  '.issues .fw-semibold',
  '.ns-footer',
];

/** A fresh install: no platform block has been saved yet. */
const EMPTY_CONFIG = { platform: 'NotifySwitch', name: 'Notify Switch' };

test('settings UI layout: nothing is clipped at the left edge or overflows the iframe, and grids and phone rows stack on a phone', async (t) => {
  const browser = await launchOrSkip(t);
  if (!browser) {
    return;
  }
  try {
    const page = await openSettings(browser, CONFIG);
    assert.equal(await page.locator('.alert-danger').count(), 0, 'the configuration loaded');

    // Every section heading and label starts inside the page, with the container's 16px padding on both sides.
    const paddings = await page.evaluate(() => {
      const style = getComputedStyle(document.getElementById('app'));
      return [style.paddingLeft, style.paddingRight];
    });
    assert.deepEqual(paddings, ['16px', '16px']);

    for (const width of [900, 599, 400, 360]) {
      await page.setViewportSize({ width, height: 900 });
      // Open the SMTP card's Common settings table so it is measured too.
      await page.locator('details.ns-common-settings').evaluate((node) => {
        node.open = true;
      });
      const result = await audit(page);
      assert.deepEqual(result.offenders, [], `elements outside the ${width}px viewport`);
      assert.ok(result.scrollWidth <= width, `no horizontal scroll at ${width}px (scrollWidth ${result.scrollWidth})`);
      const heading = await page.locator('h2').first().boundingBox();
      assert.ok(heading && heading.x >= 16, `section headings start at or after the padding at ${width}px (x=${heading?.x})`);

      const grids = await gridColumns(page);
      assert.ok(grids.length >= 3, 'the page has two-column grids to check');
      for (const grid of grids) {
        if (width < 600) {
          assert.equal(grid.lefts.length, 1, `grid stacks to one column at ${width}px: lefts ${grid.lefts.join(', ')}`);
          assert.ok(grid.widths.every((w) => Math.abs(w - grid.gridWidth) <= 1), `each stacked field spans the grid at ${width}px`);
        } else {
          assert.ok(grid.lefts.length >= 2, `grid shows columns side by side at ${width}px: lefts ${grid.lefts.join(', ')}`);
        }
      }

      // Phone rows (SPEC section 11.2, item 16): country, number and Remove on one line on wide screens; below
      // 600px the country takes its own line and the number keeps Remove beside it.
      const rows = await phoneRows(page);
      assert.ok(rows.length >= 4, 'sender numbers, group numbers and extra recipients render phone rows');
      for (const row of rows) {
        assert.ok(row.country && row.number && row.remove, 'each phone row has a country, a number and a Remove button');
        assert.equal(row.number.top, row.remove.top, `Remove sits beside the number at ${width}px`);
        assert.ok(row.remove.left >= row.number.right, `Remove is to the right of the number at ${width}px`);
        if (width < 600) {
          assert.ok(row.country.top < row.number.top, `the country is on its own line above the number at ${width}px`);
          assert.equal(row.country.left, row.number.left, `the number starts where the country starts at ${width}px`);
          assert.ok(Math.abs(row.country.width - row.rowWidth) <= 1, `the country spans the row at ${width}px`);
        } else {
          assert.equal(row.country.top, row.number.top, `country and number share a line at ${width}px`);
        }
      }
    }
    await page.setViewportSize({ width: 900, height: 900 });

    // Uncovered channel warning (SPEC section 11.3): the family group has a Telegram chat but the switch has no Telegram action.
    const warning = page.locator('.coverage-warning');
    assert.equal(await warning.count(), 1);
    assert.equal(await warning.locator('.coverage-warning-text').textContent(),
      'This switch sends to a group with Telegram chat IDs, but it has no Telegram action. Those recipients will not receive anything.');
    const addButton = warning.getByRole('button', { name: 'Add Telegram action' });
    assert.equal(await addButton.count(), 1);
    assert.equal(await page.locator('.issues').isHidden(), true, 'a coverage warning is not a validation issue');
    assert.deepEqual(await page.evaluate(() => window.__hb.save.at(-1)), true, 'Save stays enabled');

    // The button appends a Telegram action on the first provider that serves Telegram, with the same group selected.
    await addButton.click();
    assert.equal(await page.locator('.action-card').count(), 3);
    const added = page.locator('.action-card').nth(2);
    assert.equal(await added.locator('select').nth(0).inputValue(), 'telegram-home');
    assert.equal(await added.locator('select').nth(1).inputValue(), 'telegram');
    assert.deepEqual(await added.locator('select').nth(1).locator('option').allTextContents(), ['Telegram'], 'only the channels the provider serves');
    assert.equal(await added.locator('input[type="checkbox"]').isChecked(), true, 'the family group is selected');
    assert.equal(await page.locator('.coverage-warning').count(), 0, 'the warning clears once the channel is covered');
    // Config pushes are debounced; wait for the one that carries the new action.
    await page.waitForFunction(() => window.__hb.updates.at(-1)?.[0].switches[0].actions.length === 3);
    const pushed = await page.evaluate(() => window.__hb.updates.at(-1)[0].switches[0].actions[2]);
    assert.deepEqual(pushed, { providerId: 'telegram-home', channel: 'telegram', groups: ['family'], recipients: [], body: '' });
    assert.deepEqual(await page.evaluate(() => window.__hb.save.at(-1)), false, 'the empty message is a validation issue until filled in');

    // Card footers (SPEC section 11.2, item 11): red text button on the left, one outlined primary on the right.
    let footers = await footerButtons(page);
    assert.equal(footers.length, 3 + 1 + 1, 'one footer per provider, group and switch card');
    for (const footer of footers) {
      assert.equal(footer.adjacentPrimary, false, `no two primary buttons are adjacent: ${footer.labels.join(', ')}`);
      assert.ok(footer.primary.length <= 1, `at most one primary button per footer: ${footer.labels.join(', ')}`);
      assert.equal(footer.red.length, 1, `one red text button per footer: ${footer.labels.join(', ')}`);
      assert.match(footer.red[0], /^Remove (provider|group|switch)$/);
      assert.equal(footer.leftFirst, true, 'the red button is on the left');
      assert.equal(footer.wrapped, false, 'footers fit on one line at 900px');
    }
    assert.deepEqual(footers.map((footer) => footer.primary), [['Test connection'], ['Test connection'], ['Test connection'], [], ['Test send']]);
    // "Add action" is a link-style button directly under the actions list, left aligned, not in the footer.
    const addAction = page.getByRole('button', { name: 'Add action' });
    assert.match(await addAction.getAttribute('class'), /\bbtn-link\b/);
    const addActionBox = await addAction.boundingBox();
    const actionsBox = await page.locator('.actions').boundingBox();
    assert.ok(addActionBox.y >= actionsBox.y + actionsBox.height - 1, 'Add action sits under the actions list');
    assert.ok(Math.abs(addActionBox.x - actionsBox.x) < 2, 'Add action is left aligned with the actions list');

    // Test send confirmation: the button is replaced in place by the question, a primary Send and a text Cancel.
    await page.getByRole('button', { name: 'Test send' }).click();
    assert.equal(await page.locator('.test-send-question').textContent(), 'Send to 5 recipients now?');
    const send = page.getByRole('button', { name: 'Send', exact: true });
    assert.match(await send.getAttribute('class'), /\bbtn-primary\b/);
    assert.match(await page.getByRole('button', { name: 'Cancel' }).getAttribute('class'), /\bbtn-link\b/);
    assert.equal(await page.getByRole('button', { name: 'Test send' }).count(), 0, 'Test send is replaced, not duplicated');
    footers = await footerButtons(page);
    assert.equal(footers[4].adjacentPrimary, false, `Send and Cancel: ${footers[4].labels.join(', ')}`);
    assert.deepEqual(footers[4].primary, ['Send']);
    // When the footer wraps on a phone, the primary side is the top line and Remove drops below it (SPEC section 11.2, item 16).
    await page.setViewportSize({ width: 320, height: 900 });
    footers = await footerButtons(page);
    assert.equal(footers[4].wrapped, true, 'the confirmation wraps at 320px');
    assert.equal(footers[4].primaryOnTop, true, 'the primary action stays on top when the footer wraps');
    for (const footer of footers) {
      assert.equal(footer.primaryOnTop, true, `primary on top: ${footer.labels.join(', ')}`);
    }
    await page.setViewportSize({ width: 900, height: 900 });
    // Escape restores the button; so does Cancel.
    await page.keyboard.press('Escape');
    assert.equal(await page.getByRole('button', { name: 'Test send' }).count(), 1);
    await page.getByRole('button', { name: 'Test send' }).click();
    await page.getByRole('button', { name: 'Cancel' }).click();
    assert.equal(await page.getByRole('button', { name: 'Test send' }).count(), 1);
    // Red is reserved for Remove buttons and the reset flow.
    const redButtons = await page.evaluate(() => [...document.querySelectorAll('button')]
      .filter((node) => /\btext-danger\b|\bbtn-(outline-)?danger\b/.test(node.className))
      .map((node) => node.textContent.trim()));
    assert.ok(redButtons.length > 0);
    assert.ok(redButtons.every((label) => /^(Remove|Reset plugin to fresh install)/.test(label)),
      `only Remove and Reset buttons are red: ${redButtons.join(', ')}`);

    // With validation issues showing, the sticky issues box is inside the viewport too.
    await page.setViewportSize({ width: 360, height: 700 });
    assert.equal(await page.locator('.issues').isVisible(), true);
    const withIssues = await audit(page);
    assert.deepEqual(withIssues.offenders, []);
    assert.ok(withIssues.scrollWidth <= 360);
  } finally {
    await browser.close();
  }
});

test('settings UI layout: every button is at least 44px tall on a touch device', async (t) => {
  const browser = await launchOrSkip(t);
  if (!browser) {
    return;
  }
  try {
    const page = await openSettings(browser, CONFIG, { viewport: { width: 390, height: 844 }, hasTouch: true });
    assert.equal(await page.evaluate(() => document.body.classList.contains('ns-touch')), true);
    const short = await page.evaluate(() => [...document.querySelectorAll('button, a[role="button"]')]
      .filter((node) => node.checkVisibility())
      .map((node) => ({ label: node.textContent.trim() || node.getAttribute('aria-label'), height: node.getBoundingClientRect().height }))
      .filter((entry) => entry.height < 44));
    assert.deepEqual(short, [], 'buttons, text buttons included, are at least 44px tall');
    const textButtons = await page.evaluate(() => [...document.querySelectorAll('.btn-link')].filter((node) => node.checkVisibility()).length);
    assert.ok(textButtons > 0, 'text buttons were measured too');
    const result = await audit(page);
    assert.deepEqual(result.offenders, []);
    assert.ok(result.scrollWidth <= 390);
  } finally {
    await browser.close();
  }
});

test('settings UI theme: secondary text meets WCAG AA contrast in dark mode and light mode, on a full and an empty configuration', async (t) => {
  const browser = await launchOrSkip(t);
  if (!browser) {
    return;
  }
  try {
    for (const dark of [true, false]) {
      for (const [config, selectors] of [[CONFIG, SECONDARY_TEXT], [EMPTY_CONFIG, EMPTY_SECONDARY_TEXT]]) {
        const page = await openSettings(browser, config, { dark });
        // The page is themed the way the Homebridge UI does it: body classes, no data-bs-theme on the root.
        const classes = await page.evaluate(() => [...document.body.classList]);
        for (const cls of dark ? HOST_BODY_CLASSES.dark : HOST_BODY_CLASSES.light) {
          assert.ok(classes.includes(cls), `body carries ${cls}`);
        }
        assert.equal(await page.evaluate(() => document.documentElement.getAttribute('data-bs-theme')), null);
        const entries = await textColors(page, selectors);
        for (const entry of entries) {
          assert.equal(entry.missing, undefined, `${entry.selector} renders`);
          const ratio = effectiveContrast(entry);
          assert.ok(ratio >= 4.5,
            `${dark ? 'dark' : 'light'} mode, ${config === CONFIG ? 'full' : 'empty'} config: ${entry.selector} ("${entry.text}") `
            + `has contrast ${ratio.toFixed(2)}:1 (${entry.color})`);
        }
        // Dark mode is really dark: the page background is darker than the text.
        const body = parseColor(entries[0].pageBackground).rgb;
        assert.equal(luminance(body) < 0.5, dark, `page background ${entries[0].pageBackground} matches the theme`);
        if (config === EMPTY_CONFIG) {
          // Nothing on the empty page is clipped or overflows on a phone either.
          await page.setViewportSize({ width: 360, height: 800 });
          const result = await audit(page);
          assert.deepEqual(result.offenders, []);
          assert.ok(result.scrollWidth <= 360);
        }
        await page.close();
      }
    }
  } finally {
    await browser.close();
  }
});
