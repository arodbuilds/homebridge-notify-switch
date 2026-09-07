import assert from 'node:assert/strict';
import { test } from 'node:test';

import { defaultNeeded, providersForChannel, pruneDefaults, resolveDefaultProvider, servesChannel } from '../../dist/defaults.js';
import { NTFY, SMTP, TELEGRAM, TWILIO } from './helpers.mjs';

/**
 * Platform defaults per channel (SPEC section 5.7): the rules startup validation and the settings UI share.
 */

const TWILIO_2 = { ...TWILIO, id: 'twilio-2', emailFrom: undefined };
const SMTP_2 = { ...SMTP, id: 'gmail' };

test('defaults: a provider serves the channels of its type, and Twilio serves email only once a from address is set', () => {
  assert.deepEqual(['sms', 'email', 'telegram', 'ntfy'].map((channel) => servesChannel(TWILIO, channel)), [true, true, false, false]);
  assert.deepEqual(['sms', 'email'].map((channel) => servesChannel(TWILIO_2, channel)), [true, false]);
  assert.equal(servesChannel({ ...TWILIO, emailFrom: { address: '  ' } }, 'email'), false);
  assert.deepEqual(['sms', 'email', 'telegram', 'ntfy'].map((channel) => servesChannel(SMTP, channel)), [false, true, false, false]);
  assert.equal(servesChannel(TELEGRAM, 'telegram'), true);
  assert.equal(servesChannel(NTFY, 'ntfy'), true);
  assert.deepEqual(providersForChannel([TWILIO, SMTP, TWILIO_2, TELEGRAM], 'email').map((p) => p.id), ['twilio-main', 'fastmail']);
  assert.deepEqual(providersForChannel([TWILIO, SMTP, TWILIO_2, { ...NTFY, id: ' ' }], 'sms').map((p) => p.id), ['twilio-main', 'twilio-2']);
});

test('defaults: one provider is the default on its own, a stored entry wins among several, otherwise the first in order', () => {
  assert.deepEqual(resolveDefaultProvider('email', [TWILIO, TELEGRAM], {}), { id: 'twilio-main', source: 'only', candidates: ['twilio-main'] });
  assert.deepEqual(resolveDefaultProvider('email', [TWILIO, TELEGRAM], { email: 'nope' }),
    { id: 'twilio-main', source: 'only', candidates: ['twilio-main'] });
  assert.deepEqual(resolveDefaultProvider('telegram', [TWILIO], {}), { source: 'none', candidates: [] });
  assert.deepEqual(resolveDefaultProvider('email', [TWILIO, SMTP, SMTP_2], { email: 'gmail' }),
    { id: 'gmail', source: 'stored', candidates: ['twilio-main', 'fastmail', 'gmail'] });
  assert.deepEqual(resolveDefaultProvider('email', [TWILIO, SMTP, SMTP_2], {}),
    { id: 'twilio-main', source: 'first', candidates: ['twilio-main', 'fastmail', 'gmail'] });
  assert.deepEqual(resolveDefaultProvider('email', [TWILIO, SMTP], { email: 'telegram-home' }).source, 'first',
    'a stored id that does not serve the channel is ignored');
  assert.deepEqual(resolveDefaultProvider('email', [TWILIO, SMTP], { email: ' fastmail ' }).id, 'fastmail', 'ids are matched trimmed');
  assert.equal(defaultNeeded('email', [TWILIO, SMTP], {}), true);
  assert.equal(defaultNeeded('email', [TWILIO, SMTP], { email: 'fastmail' }), false);
  assert.equal(defaultNeeded('email', [TWILIO], {}), false);
  assert.equal(defaultNeeded('sms', [TWILIO, SMTP], {}), false);
});

test('defaults: pruning keeps only the entries worth storing, so removing the default provider leaves the right state', () => {
  const stored = { email: 'fastmail', sms: 'twilio-main', telegram: 'gone' };
  assert.deepEqual(pruneDefaults([TWILIO, SMTP, TWILIO_2], stored), { email: 'fastmail', sms: 'twilio-main' }, 'two sms providers: the stored entry stays');
  assert.deepEqual(pruneDefaults([TWILIO, SMTP], stored), { email: 'fastmail' }, 'a single sms provider stores nothing');
  assert.deepEqual(pruneDefaults([TWILIO], stored), {}, 'the email default was removed and one provider remains');
  assert.deepEqual(pruneDefaults([TWILIO, SMTP_2, TWILIO_2], { email: 'fastmail' }), {},
    'the default was removed and several remain: no default, the UI prompts again');
  assert.deepEqual(pruneDefaults([TWILIO, SMTP], undefined), {});
});
