import assert from 'node:assert/strict';
import { test } from 'node:test';

import { launchOrSkip, openSettings } from './browser.mjs';
import { SMTP, TELEGRAM, TWILIO } from './helpers.mjs';

/**
 * Headless Chromium smoke test for the built settings UI (homebridge-ui/public). The page is loaded
 * the way the Homebridge UI loads it (see browser.mjs) and checked for:
 *   - no rendered element starting left of the viewport or ending past it, at 400px and 900px;
 *   - no horizontal page scroll;
 *   - the two-column grids stacking to one column below 600px;
 *   - the uncovered channel warning with its copy and "Add … action" button, with Save left enabled;
 *   - the card footers (SPEC section 11.2, item 11): the red text button on the left, one outlined
 *     primary on the right, and never two primary buttons next to each other.
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
      if (skip.has(node.tagName)) {
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

/**
 * For every card footer: the classes of its visible buttons in document order, plus whether any two
 * primary buttons (filled or outlined) are adjacent siblings.
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
    return {
      labels: buttons.map((node) => node.textContent.trim()),
      primary: buttons.filter(isPrimary).map((node) => node.textContent.trim()),
      red: buttons.filter((node) => /\btext-danger\b|\bbtn-(outline-)?danger\b/.test(node.className)).map((node) => node.textContent.trim()),
      adjacentPrimary,
      leftFirst: leftRect && rightRect && rightRect.width > 0 ? leftRect.left < rightRect.left : true,
    };
  }));
}

test('settings UI layout: nothing is clipped at the left edge or overflows the iframe, and grids stack on a phone', async (t) => {
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

    for (const width of [900, 599, 400]) {
      await page.setViewportSize({ width, height: 900 });
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
    }

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
    await page.setViewportSize({ width: 400, height: 700 });
    assert.equal(await page.locator('.issues').isVisible(), true);
    const withIssues = await audit(page);
    assert.deepEqual(withIssues.offenders, []);
    assert.ok(withIssues.scrollWidth <= 400);
  } finally {
    await browser.close();
  }
});
