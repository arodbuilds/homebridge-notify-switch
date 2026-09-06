import assert from 'node:assert/strict';
import { test } from 'node:test';

import { TelegramProvider } from '../../dist/providers/telegram.js';
import { fakeLogger, flush, installFetch, settle, TELEGRAM } from './helpers.mjs';

function provider(overrides = {}) {
  return new TelegramProvider({ ...TELEGRAM, ...overrides }, fakeLogger().log);
}

const ok = (messageId) => ({ status: 200, body: JSON.stringify({ ok: true, result: { message_id: messageId } }) });
const fail = (code, description) => ({ status: code, body: JSON.stringify({ ok: false, error_code: code, description }) });

test('telegram: one sendMessage per chat id, message_id returned as id, plain text has no parse_mode', async () => {
  const fetch = installFetch((call, n) => ok(100 + n));
  try {
    const results = await provider().send({ channel: 'telegram', recipients: ['123456789', '-1001234567890'], body: 'Leak!' });
    assert.deepEqual(results, [
      { recipient: '123456789', ok: true, id: '101' },
      { recipient: '-1001234567890', ok: true, id: '102' },
    ]);
    assert.equal(fetch.calls.length, 2);
    assert.equal(fetch.calls[0].url, `https://api.telegram.org/bot${TELEGRAM.botToken}/sendMessage`);
    assert.deepEqual(JSON.parse(fetch.calls[0].body), { chat_id: '123456789', text: 'Leak!' });
    assert.deepEqual(JSON.parse(fetch.calls[1].body), { chat_id: '-1001234567890', text: 'Leak!' });
  } finally {
    fetch.restore();
  }
});

test('telegram: parseMode markdown and html map to parse_mode', async () => {
  const fetch = installFetch(() => ok(1));
  try {
    await provider({ parseMode: 'markdown' }).send({ channel: 'telegram', recipients: ['1'], body: '*bold*' });
    await provider({ parseMode: 'html' }).send({ channel: 'telegram', recipients: ['1'], body: '<b>bold</b>' });
    assert.equal(JSON.parse(fetch.calls[0].body).parse_mode, 'Markdown');
    assert.equal(JSON.parse(fetch.calls[1].body).parse_mode, 'HTML');
  } finally {
    fetch.restore();
  }
});

test('telegram: 403 and 400 become readable per-recipient failures while other chats succeed', async () => {
  const fetch = installFetch((call) => {
    const { chat_id: chatId } = JSON.parse(call.body);
    if (chatId === '2') {
      return fail(403, 'Forbidden: bot was blocked by the user');
    }
    if (chatId === '3') {
      return fail(400, 'Bad Request: chat not found');
    }
    return ok(7);
  });
  try {
    const results = await provider().send({ channel: 'telegram', recipients: ['1', '2', '3'], body: 'hi' });
    assert.deepEqual(results[0], { recipient: '1', ok: true, id: '7' });
    assert.equal(results[1].ok, false);
    assert.match(results[1].error, /^Telegram error 403: the bot is blocked .*bot was blocked by the user/);
    assert.equal(results[2].ok, false);
    assert.match(results[2].error, /^Telegram error 400: chat id not found .*chat not found/);
    assert.equal(fetch.calls.length, 3, '4xx responses are not retried');
  } finally {
    fetch.restore();
  }
});

test('telegram: 429 waits for parameters.retry_after once, then succeeds', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const fetch = installFetch((call, n) => n === 1
    ? { status: 429, body: JSON.stringify({ ok: false, error_code: 429, description: 'Too Many Requests: retry after 7', parameters: { retry_after: 7 } }) }
    : ok(42));
  try {
    const pending = provider().send({ channel: 'telegram', recipients: ['123456789'], body: 'hi' });
    await flush();
    assert.equal(fetch.calls.length, 1);
    t.mock.timers.tick(6000);
    await flush();
    assert.equal(fetch.calls.length, 1, 'retry waits for retry_after (7s), not the default 2s backoff');
    t.mock.timers.tick(1000);
    await flush();
    assert.equal(fetch.calls.length, 2);
    assert.deepEqual(await pending, [{ recipient: '123456789', ok: true, id: '42' }]);
  } finally {
    fetch.restore();
  }
});

test('telegram: a second 429 is reported as a failure', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const fetch = installFetch(() => ({
    status: 429,
    body: JSON.stringify({ ok: false, error_code: 429, description: 'Too Many Requests', parameters: { retry_after: 1 } }),
  }));
  try {
    const results = await settle(t, provider().send({ channel: 'telegram', recipients: ['1'], body: 'hi' }));
    assert.equal(results[0].ok, false);
    assert.equal(results[0].error, 'Telegram error 429: Too Many Requests');
    assert.equal(fetch.calls.length, 2);
  } finally {
    fetch.restore();
  }
});

test('telegram: timeout is retried once and reported', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const fetch = installFetch(() => 'hang');
  try {
    const results = await settle(t, provider().send({ channel: 'telegram', recipients: ['1'], body: 'hi' }));
    assert.equal(results[0].ok, false);
    assert.equal(results[0].error, 'request timed out after 10s');
    assert.equal(fetch.calls.length, 2);
  } finally {
    fetch.restore();
  }
});

test('telegram: the bot token never appears in an error, even when the failure quotes the URL', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const fetch = installFetch((call) => new Error(`getaddrinfo ENOTFOUND for ${call.url}`));
  try {
    const results = await settle(t, provider().send({ channel: 'telegram', recipients: ['1'], body: 'hi' }));
    assert.equal(results[0].ok, false);
    assert.ok(!results[0].error.includes(TELEGRAM.botToken), results[0].error);
    assert.match(results[0].error, /\[redacted\]/);
  } finally {
    fetch.restore();
  }
});

test('telegram: at most 5 requests in flight per provider', async () => {
  let inFlight = 0;
  let peak = 0;
  const fetch = installFetch(async () => {
    inFlight += 1;
    peak = Math.max(peak, inFlight);
    await new Promise((resolve) => setTimeout(resolve, 5));
    inFlight -= 1;
    return ok(1);
  });
  try {
    const recipients = Array.from({ length: 12 }, (_, i) => String(1000 + i));
    const results = await provider().send({ channel: 'telegram', recipients, body: 'hi' });
    assert.equal(results.filter((r) => r.ok).length, 12);
    assert.equal(peak, 5);
  } finally {
    fetch.restore();
  }
});
