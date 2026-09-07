import assert from 'node:assert/strict';
import { test } from 'node:test';

import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { SmtpProvider } from '../../dist/providers/smtp.js';
import { findChats, lookupTwilio, pluginVersion, telegramBot, testProvider, testSend } from '../../dist/ui/handlers.js';
import { fakeLogger, installFetch, platformConfig, SMTP, storageDir, TELEGRAM, TWILIO } from './helpers.mjs';

/**
 * Settings UI server handlers (SPEC section 11.2 items 3 to 5, section 12 item 5): each endpoint
 * uses the submitted credentials in memory, contacts only the configured host, and never echoes a
 * credential in its response.
 */

const SECRETS = [TWILIO.apiKeySecret, TWILIO.apiKeySid, SMTP.password, TELEGRAM.botToken];

function assertNoSecrets(value) {
  const text = JSON.stringify(value);
  for (const secret of SECRETS) {
    assert.ok(!text.includes(secret), `response leaks a credential: ${text}`);
  }
}

test('test-provider twilio: lists one message on the submitted Account SID with Basic auth of apiKeySid:apiKeySecret', async () => {
  const fetch = installFetch(() => ({ status: 200, body: JSON.stringify({ messages: [], page_size: 1 }) }));
  // Values exactly as the form submits them. The secret carries characters that matter in base64 and URLs so
  // any encoding, escaping or redaction on the way to the header would show up.
  const form = {
    ...TWILIO,
    accountSid: 'ACaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    apiKeySid: 'SKbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    apiKeySecret: 'p4ss/w0rd+with=odd:chars%20',
  };
  try {
    const result = await testProvider(form);
    assert.deepEqual(result, { ok: true, message: 'Connected to Twilio. The API key can access messages on this account.' });
    assert.equal(fetch.calls.length, 1);
    const call = fetch.calls[0];
    assert.equal(call.url, 'https://api.twilio.com/2010-04-01/Accounts/ACaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/Messages.json?PageSize=1');
    assert.equal(call.init.method, 'GET');
    assert.equal(call.body, '', 'a connection test sends nothing');
    const expectedAuth = 'Basic ' + Buffer.from(`${form.apiKeySid}:${form.apiKeySecret}`, 'utf8').toString('base64');
    assert.equal(call.headers.Authorization, expectedAuth);
    assert.equal(call.headers.Authorization, 'Basic U0tiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYjpwNHNzL3cwcmQrd2l0aD1vZGQ6Y2hhcnMlMjA=');
    assert.notEqual(call.headers.Authorization, 'Basic ' + Buffer.from(`${form.accountSid}:${form.apiKeySecret}`, 'utf8').toString('base64'),
      'the Account SID is never the Basic auth username');
    assert.equal(call.headers['Content-Type'], undefined, 'no content type on a bodiless GET');
    assertNoSecrets(result);
    assert.ok(!JSON.stringify(result).includes(form.apiKeySecret));
  } finally {
    fetch.restore();
  }
});

test('test-provider twilio: pasted values are trimmed before the URL and header are built', async () => {
  const fetch = installFetch(() => ({ status: 200, body: JSON.stringify({ messages: [] }) }));
  try {
    const padded = { ...TWILIO, accountSid: ` ${TWILIO.accountSid}\n`, apiKeySid: `${TWILIO.apiKeySid} `, apiKeySecret: `\t${TWILIO.apiKeySecret}\n` };
    const result = await testProvider(padded);
    assert.equal(result.ok, true);
    assert.equal(fetch.calls[0].url, `https://api.twilio.com/2010-04-01/Accounts/${TWILIO.accountSid}/Messages.json?PageSize=1`);
    assert.equal(fetch.calls[0].headers.Authorization, 'Basic ' + Buffer.from(`${TWILIO.apiKeySid}:${TWILIO.apiKeySecret}`, 'utf8').toString('base64'));
  } finally {
    fetch.restore();
  }
});

test('test-provider twilio: 401, 403 and 404 carry Twilio\'s code and message, and a network error is sanitized', async () => {
  let fetch = installFetch(() => ({ status: 401, body: JSON.stringify({ code: 20003, message: 'Authenticate', status: 401 }) }));
  try {
    const result = await testProvider(TWILIO);
    assert.deepEqual(result, { ok: false, message: 'Twilio rejected the API key (Twilio error 20003: Authenticate). Check the API Key SID and Secret.' });
    assert.equal(fetch.calls.length, 1, 'a 401 is not retried');
  } finally {
    fetch.restore();
  }
  fetch = installFetch(() => ({ status: 401, body: '' }));
  try {
    const result = await testProvider(TWILIO);
    assert.deepEqual(result, { ok: false, message: 'Twilio rejected the API key. Check the API Key SID and Secret.' });
  } finally {
    fetch.restore();
  }
  fetch = installFetch(() => ({ status: 403, body: JSON.stringify({ code: 20003, message: 'Permission Denied', status: 403 }) }));
  try {
    const result = await testProvider(TWILIO);
    assert.equal(result.ok, false);
    assert.equal(result.message,
      'Twilio refused this API key access to messages (Twilio error 20003: Permission Denied). A Restricted key needs Messaging permissions on this account.');
  } finally {
    fetch.restore();
  }
  fetch = installFetch(() => ({ status: 404, body: JSON.stringify({ code: 20404, message: 'The requested resource was not found', status: 404 }) }));
  try {
    const result = await testProvider(TWILIO);
    assert.equal(result.ok, false);
    assert.match(result.message, /could not find that Account SID/);
    assert.match(result.message, /Twilio error 20404: The requested resource was not found/);
  } finally {
    fetch.restore();
  }
  fetch = installFetch(() => new Error(`getaddrinfo ENOTFOUND ${TWILIO.apiKeySecret}`));
  try {
    const result = await testProvider(TWILIO);
    assert.equal(result.ok, false);
    assertNoSecrets(result);
  } finally {
    fetch.restore();
  }
});

test('test-provider: invalid fields are reported before anything is contacted, and nothing else is echoed', async () => {
  const fetch = installFetch(() => ({ status: 200 }));
  try {
    const result = await testProvider({ ...TWILIO, accountSid: 'nope', apiKeySecret: 'the-secret-value' });
    assert.equal(result.ok, false);
    assert.match(result.message, /Fix these fields first: provider\.accountSid/);
    assert.ok(!result.message.includes('the-secret-value'));
    assert.equal(fetch.calls.length, 0);

    const missing = await testProvider(undefined);
    assert.equal(missing.ok, false);
    assert.equal(fetch.calls.length, 0);
  } finally {
    fetch.restore();
  }
});

test('test-provider telegram: getMe reports the bot username and the token never appears in errors', async () => {
  let fetch = installFetch(() => ({ status: 200, body: JSON.stringify({ ok: true, result: { username: 'home_alerts_bot', first_name: 'Home' } }) }));
  try {
    const result = await testProvider(TELEGRAM);
    assert.deepEqual(result, { ok: true, message: 'Connected to Telegram as @home_alerts_bot.' });
    assert.equal(fetch.calls[0].url, `https://api.telegram.org/bot${TELEGRAM.botToken}/getMe`);
  } finally {
    fetch.restore();
  }
  fetch = installFetch(() => ({ status: 401, body: JSON.stringify({ ok: false, error_code: 401, description: `Unauthorized ${TELEGRAM.botToken}` }) }));
  try {
    const result = await testProvider(TELEGRAM);
    assert.equal(result.ok, false);
    assert.match(result.message, /rejected the bot token/);
    assertNoSecrets(result);
  } finally {
    fetch.restore();
  }
});

test('find-chats: getUpdates is reduced to distinct chats with readable titles, and a group appears from my_chat_member alone', async () => {
  const updates = [
    { update_id: 1, message: { chat: { id: 123456789, type: 'private', first_name: 'Alex', last_name: 'R', username: 'alexr' } } },
    { update_id: 2, message: { chat: { id: 123456789, type: 'private', first_name: 'Alex' } } },
    { update_id: 3, my_chat_member: { chat: { id: -1001234567890, type: 'supergroup', title: 'Family' } } },
    { update_id: 4, channel_post: { chat: { id: -1009876543210, type: 'channel', title: 'Alerts' } } },
    { update_id: 5, edited_message: { text: 'no chat here' } },
  ];
  const fetch = installFetch(() => ({ status: 200, body: JSON.stringify({ ok: true, result: updates }) }));
  try {
    const result = await findChats(TELEGRAM);
    assert.equal(result.ok, true);
    assert.equal(result.message, 'Found 3 chats.');
    assert.deepEqual(result.chats, [
      { id: '123456789', title: 'Alex (@alexr)', type: 'private' },
      { id: '-1001234567890', title: 'Family', type: 'supergroup' },
      { id: '-1009876543210', title: 'Alerts', type: 'channel' },
    ]);
    assert.equal(fetch.calls[0].url, `https://api.telegram.org/bot${TELEGRAM.botToken}/getUpdates`);
    assert.ok(JSON.parse(fetch.calls[0].body).allowed_updates.includes('my_chat_member'), 'my_chat_member updates are requested');
    assertNoSecrets(result);
  } finally {
    fetch.restore();
  }
  // A freshly added group has only a my_chat_member update, no message yet.
  const added = installFetch(() => ({ status: 200, body: JSON.stringify({ ok: true, result: [
    { update_id: 9, my_chat_member: { chat: { id: -4001234567, type: 'group', title: 'Home Alerts' }, new_chat_member: { status: 'member' } } },
  ] }) }));
  try {
    const result = await findChats(TELEGRAM);
    assert.deepEqual(result.chats, [{ id: '-4001234567', title: 'Home Alerts', type: 'group' }]);
  } finally {
    added.restore();
  }
});

test('telegram-bot: getMe reports "Connected to @username" for the onboarding flow and rejects an unusable username', async () => {
  let fetch = installFetch(() => ({ status: 200, body: JSON.stringify({ ok: true, result: { username: 'home_alerts_bot', first_name: 'Home' } }) }));
  try {
    const result = await telegramBot(TELEGRAM);
    assert.deepEqual(result, { ok: true, message: 'Connected to @home_alerts_bot', username: 'home_alerts_bot' });
    assert.equal(fetch.calls[0].url, `https://api.telegram.org/bot${TELEGRAM.botToken}/getMe`);
    assertNoSecrets(result);
  } finally {
    fetch.restore();
  }
  fetch = installFetch(() => ({ status: 200, body: JSON.stringify({ ok: true, result: { username: 'bad name/../x' } }) }));
  try {
    const result = await telegramBot(TELEGRAM);
    assert.equal(result.ok, false);
    assert.equal(result.username, undefined);
  } finally {
    fetch.restore();
  }
  fetch = installFetch(() => ({ status: 401, body: JSON.stringify({ ok: false, error_code: 401, description: 'Unauthorized' }) }));
  try {
    const result = await telegramBot(TELEGRAM);
    assert.equal(result.ok, false);
    assert.match(result.message, /rejected the bot token/);
    assertNoSecrets(result);
  } finally {
    fetch.restore();
  }
  const other = installFetch(() => ({ status: 200 }));
  try {
    const result = await telegramBot(TWILIO);
    assert.equal(result.ok, false);
    assert.match(result.message, /Telegram providers only/);
    assert.equal(other.calls.length, 0);
  } finally {
    other.restore();
  }
});

const NUMBERS_URL = `https://api.twilio.com/2010-04-01/Accounts/${TWILIO.accountSid}/IncomingPhoneNumbers.json?PageSize=20`;
const SERVICES_URL = 'https://messaging.twilio.com/v1/Services?PageSize=20';

function numbersBody(count, nextPage = null) {
  return JSON.stringify({
    incoming_phone_numbers: Array.from({ length: count }, (_, i) => ({
      sid: `PN${String(i).padStart(32, '0')}`, phone_number: `+1678555${String(100 + i).padStart(4, '0')}`, friendly_name: `Line ${i + 1}`,
    })),
    page_size: 20, next_page_uri: nextPage,
  });
}

function servicesBody(count, nextPage = null) {
  return JSON.stringify({
    services: Array.from({ length: count }, (_, i) => ({ sid: `MG${String(i).padStart(32, '0')}`, friendly_name: `Service ${i + 1}` })),
    meta: { page_size: 20, next_page_url: nextPage },
  });
}

test('twilio-lookup: lists numbers and Messaging Services with the same Basic auth, one page of 20 each', async () => {
  const fetch = installFetch((call) => {
    if (call.url === NUMBERS_URL) {
      return { status: 200, body: numbersBody(2) };
    }
    if (call.url === SERVICES_URL) {
      return { status: 200, body: servicesBody(1) };
    }
    return { status: 404, body: '' };
  });
  try {
    const result = await lookupTwilio(TWILIO);
    assert.deepEqual(result, {
      ok: true,
      message: 'Found 2 phone numbers and 1 Messaging Service.',
      numbers: [
        { phoneNumber: '+16785550100', friendlyName: 'Line 1' },
        { phoneNumber: '+16785550101', friendlyName: 'Line 2' },
      ],
      services: [{ sid: 'MG00000000000000000000000000000000', friendlyName: 'Service 1' }],
      truncated: false,
    });
    assert.deepEqual(fetch.calls.map((call) => call.url).sort(), [NUMBERS_URL, SERVICES_URL]);
    const expectedAuth = 'Basic ' + Buffer.from(`${TWILIO.apiKeySid}:${TWILIO.apiKeySecret}`, 'utf8').toString('base64');
    for (const call of fetch.calls) {
      assert.equal(call.init.method, 'GET');
      assert.equal(call.headers.Authorization, expectedAuth);
      assert.equal(call.body, '', 'a lookup sends nothing');
    }
    assertNoSecrets(result);
  } finally {
    fetch.restore();
  }
});

test('twilio-lookup: a page that reports more entries adds the "first 20" note', async () => {
  const fetch = installFetch((call) => {
    if (call.url === NUMBERS_URL) {
      return { status: 200, body: numbersBody(20, `/2010-04-01/Accounts/${TWILIO.accountSid}/IncomingPhoneNumbers.json?PageSize=20&Page=1`) };
    }
    return { status: 200, body: servicesBody(0) };
  });
  try {
    const result = await lookupTwilio(TWILIO);
    assert.equal(result.ok, true);
    assert.equal(result.truncated, true);
    assert.equal(result.numbers.length, 20);
    assert.equal(result.message, 'Found 20 phone numbers and 0 Messaging Services. Showing the first 20; enter others manually.');
  } finally {
    fetch.restore();
  }
  const services = installFetch((call) => {
    if (call.url === NUMBERS_URL) {
      return { status: 200, body: numbersBody(1) };
    }
    return { status: 200, body: servicesBody(20, 'https://messaging.twilio.com/v1/Services?PageSize=20&PageToken=x') };
  });
  try {
    const result = await lookupTwilio(TWILIO);
    assert.equal(result.truncated, true);
    assert.match(result.message, /Showing the first 20; enter others manually\.$/);
  } finally {
    services.restore();
  }
});

test('twilio-lookup: a key without permission (401 or 403) gets the manual entry message, and other failures are described', async () => {
  for (const status of [401, 403]) {
    const fetch = installFetch(() => ({ status, body: JSON.stringify({ code: 20003, message: 'Permission Denied', status }) }));
    try {
      const result = await lookupTwilio(TWILIO);
      assert.deepEqual(result, { ok: false, message: 'This API key cannot list numbers. Enter them manually.', numbers: [], services: [], truncated: false });
      assert.equal(fetch.calls.length, 2, `${status} is not retried`);
      assertNoSecrets(result);
    } finally {
      fetch.restore();
    }
  }
  // Numbers denied but services readable: the services still come back with the manual entry message.
  const partial = installFetch((call) => (call.url === NUMBERS_URL
    ? { status: 403, body: JSON.stringify({ code: 20003, message: 'Permission Denied', status: 403 }) }
    : { status: 200, body: servicesBody(1) }));
  try {
    const result = await lookupTwilio(TWILIO);
    assert.equal(result.ok, true);
    assert.equal(result.message, 'This API key cannot list numbers. Enter them manually.');
    assert.deepEqual(result.numbers, []);
    assert.equal(result.services.length, 1);
  } finally {
    partial.restore();
  }
  const broken = installFetch(() => ({ status: 500, body: JSON.stringify({ code: 20500, message: 'Internal Server Error', status: 500 }) }));
  try {
    const result = await lookupTwilio(TWILIO);
    assert.equal(result.ok, false);
    assert.match(result.message, /Twilio error 20500/);
  } finally {
    broken.restore();
  }
  const invalid = installFetch(() => ({ status: 200 }));
  try {
    const result = await lookupTwilio({ ...TWILIO, apiKeySid: 'nope' });
    assert.equal(result.ok, false);
    assert.match(result.message, /Fix these fields first/);
    assert.equal(invalid.calls.length, 0);
    const other = await lookupTwilio(TELEGRAM);
    assert.match(other.message, /Twilio providers only/);
  } finally {
    invalid.restore();
  }
});

test('find-chats: no updates gives guidance, a webhook conflict is explained, non-telegram providers are refused', async () => {
  let fetch = installFetch(() => ({ status: 200, body: JSON.stringify({ ok: true, result: [] }) }));
  try {
    const result = await findChats(TELEGRAM);
    assert.equal(result.ok, true);
    assert.deepEqual(result.chats, []);
    assert.match(result.message, /No people or groups found yet/);
  } finally {
    fetch.restore();
  }
  fetch = installFetch(() => ({ status: 409, body: JSON.stringify({ ok: false, error_code: 409, description: 'Conflict: webhook is active' }) }));
  try {
    const result = await findChats(TELEGRAM);
    assert.equal(result.ok, false);
    assert.match(result.message, /webhook/);
  } finally {
    fetch.restore();
  }
  fetch = installFetch(() => ({ status: 200 }));
  try {
    const result = await findChats(TWILIO);
    assert.equal(result.ok, false);
    assert.match(result.message, /Telegram providers only/);
    assert.equal(fetch.calls.length, 0);
  } finally {
    fetch.restore();
  }
});

test('smtp verify: connects with the configured transport options and scrubs the login from errors', async () => {
  const seen = [];
  const factory = (options) => {
    seen.push(options);
    return {
      verify: async () => true,
      sendMail: async () => ({}),
      close: () => undefined,
    };
  };
  const ok = await new SmtpProvider(SMTP, fakeLogger().log, { createTransport: factory }).testConnection();
  assert.deepEqual(ok, { ok: true, message: 'Connected to smtp.fastmail.com:465 and logged in as alex@example.com.' });
  assert.equal(seen[0].host, 'smtp.fastmail.com');
  assert.equal(seen[0].secure, true);
  assert.equal(seen[0].auth.pass, SMTP.password);

  const failing = () => ({
    verify: async () => {
      const err = new Error(`Invalid login: 535 5.7.8 Authentication failed for ${SMTP.password}`);
      err.code = 'EAUTH';
      err.response = '535 5.7.8 Authentication failed';
      throw err;
    },
    sendMail: async () => ({}),
  });
  const bad = await new SmtpProvider(SMTP, fakeLogger().log, { createTransport: failing }).testConnection();
  assert.equal(bad.ok, false);
  assert.match(bad.message, /^SMTP EAUTH: Invalid login/);
  assertNoSecrets(bad);
});

test('test-provider smtp: the real nodemailer transport is used and a connection failure is sanitized', async () => {
  // Port 9 on localhost is closed, so nodemailer fails to connect; no network beyond the loopback is touched.
  const result = await testProvider({ ...SMTP, host: '127.0.0.1', port: 9, security: 'none' });
  assert.equal(result.ok, false);
  assert.match(result.message, /^SMTP/);
  assertNoSecrets(result);
});

test('test-send: validates like startup, sends every action of the chosen switch and reports per recipient', async () => {
  const fetch = installFetch((call) => {
    if (call.url.includes('/Messages.json')) {
      const to = new URLSearchParams(call.body).get('To');
      return to === '+16785550102'
        ? { status: 400, body: JSON.stringify({ code: 21211, message: 'Invalid To phone number' }) }
        : { status: 201, body: JSON.stringify({ sid: 'SM1' }) };
    }
    return { status: 200, body: JSON.stringify({ ok: true, result: { message_id: 42 } }) };
  });
  try {
    const config = platformConfig({
      providers: [TWILIO, TELEGRAM],
      groups: [{ id: 'family', name: 'Family', sms: ['+16785550101', '+16785550102'], telegram: ['123456789'] }],
      actions: [
        { providerId: 'twilio-main', channel: 'sms', groups: ['family'], body: 'Leak at {{time}}' },
        { providerId: 'telegram-home', channel: 'telegram', groups: ['family'], body: 'Leak' },
      ],
    });
    const result = await testSend(config, '6f1c2a9e-2b1c-4b8f-9d1e-0c5a1e2f3a4b');
    assert.equal(result.ok, false);
    assert.equal(result.message, '2 of 3 messages sent, 1 failed.');
    assert.equal(result.actions.length, 2);
    assert.deepEqual(result.actions[0].results, [
      { recipient: '+16785550101', ok: true, id: 'SM1' },
      { recipient: '+16785550102', ok: false, error: 'Twilio error 21211: Invalid To phone number' },
    ]);
    assert.deepEqual(result.actions[1], {
      index: 1, providerId: 'telegram-home', channel: 'telegram', results: [{ recipient: '123456789', ok: true, id: '42' }],
    });
    const smsBody = new URLSearchParams(fetch.calls.find((c) => c.url.includes('/Messages.json')).body).get('Body');
    assert.match(smsBody, /^Leak at \d\d:\d\d$/, 'template variables are rendered');
    assertNoSecrets(result);
  } finally {
    fetch.restore();
  }
});

test('test-send: configuration errors block the send and are reported with field paths', async () => {
  const fetch = installFetch(() => ({ status: 201 }));
  try {
    const config = platformConfig({ providers: [TWILIO], actions: [{ providerId: 'twillio-main', channel: 'sms', groups: ['family'], body: 'x' }] });
    const result = await testSend(config, '6f1c2a9e-2b1c-4b8f-9d1e-0c5a1e2f3a4b');
    assert.equal(result.ok, false);
    assert.ok(result.errors.some((e) => e.startsWith('switches[0].actions[0].providerId: no provider with id "twillio-main"')));
    assert.equal(fetch.calls.length, 0);

    const valid = platformConfig({ providers: [TWILIO], actions: [{ providerId: 'twilio-main', channel: 'sms', groups: ['family'], body: 'x' }] });
    const unknown = await testSend(valid, 'nope');
    assert.equal(unknown.ok, false);
    assert.match(unknown.message, /not in the current configuration/);
    assert.equal(fetch.calls.length, 0);
  } finally {
    fetch.restore();
  }
});

test('test-provider: credentialsFile is applied from the storage directory, just like startup', async () => {
  const dir = storageDir({ 'telegram.json': { botToken: TELEGRAM.botToken } });
  const fetch = installFetch(() => ({ status: 200, body: JSON.stringify({ ok: true, result: { username: 'bot' } }) }));
  try {
    const result = await testProvider({ id: 'tg', type: 'telegram', name: 'TG', credentialsFile: 'telegram.json' }, { storagePath: dir });
    assert.equal(result.ok, true);
    assert.equal(fetch.calls[0].url, `https://api.telegram.org/bot${TELEGRAM.botToken}/getMe`);
  } finally {
    fetch.restore();
  }
});

test('version: the footer endpoint reports the installed package version from package.json', () => {
  const pkg = JSON.parse(readFileSync(join(resolve(import.meta.dirname, '..', '..'), 'package.json'), 'utf8'));
  assert.deepEqual(pluginVersion(), { ok: true, message: '', version: pkg.version });
  assert.match(pkg.version, /^\d+\.\d+\.\d+/);
});
