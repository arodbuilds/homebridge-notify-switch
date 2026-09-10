import assert from 'node:assert/strict';
import { test } from 'node:test';

import { validateConfig } from '../../dist/validation.js';
import { fakeLogger, NTFY, platformConfig, SMTP, storageDir, TELEGRAM, TWILIO } from './helpers.mjs';

const SMS_ACTION = { providerId: 'twilio-main', channel: 'sms', groups: ['family'], body: 'hi' };
const TWILIO_EMAIL_ACTION = { providerId: 'twilio-main', channel: 'email', groups: ['family'], body: 'hi' };
const SMTP_ACTION = { providerId: 'fastmail', channel: 'email', groups: ['family'], body: 'hi' };
const TELEGRAM_ACTION = { providerId: 'telegram-home', channel: 'telegram', groups: ['family'], body: 'hi' };
const NTFY_ACTION = { providerId: 'ntfy-home', channel: 'ntfy', groups: ['family'], body: 'hi' };

function errors(result) {
  return result.issues.filter((issue) => issue.level === 'error').map((issue) => `${issue.path}: ${issue.message}`);
}

function warnings(result) {
  return result.issues.filter((issue) => issue.level === 'warning').map((issue) => `${issue.path}: ${issue.message}`);
}

test('validation: every channel validates without a "not yet implemented" warning', async () => {
  const config = platformConfig({
    providers: [TWILIO, SMTP, TELEGRAM, NTFY],
    actions: [SMS_ACTION, TWILIO_EMAIL_ACTION, SMTP_ACTION, TELEGRAM_ACTION, NTFY_ACTION],
    defaultProviders: { email: 'fastmail' },
  });
  const result = await validateConfig(config, fakeLogger().log);
  assert.deepEqual(errors(result), []);
  assert.deepEqual(warnings(result), []);
  assert.equal(result.switches[0].actions.length, 5);
  assert.deepEqual([...result.providers.keys()].sort(), ['fastmail', 'ntfy-home', 'telegram-home', 'twilio-main']);
});

test('validation: an ntfy action carries its title, priority and tags; subject is accepted on ntfy and ignored elsewhere', async () => {
  const config = platformConfig({
    providers: [NTFY, TWILIO],
    groups: [{ id: 'family', name: 'Family', sms: ['+16785550101'], ntfy: ['home-alerts', 'garage'] }],
    actions: [
      { ...NTFY_ACTION, subject: 'Leak', priority: 'urgent', tags: ['warning', 'house', 'warning'] },
      NTFY_ACTION,
      { ...SMS_ACTION, subject: 'x', priority: 'high', tags: ['a'] },
    ],
  });
  const result = await validateConfig(config, fakeLogger().log);
  assert.deepEqual(errors(result), []);
  assert.deepEqual(warnings(result), [
    'switches[0].actions[2].subject: only applies to the email and ntfy channels and is ignored for sms',
    'switches[0].actions[2].priority: only applies to the ntfy channel and is ignored for sms',
    'switches[0].actions[2].tags: only applies to the ntfy channel and is ignored for sms',
  ]);
  const [first, second, sms] = result.switches[0].actions;
  assert.deepEqual([first.subject, first.priority, first.tags, first.recipients], ['Leak', 'urgent', ['warning', 'house'], ['home-alerts', 'garage']]);
  assert.deepEqual([second.subject, second.priority, second.tags], ['Water Leak Alert', 'default', undefined], 'the title defaults to the switch name');
  assert.deepEqual([sms.subject, sms.priority, sms.tags], [undefined, undefined, undefined]);
  assert.equal(result.config.providers[0].server, 'https://ntfy.sh');

  const bad = platformConfig({
    providers: [{ ...NTFY, server: 'ntfy.sh', auth: 'basic' }, { ...NTFY, id: 'ntfy-2', auth: 'token', token: undefined }],
    groups: [{ id: 'family', name: 'Family', ntfy: ['bad topic!'] }],
    actions: [{ ...NTFY_ACTION, tags: ['ok', 'not ok'], priority: 'loud' }],
  });
  assert.deepEqual(errors(await validateConfig(bad, fakeLogger().log)), [
    'providers[0].server: must be a URL such as https://ntfy.sh',
    'providers[0].username: is required when auth is basic',
    'providers[0].password: is required when auth is basic',
    'providers[1].token: is required when auth is token',
    'groups[0].ntfy[0]: "bad topic!" is not an ntfy topic name (letters, digits, dashes and underscores, up to 64 characters)',
    'switches[0].actions[0].priority: must be one of min, low, default, high, urgent',
    'switches[0].actions[0].tags[1]: "not ok" is not a tag; use letters, digits, dashes, underscores and plus signs, up to 32 characters',
    'switches[0].actions[0]: no recipients resolve for ntfy; add a group with ntfy addresses or list recipients directly',
  ]);
});

test('credentialsFile: ntfy takes token, username and password from the file', async () => {
  const storagePath = storageDir({ 'ntfy.json': { token: 'tk_from_file' } });
  const config = platformConfig({ providers: [{ ...NTFY, token: undefined, credentialsFile: 'ntfy.json' }], actions: [NTFY_ACTION] });
  const result = await validateConfig(config, fakeLogger().log, { storagePath });
  assert.deepEqual(errors(result), []);
  assert.equal(result.config.providers[0].token, 'tk_from_file');
  assert.equal(result.notices.find((line) => line.includes('credentialsFile')), 'providers[0].credentialsFile: using token from "ntfy.json"');
});

test('validation: bcc is carried into the resolved email action, defaults to off, and is ignored with a warning on other channels', async () => {
  const config = platformConfig({
    providers: [TWILIO, SMTP],
    groups: [{ id: 'family', name: 'Family', sms: ['+16785550101'], email: ['a@example.com'] }],
    actions: [{ ...SMTP_ACTION, bcc: true }, TWILIO_EMAIL_ACTION, { ...SMS_ACTION, bcc: true }],
    defaultProviders: { email: 'twilio-main' },
  });
  const result = await validateConfig(config, fakeLogger().log);
  assert.deepEqual(errors(result), []);
  assert.deepEqual(warnings(result), ['switches[0].actions[2].bcc: only applies to the email channel and is ignored for sms']);
  assert.equal(result.switches[0].actions[0].bcc, true);
  assert.equal(result.switches[0].actions[1].bcc, undefined);
  assert.equal(result.switches[0].actions[2].bcc, undefined);
  assert.equal(result.config.switches[0].actions[0].bcc, true);
});

test('validation: an email action on a Twilio provider without emailFrom is a blocking error with a field path', async () => {
  const config = platformConfig({ providers: [{ ...TWILIO, emailFrom: undefined }], actions: [TWILIO_EMAIL_ACTION] });
  const result = await validateConfig(config, fakeLogger().log);
  assert.equal(result.config, undefined);
  assert.equal(errors(result).length, 1);
  assert.match(errors(result)[0], /^switches\[0\]\.actions\[0\]\.channel: provider "twilio-main" cannot send email until emailFrom\.address is set/);
});

test('credentialsFile: keys override the secret fields for every provider type', async () => {
  const storagePath = storageDir({
    'twilio.json': { apiKeySecret: 'file-secret', apiKeySid: 'SK11111111111111111111111111111111' },
    'smtp.json': { password: 'file-password' },
    'telegram.json': { botToken: '987654321:BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB' },
  });
  const config = platformConfig({
    providers: [
      { ...TWILIO, apiKeySecret: undefined, credentialsFile: 'twilio.json' },
      { ...SMTP, password: undefined, credentialsFile: 'smtp.json' },
      { ...TELEGRAM, botToken: undefined, credentialsFile: 'telegram.json' },
    ],
    actions: [SMS_ACTION, SMTP_ACTION, TELEGRAM_ACTION],
  });
  const result = await validateConfig(config, fakeLogger().log, { storagePath });
  assert.deepEqual(errors(result), []);
  const [twilio, smtp, telegram] = result.config.providers;
  assert.equal(twilio.apiKeySecret, 'file-secret');
  assert.equal(twilio.apiKeySid, 'SK11111111111111111111111111111111');
  assert.equal(twilio.credentialsFile, 'twilio.json');
  assert.equal(smtp.password, 'file-password');
  assert.equal(smtp.username, SMTP.username, 'fields the file does not set keep their inline value');
  assert.equal(telegram.botToken, '987654321:BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB');
  const notice = result.notices.find((line) => line.startsWith('providers[0].credentialsFile'));
  assert.equal(notice, 'providers[0].credentialsFile: using apiKeySid, apiKeySecret from "twilio.json"', 'keys reported in documented order');
  assert.ok(!result.notices.join('\n').includes('file-secret'), 'secret values never appear in notices');
});

test('credentialsFile: a file value wins over an inline value', async () => {
  const storagePath = storageDir({ 'creds.json': { apiKeySecret: 'from-file' } });
  const config = platformConfig({ providers: [{ ...TWILIO, apiKeySecret: 'inline', credentialsFile: 'creds.json' }], actions: [SMS_ACTION] });
  const result = await validateConfig(config, fakeLogger().log, { storagePath });
  assert.deepEqual(errors(result), []);
  assert.equal(result.config.providers[0].apiKeySecret, 'from-file');
});

test('credentialsFile: a missing file is a blocking error at the field path', async () => {
  const storagePath = storageDir();
  const config = platformConfig({ providers: [{ ...TWILIO, credentialsFile: 'missing.json' }], actions: [SMS_ACTION] });
  const result = await validateConfig(config, fakeLogger().log, { storagePath });
  assert.equal(result.config, undefined);
  assert.equal(errors(result).length, 1);
  assert.match(errors(result)[0], /^providers\[0\]\.credentialsFile: could not read ".*missing\.json": file not found$/);
});

test('credentialsFile: malformed JSON, a non-object, a non-string value and an empty file are blocking errors', async () => {
  const storagePath = storageDir({
    'bad.json': '{ not json',
    'list.json': ['secret'],
    'number.json': { apiKeySecret: 42 },
    'empty.json': {},
  });
  for (const [file, pattern] of [
    ['bad.json', /is not valid JSON$/],
    ['list.json', /must contain a JSON object/],
    ['number.json', /key "apiKeySecret" in ".*number\.json" must be a string$/],
    ['empty.json', /does not set any of accountSid, apiKeySid, apiKeySecret$/],
  ]) {
    const config = platformConfig({ providers: [{ ...TWILIO, credentialsFile: file }], actions: [SMS_ACTION] });
    const result = await validateConfig(config, fakeLogger().log, { storagePath });
    assert.equal(result.config, undefined, file);
    const lines = errors(result);
    assert.equal(lines.length, 1, file);
    assert.match(lines[0], /^providers\[0\]\.credentialsFile: /, file);
    assert.match(lines[0], pattern, file);
  }
});

test('credentialsFile: keys that are not secret fields warn and are ignored', async () => {
  const storagePath = storageDir({ 'creds.json': { password: 'x', apiKeySecret: 'y' } });
  const config = platformConfig({ providers: [{ ...TWILIO, credentialsFile: 'creds.json' }], actions: [SMS_ACTION] });
  const result = await validateConfig(config, fakeLogger().log, { storagePath });
  assert.deepEqual(errors(result), []);
  const fileWarnings = warnings(result).filter((line) => line.includes('credentialsFile'));
  assert.equal(fileWarnings.length, 1);
  assert.match(fileWarnings[0], /^providers\[0\]\.credentialsFile: key "password" in ".*creds\.json" is not a secret field of twilio providers/);
  assert.equal(result.config.providers[0].apiKeySecret, 'y');
});

test('credentialsFile: a relative path without a storage directory is a blocking error, an absolute path works', async () => {
  const storagePath = storageDir({ 'creds.json': { botToken: '111111111:CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC' } });
  const relative = platformConfig({ providers: [{ ...TELEGRAM, credentialsFile: 'creds.json' }], actions: [TELEGRAM_ACTION] });
  const withoutStorage = await validateConfig(relative, fakeLogger().log);
  assert.equal(withoutStorage.config, undefined);
  assert.match(errors(withoutStorage)[0], /^providers\[0\]\.credentialsFile: "creds\.json" is relative but the Homebridge storage directory is unknown/);

  const absolute = platformConfig({ providers: [{ ...TELEGRAM, credentialsFile: `${storagePath}/creds.json` }], actions: [TELEGRAM_ACTION] });
  const result = await validateConfig(absolute, fakeLogger().log);
  assert.deepEqual(errors(result), []);
  assert.equal(result.config.providers[0].botToken, '111111111:CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC');
});

test('credentialsFile: a file that fails to load does not hide the other validation errors', async () => {
  const storagePath = storageDir();
  const config = platformConfig({
    providers: [{ ...TWILIO, credentialsFile: 'missing.json' }],
    actions: [{ ...SMS_ACTION, providerId: 'twillio-main' }],
  });
  const result = await validateConfig(config, fakeLogger().log, { storagePath });
  const lines = errors(result);
  assert.equal(lines.length, 2);
  assert.match(lines[0], /^providers\[0\]\.credentialsFile/);
  assert.match(lines[1], /did you mean "twilio-main"/);
});

test('timeFormat and dateFormat: missing means the defaults, a stored value is carried, an invalid value is an error like defaultCountry', async () => {
  const missing = platformConfig({ providers: [TWILIO], actions: [SMS_ACTION] });
  const defaults = await validateConfig(missing, fakeLogger().log);
  assert.deepEqual(errors(defaults), []);
  assert.equal(defaults.config.timeFormat, '12h');
  assert.equal(defaults.config.dateFormat, 'mdy');

  const stored = { ...platformConfig({ providers: [TWILIO], actions: [SMS_ACTION] }), timeFormat: '24h', dateFormat: 'ymd' };
  const carried = await validateConfig(stored, fakeLogger().log);
  assert.deepEqual(errors(carried), []);
  assert.equal(carried.config.timeFormat, '24h');
  assert.equal(carried.config.dateFormat, 'ymd');

  // An invalid value is a blocking error naming the field, and the rest of the pass runs with the default (SPEC section 5.1).
  const invalid = { ...platformConfig({ providers: [TWILIO], actions: [SMS_ACTION] }), timeFormat: '12', dateFormat: 'DMY' };
  const result = await validateConfig(invalid, fakeLogger().log);
  assert.deepEqual(errors(result), ['platform.timeFormat: must be one of 12h, 24h', 'platform.dateFormat: must be one of mdy, dmy, ymd']);
  assert.equal(result.config, undefined, 'the platform registers nothing, as for an invalid defaultCountry');
  const notStrings = { ...platformConfig({ providers: [TWILIO], actions: [SMS_ACTION] }), timeFormat: 24, dateFormat: null };
  const mixed = await validateConfig(notStrings, fakeLogger().log);
  assert.deepEqual(errors(mixed), ['platform.timeFormat: must be one of 12h, 24h'], 'null reads as missing, a number is an error');
});

test('defaultProviders: a channel with several providers and no default warns and falls back to the first in config order', async () => {
  const family = { id: 'family', name: 'Family', sms: ['+16785550101'], email: ['a@example.com'] };
  const config = platformConfig({ providers: [TWILIO, SMTP], groups: [family], actions: [SMS_ACTION, SMTP_ACTION] });
  const result = await validateConfig(config, fakeLogger().log);
  assert.deepEqual(errors(result), []);
  assert.deepEqual(warnings(result), [
    'platform.defaultProviders.email: 2 providers can send email and none is the default; switches that do not name one use "twilio-main", '
      + 'the first in config order. Choose a default under Settings',
  ]);
  assert.deepEqual(result.config.defaultProviders, {}, 'the fallback is not written into the configuration');

  const chosen = platformConfig({ providers: [TWILIO, SMTP], groups: [family], actions: [SMS_ACTION, SMTP_ACTION], defaultProviders: { email: 'fastmail' } });
  const ok = await validateConfig(chosen, fakeLogger().log);
  assert.deepEqual(warnings(ok), []);
  assert.deepEqual(ok.config.defaultProviders, { email: 'fastmail' });

  // A single provider per channel needs no entry, and one that names it is accepted quietly.
  const single = platformConfig({ providers: [TWILIO], actions: [SMS_ACTION], defaultProviders: { sms: 'twilio-main' } });
  const quiet = await validateConfig(single, fakeLogger().log);
  assert.deepEqual(errors(quiet), []);
  assert.deepEqual(warnings(quiet).filter((line) => line.includes('defaultProviders')), []);
});

test('defaultProviders: an id that does not exist, a provider that cannot serve the channel, or an unknown channel is an error', async () => {
  const missing = platformConfig({ providers: [TWILIO, SMTP], actions: [SMS_ACTION], defaultProviders: { email: 'fastmial' } });
  assert.deepEqual(errors(await validateConfig(missing, fakeLogger().log)),
    ['platform.defaultProviders.email: no provider with id "fastmial" (did you mean "fastmail"?)']);

  const wrongType = platformConfig({ providers: [TWILIO, TELEGRAM], actions: [SMS_ACTION], defaultProviders: { sms: 'telegram-home' } });
  assert.deepEqual(errors(await validateConfig(wrongType, fakeLogger().log)),
    ['platform.defaultProviders.sms: provider "telegram-home" is type telegram, which does not serve the sms channel']);

  const noFrom = platformConfig({ providers: [{ ...TWILIO, emailFrom: undefined }, SMTP], actions: [SMS_ACTION], defaultProviders: { email: 'twilio-main' } });
  assert.deepEqual(errors(await validateConfig(noFrom, fakeLogger().log)),
    ['platform.defaultProviders.email: provider "twilio-main" cannot send email until emailFrom.address is set on it']);

  const unknown = platformConfig({ providers: [TWILIO], actions: [SMS_ACTION], defaultProviders: { fax: 'twilio-main', sms: 42 } });
  assert.deepEqual(errors(await validateConfig(unknown, fakeLogger().log)), [
    'platform.defaultProviders.fax: "fax" is not a channel; use one of sms, email, telegram, ntfy',
    'platform.defaultProviders.sms: must be a provider id',
  ]);

  const notObject = platformConfig({ providers: [TWILIO], actions: [SMS_ACTION], defaultProviders: 'twilio-main' });
  assert.deepEqual(errors(await validateConfig(notObject, fakeLogger().log)),
    ['platform.defaultProviders: must be an object mapping a channel (sms, email, telegram, ntfy) to a provider id']);
});
