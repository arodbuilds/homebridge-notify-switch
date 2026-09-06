import assert from 'node:assert/strict';
import { test } from 'node:test';

import { SmtpProvider } from '../../dist/providers/smtp.js';
import { findChats, testProvider, testSend } from '../../dist/ui/handlers.js';
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

test('find-chats: getUpdates is reduced to distinct chats with readable titles', async () => {
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
      { id: '123456789', title: 'Alex R @alexr', type: 'private' },
      { id: '-1001234567890', title: 'Family', type: 'supergroup' },
      { id: '-1009876543210', title: 'Alerts', type: 'channel' },
    ]);
    assert.equal(fetch.calls[0].url, `https://api.telegram.org/bot${TELEGRAM.botToken}/getUpdates`);
    assertNoSecrets(result);
  } finally {
    fetch.restore();
  }
});

test('find-chats: no updates gives guidance, a webhook conflict is explained, non-telegram providers are refused', async () => {
  let fetch = installFetch(() => ({ status: 200, body: JSON.stringify({ ok: true, result: [] }) }));
  try {
    const result = await findChats(TELEGRAM);
    assert.equal(result.ok, true);
    assert.deepEqual(result.chats, []);
    assert.match(result.message, /No chats found/);
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
