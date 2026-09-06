import assert from 'node:assert/strict';
import { test } from 'node:test';

import { TwilioProvider } from '../../dist/providers/twilio.js';
import { fakeLogger, flush, installFetch, settle, TWILIO } from './helpers.mjs';

const EXPECTED_AUTH = 'Basic ' + Buffer.from(`${TWILIO.apiKeySid}:${TWILIO.apiKeySecret}`).toString('base64');

function provider(overrides = {}) {
  return new TwilioProvider({ ...TWILIO, ...overrides }, fakeLogger().log);
}

test('twilio sms: one request per recipient, sid returned as id', async () => {
  const fetch = installFetch((call, n) => ({ status: 201, body: JSON.stringify({ sid: `SM${n}` }) }));
  try {
    const results = await provider().send({ channel: 'sms', sender: '+16785550100', recipients: ['+16785550101', '+16785550102'], body: 'hi' });
    assert.deepEqual(results, [
      { recipient: '+16785550101', ok: true, id: 'SM1' },
      { recipient: '+16785550102', ok: true, id: 'SM2' },
    ]);
    assert.equal(fetch.calls.length, 2);
    assert.equal(fetch.calls[0].url, `https://api.twilio.com/2010-04-01/Accounts/${TWILIO.accountSid}/Messages.json`);
    assert.equal(fetch.calls[0].headers.Authorization, EXPECTED_AUTH);
    const form = new URLSearchParams(fetch.calls[0].body);
    assert.equal(form.get('To'), '+16785550101');
    assert.equal(form.get('From'), '+16785550100');
    assert.equal(form.get('Body'), 'hi');
  } finally {
    fetch.restore();
  }
});

test('twilio sms: per-recipient failure carries the Twilio code and message', async () => {
  const fetch = installFetch((call) => {
    const to = new URLSearchParams(call.body).get('To');
    return to === '+16785550102'
      ? { status: 400, body: JSON.stringify({ code: 21211, message: 'Invalid To phone number', status: 400 }) }
      : { status: 201, body: JSON.stringify({ sid: 'SM1' }) };
  });
  try {
    const results = await provider().send({ channel: 'sms', sender: '+16785550100', recipients: ['+16785550101', '+16785550102'], body: 'hi' });
    assert.deepEqual(results[0], { recipient: '+16785550101', ok: true, id: 'SM1' });
    assert.equal(results[1].ok, false);
    assert.equal(results[1].error, 'Twilio error 21211: Invalid To phone number');
    assert.equal(fetch.calls.length, 2, 'a 400 is not retried');
  } finally {
    fetch.restore();
  }
});

test('twilio email: one request for every recipient, operationId returned as id for each', async () => {
  const fetch = installFetch(() => ({ status: 202, body: JSON.stringify({ operationId: 'op-123' }) }));
  try {
    const results = await provider().send({
      channel: 'email',
      recipients: ['a@example.com', 'b@example.com'],
      subject: 'Water\r\nleak',
      body: 'Water detected.',
    });
    assert.deepEqual(results, [
      { recipient: 'a@example.com', ok: true, id: 'op-123' },
      { recipient: 'b@example.com', ok: true, id: 'op-123' },
    ]);
    assert.equal(fetch.calls.length, 1);
    assert.equal(fetch.calls[0].url, 'https://comms.twilio.com/v1/Emails');
    assert.equal(fetch.calls[0].headers.Authorization, EXPECTED_AUTH);
    assert.equal(fetch.calls[0].headers['Content-Type'], 'application/json');
    assert.deepEqual(JSON.parse(fetch.calls[0].body), {
      from: { email: 'alerts@example.com', name: 'Home' },
      to: [{ email: 'a@example.com' }, { email: 'b@example.com' }],
      content: { subject: 'Water leak', text: 'Water detected.' },
    });
  } finally {
    fetch.restore();
  }
});

test('twilio email: a rejected request fails every recipient with the Twilio error', async () => {
  const fetch = installFetch(() => ({ status: 400, body: JSON.stringify({ code: 20001, message: 'Invalid from address' }) }));
  try {
    const results = await provider().send({ channel: 'email', recipients: ['a@example.com', 'b@example.com'], subject: 's', body: 'b' });
    assert.equal(results.length, 2);
    for (const result of results) {
      assert.equal(result.ok, false);
      assert.equal(result.error, 'Twilio error 20001: Invalid from address');
    }
    assert.equal(fetch.calls.length, 1);
  } finally {
    fetch.restore();
  }
});

test('twilio email: send without emailFrom fails cleanly instead of throwing', async () => {
  const fetch = installFetch(() => ({ status: 202, body: '{}' }));
  try {
    const results = await provider({ emailFrom: undefined }).send({ channel: 'email', recipients: ['a@example.com'], subject: 's', body: 'b' });
    assert.equal(results[0].ok, false);
    assert.match(results[0].error, /emailFrom/);
    assert.equal(fetch.calls.length, 0);
  } finally {
    fetch.restore();
  }
});

test('twilio: timeout aborts after 10s, retries once after 2s, then reports the timeout', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const fetch = installFetch(() => 'hang');
  try {
    const results = await settle(t, provider().send({ channel: 'email', recipients: ['a@example.com'], subject: 's', body: 'b' }));
    assert.equal(results[0].ok, false);
    assert.equal(results[0].error, 'request timed out after 10s');
    assert.equal(fetch.calls.length, 2);
  } finally {
    fetch.restore();
  }
});

test('twilio: 429 honors Retry-After once, then succeeds', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const fetch = installFetch((call, n) => n === 1
    ? { status: 429, headers: { 'Retry-After': '5' }, body: JSON.stringify({ code: 20429, message: 'Too Many Requests' }) }
    : { status: 201, body: JSON.stringify({ sid: 'SM9' }) });
  try {
    const pending = provider().send({ channel: 'sms', sender: '+16785550100', recipients: ['+16785550101'], body: 'hi' });
    await flush();
    assert.equal(fetch.calls.length, 1);
    t.mock.timers.tick(4000);
    await flush();
    assert.equal(fetch.calls.length, 1, 'the retry waits for Retry-After, not the default 2s backoff');
    t.mock.timers.tick(1000);
    await flush();
    assert.equal(fetch.calls.length, 2);
    const results = await pending;
    assert.deepEqual(results, [{ recipient: '+16785550101', ok: true, id: 'SM9' }]);
  } finally {
    fetch.restore();
  }
});

test('twilio: a second 429 is reported, not retried again', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const fetch = installFetch(() => ({ status: 429, headers: { 'Retry-After': '1' }, body: JSON.stringify({ code: 20429, message: 'Too Many Requests' }) }));
  try {
    const results = await settle(t, provider().send({ channel: 'sms', sender: '+16785550100', recipients: ['+16785550101'], body: 'hi' }));
    assert.equal(results[0].ok, false);
    assert.equal(results[0].error, 'Twilio error 20429: Too Many Requests');
    assert.equal(fetch.calls.length, 2);
  } finally {
    fetch.restore();
  }
});

test('twilio: network errors are retried once and never leak the API key', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const fetch = installFetch(() => new Error(`connect failed while sending ${TWILIO.apiKeySecret} to host`));
  try {
    const results = await settle(t, provider().send({ channel: 'sms', sender: '+16785550100', recipients: ['+16785550101'], body: 'hi' }));
    assert.equal(results[0].ok, false);
    assert.equal(results[0].error, 'connect failed while sending [redacted] to host');
    assert.equal(fetch.calls.length, 2);
  } finally {
    fetch.restore();
  }
});

test('twilio: at most 5 requests in flight per provider', async () => {
  let inFlight = 0;
  let peak = 0;
  const fetch = installFetch(async () => {
    inFlight += 1;
    peak = Math.max(peak, inFlight);
    await new Promise((resolve) => setTimeout(resolve, 5));
    inFlight -= 1;
    return { status: 201, body: JSON.stringify({ sid: 'SM' }) };
  });
  try {
    const recipients = Array.from({ length: 12 }, (_, i) => `+1678555${String(i).padStart(4, '0')}`);
    const results = await provider().send({ channel: 'sms', sender: '+16785550100', recipients, body: 'hi' });
    assert.equal(results.filter((r) => r.ok).length, 12);
    assert.equal(peak, 5);
  } finally {
    fetch.restore();
  }
});
