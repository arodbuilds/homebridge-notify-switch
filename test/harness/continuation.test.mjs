import assert from 'node:assert/strict';
import { test } from 'node:test';

import { Semaphore, sendEach } from '../../dist/providers/http.js';
import { SmtpProvider } from '../../dist/providers/smtp.js';
import { TelegramProvider } from '../../dist/providers/telegram.js';
import { TwilioProvider } from '../../dist/providers/twilio.js';
import { fakeLogger, fakeTransport, installFetch, SMTP, TELEGRAM, TWILIO } from './helpers.mjs';

/**
 * Per-recipient continuation (SPEC section 6, rule 4): one recipient's failure never stops the
 * others. Each provider sends to three recipients; the second fails at once with a 4xx, and the
 * first and third are still sent and reported ok while the second is reported failed with the code.
 */

const PHONES = ['+16785550101', '+16785550102', '+16785550103'];
const CHATS = ['111', '222', '333'];
const EMAILS = ['a@example.com', 'b@example.com', 'c@example.com'];

test('twilio sms: the second of three recipients fails synchronously with 21211 (invalid To); the first and third are still sent', async () => {
  // The handler is synchronous on purpose: the 4xx comes back as fast as a response can.
  const fetch = installFetch((call, n) => {
    const to = new URLSearchParams(call.body).get('To');
    return to === PHONES[1]
      ? { status: 400, body: JSON.stringify({ code: 21211, message: `The 'To' number ${to} is not a valid phone number.`, status: 400 }) }
      : { status: 201, body: JSON.stringify({ sid: `SM${n}` }) };
  });
  try {
    const results = await new TwilioProvider(TWILIO, fakeLogger().log).send({ channel: 'sms', sender: '+16785550100', recipients: PHONES, body: 'hi' });
    assert.equal(results.length, 3, 'exactly one result per recipient');
    assert.deepEqual(results.map((r) => r.recipient), PHONES, 'results keep the request order');
    assert.equal(results[0].ok, true);
    assert.match(results[0].id, /^SM\d$/);
    assert.deepEqual(results[1], { recipient: PHONES[1], ok: false, error: `Twilio error 21211: The 'To' number ${PHONES[1]} is not a valid phone number.` });
    assert.equal(results[2].ok, true);
    assert.match(results[2].id, /^SM\d$/);
    const sentTo = fetch.calls.map((call) => new URLSearchParams(call.body).get('To')).sort();
    assert.deepEqual(sentTo, [...PHONES].sort(), 'every recipient was attempted exactly once; a 400 is not retried');
  } finally {
    fetch.restore();
  }
});

test('telegram: the second of three chats fails synchronously with 400 (chat not found); the first and third are still sent', async () => {
  const fetch = installFetch((call, n) => {
    const { chat_id: chatId } = JSON.parse(call.body);
    return chatId === CHATS[1]
      ? { status: 400, body: JSON.stringify({ ok: false, error_code: 400, description: 'Bad Request: chat not found' }) }
      : { status: 200, body: JSON.stringify({ ok: true, result: { message_id: n } }) };
  });
  try {
    const results = await new TelegramProvider(TELEGRAM, fakeLogger().log).send({ channel: 'telegram', recipients: CHATS, body: 'hi' });
    assert.equal(results.length, 3);
    assert.deepEqual(results.map((r) => r.recipient), CHATS);
    assert.equal(results[0].ok, true);
    assert.equal(results[1].ok, false);
    assert.equal(results[1].error, 'Telegram error 400: chat id not found or message rejected; check the chat id and parseMode (Bad Request: chat not found)');
    assert.equal(results[2].ok, true);
    assert.deepEqual(fetch.calls.map((call) => JSON.parse(call.body).chat_id).sort(), [...CHATS].sort());
  } finally {
    fetch.restore();
  }
});

test('smtp: the server rejects the second of three recipients with 550; the first and third are still accepted', async () => {
  // One message carries all three in to; the server's per-recipient verdict is what continues past the rejection.
  const transport = fakeTransport([(mail) => Promise.resolve({
    messageId: '<id-3@example.com>',
    accepted: [mail.to[0], mail.to[2]],
    rejected: [mail.to[1]],
    rejectedErrors: [Object.assign(new Error('Recipient command failed'), {
      code: 'EENVELOPE', response: '550 5.1.1 No such user', responseCode: 550, recipient: mail.to[1],
    })],
    envelope: {},
  })]);
  const provider = new SmtpProvider(SMTP, fakeLogger().log, { createTransport: transport.factory });
  const results = await provider.send({ channel: 'email', recipients: EMAILS, subject: 's', body: 'b' });
  assert.deepEqual(results, [
    { recipient: EMAILS[0], ok: true, id: '<id-3@example.com>' },
    { recipient: EMAILS[1], ok: false, error: 'SMTP EENVELOPE: Recipient command failed (550 5.1.1 No such user)' },
    { recipient: EMAILS[2], ok: true, id: '<id-3@example.com>' },
  ]);
  assert.equal(transport.sent.length, 1, 'a per-recipient rejection is not retried');
});

test('runner: a task that throws or rejects fails only its own recipient; the queue keeps going and the semaphore stays usable', async () => {
  const semaphore = new Semaphore(2);
  const started = [];
  const task = async (recipient) => {
    started.push(recipient);
    if (recipient === 'r2') {
      throw new Error('boom for secret-token');
    }
    if (recipient === 'r3') {
      await new Promise((resolve) => setTimeout(resolve, 5));
      return Promise.reject(new Error('late failure'));
    }
    await new Promise((resolve) => setTimeout(resolve, 2));
    return { recipient, ok: true, id: `id-${recipient}` };
  };
  const results = await sendEach(['r1', 'r2', 'r3', 'r4', 'r5'], semaphore, task, { redact: ['secret-token'] });
  assert.deepEqual(results, [
    { recipient: 'r1', ok: true, id: 'id-r1' },
    { recipient: 'r2', ok: false, error: 'boom for [redacted]' },
    { recipient: 'r3', ok: false, error: 'late failure' },
    { recipient: 'r4', ok: true, id: 'id-r4' },
    { recipient: 'r5', ok: true, id: 'id-r5' },
  ]);
  assert.deepEqual([...started].sort(), ['r1', 'r2', 'r3', 'r4', 'r5'], 'every recipient ran despite the failures before it');

  // A synchronous throw from the task function itself (not an async rejection) is also contained.
  const sync = await sendEach(['a', 'b'], semaphore, (recipient) => {
    if (recipient === 'a') {
      throw new TypeError('sync throw');
    }
    return Promise.resolve({ recipient, ok: true });
  });
  assert.deepEqual(sync, [{ recipient: 'a', ok: false, error: 'sync throw' }, { recipient: 'b', ok: true }]);

  // Slots released by failed tasks are reusable: more tasks than the limit still all complete.
  const again = await sendEach(['x', 'y', 'z'], semaphore, async (recipient) => ({ recipient, ok: true }));
  assert.deepEqual(again.map((r) => r.ok), [true, true, true]);
});
