import assert from 'node:assert/strict';
import { test } from 'node:test';

import { addActionLabel, uncoveredChannels, uncoveredChannelWarning } from '../../dist/coverage.js';
import { validateConfig } from '../../dist/validation.js';
import { fakeLogger, platformConfig, SMTP, TELEGRAM, TWILIO } from './helpers.mjs';

/**
 * Uncovered channel detection (SPEC section 10 warnings, section 11.2 item 8, section 11.3 copy):
 * the pure check the settings UI and startup share, and the startup warning built on it.
 */

const FAMILY = { id: 'family', name: 'Family', sms: ['+16785550101'], email: ['a@example.com'], telegram: ['123456789'] };
const NEIGHBOURS = { id: 'neighbours', name: 'Neighbours', sms: [], email: ['n@example.com'], telegram: [] };
const EMPTY = { id: 'empty', name: 'Empty', sms: [], email: [' '], telegram: [] };

test('coverage: channels a targeted group has addresses for but no action sends on, in channel order', () => {
  const actions = [{ channel: 'sms', groups: ['family'], recipients: [] }];
  assert.deepEqual(uncoveredChannels(actions, [FAMILY, NEIGHBOURS]), [
    { channel: 'email', groups: ['family'] },
    { channel: 'telegram', groups: ['family'] },
  ]);
});

test('coverage: every action channel counts as covered, and only targeted groups are considered', () => {
  const actions = [
    { channel: 'sms', groups: ['family'], recipients: [] },
    { channel: 'telegram', groups: ['family'], recipients: [] },
  ];
  assert.deepEqual(uncoveredChannels(actions, [FAMILY, NEIGHBOURS]), [{ channel: 'email', groups: ['family'] }]);
  const extraOnly = [{ channel: 'sms', groups: ['family'], recipients: [] }, { channel: 'email', groups: [], recipients: ['x@example.com'] }];
  assert.deepEqual(uncoveredChannels(extraOnly, [FAMILY]), [{ channel: 'telegram', groups: ['family'] }],
    'an action with extra recipients only still covers its channel');
  assert.deepEqual(uncoveredChannels(actions, [NEIGHBOURS]), [], 'a group nobody targets is ignored');
});

test('coverage: groups are listed once each in configuration order, ids are matched trimmed, blanks and unknown groups are ignored', () => {
  const actions = [
    { channel: 'sms', groups: ['neighbours', ' family '], recipients: [] },
    { channel: 'sms', groups: ['family', 'missing', 'empty'], recipients: [] },
  ];
  assert.deepEqual(uncoveredChannels(actions, [FAMILY, NEIGHBOURS, EMPTY]), [
    { channel: 'email', groups: ['family', 'neighbours'] },
    { channel: 'telegram', groups: ['family'] },
  ]);
  assert.deepEqual(uncoveredChannels([], [FAMILY]), [], 'no actions, nothing targeted, nothing to warn about');
  assert.deepEqual(uncoveredChannels([{ channel: 'sms', groups: ['family'], recipients: [] }], [{ ...FAMILY, email: [], telegram: [] }]), []);
});

test('coverage: the settings UI copy is the SPEC section 11.3 wording, varied per channel', () => {
  assert.equal(uncoveredChannelWarning('email'),
    'This switch sends to a group with email addresses, but it has no email action. Those recipients will not receive anything.');
  assert.equal(uncoveredChannelWarning('sms'),
    'This switch sends to a group with phone numbers, but it has no SMS action. Those recipients will not receive anything.');
  assert.equal(uncoveredChannelWarning('telegram'),
    'This switch sends to a group with Telegram chat IDs, but it has no Telegram action. Those recipients will not receive anything.');
  assert.equal(addActionLabel('email'), 'Add email action');
  assert.equal(addActionLabel('sms'), 'Add SMS action');
  assert.equal(addActionLabel('telegram'), 'Add Telegram action');
});

test('coverage: startup logs one warning per switch and channel with the switch name, and the platform still starts', async () => {
  const config = platformConfig({
    providers: [TWILIO, SMTP, TELEGRAM],
    groups: [FAMILY, NEIGHBOURS],
    actions: [
      { providerId: 'twilio-main', channel: 'sms', groups: ['family'], body: 'hi' },
      { providerId: 'twilio-main', channel: 'sms', groups: ['family', 'neighbours'], recipients: ['+16785550109'], body: 'hi again' },
    ],
  });
  const result = await validateConfig(config, fakeLogger().log);
  assert.ok(result.config, 'an uncovered channel is a warning, not an error');
  const lines = result.issues.filter((issue) => issue.level === 'warning').map((issue) => `${issue.path}: ${issue.message}`);
  const coverage = lines.filter((line) => line.includes('will not receive anything'));
  assert.deepEqual(coverage, [
    'switches[0]: switch "Water Leak Alert" sends to groups "family", "neighbours" with email addresses but has no email action; '
      + 'those recipients will not receive anything',
    'switches[0]: switch "Water Leak Alert" sends to group "family" with Telegram chat IDs but has no Telegram action; '
      + 'those recipients will not receive anything',
  ]);

  const covered = platformConfig({
    providers: [TWILIO, SMTP, TELEGRAM],
    groups: [FAMILY],
    actions: [
      { providerId: 'twilio-main', channel: 'sms', groups: ['family'], body: 'hi' },
      { providerId: 'fastmail', channel: 'email', groups: ['family'], body: 'hi' },
      { providerId: 'telegram-home', channel: 'telegram', groups: ['family'], body: 'hi' },
    ],
  });
  const clean = await validateConfig(covered, fakeLogger().log);
  assert.deepEqual(clean.issues, [], 'no warning when every channel with addresses has an action');
});
