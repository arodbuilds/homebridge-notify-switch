import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { test } from 'node:test';

/**
 * Every "Where do I find this?" style link in the settings UI points at a README section that exists
 * (SPEC section 11.3). The links are read from the built UI bundle; the anchors are GitHub's heading
 * slugs plus any explicit `<a id="…">` anchors in README.md.
 */

const ROOT = resolve(import.meta.dirname, '..', '..');
const README_LINK = /homebridge-notify-switch#([a-z0-9-]+)/g;

/** GitHub's slug for a Markdown heading: lowercase, punctuation dropped, spaces to dashes. */
export function headingSlug(heading) {
  return heading.trim().toLowerCase().replace(/[^\w\s-]/g, '').replace(/\s+/g, '-');
}

function readmeAnchors(text) {
  const anchors = new Set();
  for (const line of text.split('\n')) {
    const heading = /^#{1,6}\s+(.+?)\s*$/.exec(line);
    if (heading) {
      anchors.add(headingSlug(heading[1]));
    }
  }
  for (const match of text.matchAll(/<a\s+(?:id|name)="([^"]+)"/g)) {
    anchors.add(match[1]);
  }
  return anchors;
}

test('README anchors: every README link in the settings UI targets a section that exists', () => {
  const bundle = readFileSync(join(ROOT, 'homebridge-ui', 'public', 'index.js'), 'utf8');
  const links = [...new Set([...bundle.matchAll(README_LINK)].map((match) => match[1]))].sort();
  assert.ok(links.length >= 6, `the UI links into the README (${links.join(', ')})`);
  const anchors = readmeAnchors(readFileSync(join(ROOT, 'README.md'), 'utf8'));
  for (const link of links) {
    assert.ok(anchors.has(link), `README has a section for #${link} (known: ${[...anchors].join(', ')})`);
  }
  // The links the copy promises (SPEC section 11.3).
  for (const expected of ['api-keys', 'a2p-10dlc-registration-for-us-numbers', 'email-through-twilio', 'app-passwords', 'telegram', 'template-variables']) {
    assert.ok(links.includes(expected), `the UI links to #${expected}`);
  }
});

test('README anchors: heading slugs follow GitHub\'s rules', () => {
  assert.equal(headingSlug('Twilio (SMS and email)'), 'twilio-sms-and-email');
  assert.equal(headingSlug('Keeping secrets out of config.json with credentialsFile'), 'keeping-secrets-out-of-configjson-with-credentialsfile');
  assert.equal(headingSlug('A2P 10DLC registration for US numbers'), 'a2p-10dlc-registration-for-us-numbers');
});
