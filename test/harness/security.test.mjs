import assert from 'node:assert/strict';
import { test } from 'node:test';

import { loadCredentialsFile } from '../../dist/credentials.js';
import { findForbiddenKey } from '../../dist/safeKeys.js';
import { escapeControlCharacters, quoteValue } from '../../dist/text.js';
import { testSend } from '../../dist/ui/handlers.js';
import { validateConfig, validateProvider } from '../../dist/validation.js';
import { fakeLogger, NTFY, platformConfig, storageDir, TWILIO } from './helpers.mjs';

/**
 * The 1.1.0 adversarial review (SPEC section 12, item 12): log lines cannot be shaped by configuration
 * values, prototype-pollution keys are refused at every level, credentials file values never leave the
 * file, the provider and group name rule warns, and the size bounds hold.
 */

const SMS_ACTION = { providerId: 'twilio-main', channel: 'sms', groups: ['family'], body: 'hi' };

function errors(result) {
  return result.issues.filter((issue) => issue.level === 'error').map((issue) => `${issue.path}: ${issue.message}`);
}

function warnings(result) {
  return result.issues.filter((issue) => issue.level === 'warning').map((issue) => `${issue.path}: ${issue.message}`);
}

/** True when a string holds a raw control character or line separator. */
function hasControl(text) {
  // eslint-disable-next-line no-control-regex
  return /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/.test(text);
}

test('logging: every line through PluginLogger has its control characters escaped, at every level', () => {
  const logger = fakeLogger(true);
  logger.log.info('one\ntwo\r\n\u001b[31mred\u0000\u2028three');
  logger.log.warn('tab\there');
  logger.log.error('x\u009fy');
  logger.log.debug('body\nline');
  assert.deepEqual(logger.lines.map((line) => line.message), [
    'one\\ntwo\\r\\n\\u001b[31mred\\u0000\\u2028three',
    'tab\\there',
    'x\\u009fy',
    '[debug] body\\nline',
  ]);
  for (const line of logger.lines) {
    assert.equal(hasControl(line.message), false);
  }
  assert.equal(escapeControlCharacters('plain'), 'plain');
  assert.equal(quoteValue('a\nb'), '"a\\nb"');
  assert.equal(quoteValue('x'.repeat(100)), `"${'x'.repeat(79)}…"`, 'long values are cut');
});

test('validation: a configuration value quoted in an issue cannot start a new log line', async () => {
  const config = platformConfig({
    providers: [TWILIO],
    groups: [{ id: 'family', name: 'Family', sms: ['+1\nERROR fake line'], email: ['a\u001b[31m@example.com'], telegram: ['12\r34'] }],
    actions: [{ ...SMS_ACTION, providerId: 'twi\nlio' }],
  });
  const result = await validateConfig(config, fakeLogger().log);
  assert.equal(result.config, undefined);
  const lines = errors(result);
  assert.equal(lines.length, 4, lines.join('\n'));
  assert.equal(lines[0], 'groups[0].sms[0]: "+1\\nERROR fake line" is not a valid phone number; use E.164 such as +16785550100');
  assert.equal(lines[1], 'groups[0].email[0]: "a\\u001b[31m@example.com" is not a valid email address', 'a control character fails the email pattern');
  assert.equal(lines[2], 'groups[0].telegram[0]: "12\\r34" is not a Telegram chat id (digits only, negative for group chats)');
  assert.match(lines[3], /^switches\[0\]\.actions\[0\]\.providerId: no provider with id "twi\\nlio"/);
  for (const line of [...lines, ...warnings(result), ...result.notices]) {
    assert.equal(hasControl(line), false, line);
  }
});

test('name rule: provider, group and platform names with control characters or angle brackets warn at their field and the platform still starts', async () => {
  const config = platformConfig({
    providers: [{ ...TWILIO, name: 'Twilio <script>' }],
    groups: [{ id: 'family', name: 'Fam\nily', sms: ['+16785550101'] }],
    actions: [SMS_ACTION],
  });
  config.name = 'Notify\u0007Switch';
  const result = await validateConfig(config, fakeLogger().log);
  assert.ok(result.config, 'a name that breaks the rule is a warning, not an error');
  const expected = 'has characters that are not allowed; use letters, numbers, spaces, and punctuation, up to 64 characters';
  assert.deepEqual(warnings(result).filter((line) => line.includes('not allowed')), [
    `platform.name: ${expected}`,
    `providers[0].name: ${expected}`,
    `groups[0].name: ${expected}`,
  ]);
  const long = platformConfig({ providers: [{ ...TWILIO, name: 'x'.repeat(65) }], actions: [SMS_ACTION] });
  assert.deepEqual(warnings(await validateConfig(long, fakeLogger().log)).filter((line) => line.includes('not allowed')), [`providers[0].name: ${expected}`]);
  const fine = platformConfig({ providers: [{ ...TWILIO, name: 'Alex\'s Twilio (home), #1 & co. ünïcode 😀' }], actions: [SMS_ACTION] });
  assert.deepEqual(warnings(await validateConfig(fine, fakeLogger().log)).filter((line) => line.includes('not allowed')), []);
});

test('forbidden keys: __proto__, constructor and prototype are refused at every nesting level of the platform block and a provider block', async () => {
  assert.equal(findForbiddenKey({ a: { b: [{ c: 1 }, { __proto__: {} }] } }), undefined, 'an object literal sets the prototype, not a key');
  assert.equal(findForbiddenKey(JSON.parse('{"a":{"b":[{"c":1},{"__proto__":{"x":1}}]}}')), 'a.b[1].__proto__');
  assert.equal(findForbiddenKey({ providers: [{ constructor: 1 }] }), 'providers[0].constructor');
  assert.equal(findForbiddenKey({ switches: [{ actions: [{ prototype: 1 }] }] }), 'switches[0].actions[0].prototype');

  const base = platformConfig({ providers: [TWILIO], actions: [SMS_ACTION] });
  const top = JSON.parse(`${JSON.stringify(base).slice(0, -1)},"__proto__":{"polluted":true}}`);
  const result = await validateConfig(top, fakeLogger().log);
  assert.equal(result.config, undefined);
  assert.deepEqual(errors(result), ['__proto__: is not an allowed key name']);
  assert.equal({}.polluted, undefined);

  const nested = JSON.parse(JSON.stringify(base));
  nested.providers[0] = JSON.parse(`${JSON.stringify(TWILIO).slice(0, -1)},"constructor":{"prototype":{"polluted":true}}}`);
  assert.deepEqual(errors(await validateConfig(nested, fakeLogger().log)), ['providers[0].constructor: is not an allowed key name']);

  const provider = await validateProvider(JSON.parse(`${JSON.stringify(TWILIO).slice(0, -1)},"emailFrom":{"prototype":1}}`), fakeLogger().log);
  assert.equal(provider.provider, undefined);
  assert.deepEqual(errors(provider), ['provider.emailFrom.prototype: is not an allowed key name']);
});

test('credentialsFile: errors and warnings carry the path and, at most, an escaped key name, never a value or the file text', async () => {
  const storagePath = storageDir({
    'broken.json': '{ "apiKeySecret": "leaked-secret-text" ',
    'number.json': { apiKeySecret: 918273645 },
    'keys.json': { 'odd\nkey': 'leaked-value', apiKeySecret: 'fine' },
  });
  const broken = loadCredentialsFile('broken.json', 'twilio', storagePath);
  assert.match(broken.error, /is not valid JSON$/);
  assert.equal(broken.error.includes('leaked-secret-text'), false);
  const number = loadCredentialsFile('number.json', 'twilio', storagePath);
  assert.match(number.error, /key "apiKeySecret" in ".*number\.json" must be a string$/);
  assert.equal(number.error.includes('918273645'), false);
  const keys = loadCredentialsFile('keys.json', 'twilio', storagePath);
  assert.equal(keys.error, undefined);
  assert.deepEqual(keys.values, { apiKeySecret: 'fine' });
  assert.equal(keys.warnings.length, 1);
  assert.match(keys.warnings[0], /^key "odd\\nkey" in ".*keys\.json" is not a secret field of twilio providers/);
  assert.equal(hasControl(keys.warnings[0]), false);
  assert.equal(keys.warnings[0].includes('leaked-value'), false);
  assert.equal(keys.warnings[0].includes('fine'), false);
});

test('bounds: recipients per action, entries per list, actions per switch and items per section are enforced with their limits', async () => {
  const numbers = (n) => Array.from({ length: n }, (_, i) => `+1678555${String(i).padStart(4, '0')}`);
  const many = platformConfig({
    providers: [TWILIO],
    groups: [{ id: 'family', name: 'Family', sms: numbers(101) }],
    actions: [SMS_ACTION],
  });
  assert.deepEqual(errors(await validateConfig(many, fakeLogger().log)), ['switches[0].actions[0]: resolves to 101 recipients; the limit is 100 per action']);
  const ninety = platformConfig({ providers: [TWILIO], groups: [{ id: 'family', name: 'Family', sms: numbers(100) }], actions: [SMS_ACTION] });
  assert.deepEqual(errors(await validateConfig(ninety, fakeLogger().log)), []);

  const list = platformConfig({ providers: [TWILIO], groups: [{ id: 'family', name: 'Family', sms: numbers(201) }], actions: [SMS_ACTION] });
  const listResult = await validateConfig(list, fakeLogger().log);
  assert.ok(errors(listResult).includes('groups[0].sms: has 201 entries; the limit is 200'));

  const actions = platformConfig({ providers: [TWILIO], actions: Array.from({ length: 21 }, () => SMS_ACTION) });
  assert.ok(errors(await validateConfig(actions, fakeLogger().log)).includes('switches[0].actions: has 21 actions; the limit is 20'));

  const items = platformConfig({ providers: Array.from({ length: 101 }, (_, i) => ({ ...TWILIO, id: `twilio-${i}` })), actions: [SMS_ACTION] });
  assert.ok(errors(await validateConfig(items, fakeLogger().log)).includes('providers: has 101 entries; the limit is 100'));

  const tags = platformConfig({
    providers: [NTFY],
    actions: [{ providerId: 'ntfy-home', channel: 'ntfy', groups: ['family'], body: 'hi', tags: Array.from({ length: 9 }, (_, i) => `t${i}`) }],
  });
  assert.ok(errors(await validateConfig(tags, fakeLogger().log)).includes('switches[0].actions[0].tags: has 9 entries; the limit is 8'));
});

test('ui server: a Test send with an oversized switch id is refused without validating anything', async () => {
  const result = await testSend(platformConfig({ providers: [TWILIO], actions: [SMS_ACTION] }), 'x'.repeat(65));
  assert.deepEqual(result, { ok: false, message: 'No switch selected.' });
  const missing = await testSend(platformConfig({ providers: [TWILIO], actions: [SMS_ACTION] }), 'x'.repeat(64));
  assert.equal(missing.message, 'That switch is not in the current configuration.');
});
