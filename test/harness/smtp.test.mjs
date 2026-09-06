import assert from 'node:assert/strict';
import { test } from 'node:test';

import { SmtpProvider } from '../../dist/providers/smtp.js';
import { fakeLogger, fakeTransport, settle, SMTP } from './helpers.mjs';

const RECIPIENTS = ['a@example.com', 'B@example.com'];

function provider(transport, overrides = {}) {
  return new SmtpProvider({ ...SMTP, ...overrides }, fakeLogger().log, { createTransport: transport.factory });
}

function nodemailerError(fields) {
  return Object.assign(new Error(fields.message ?? 'failed'), fields);
}

const accepted = (mail) => Promise.resolve({ messageId: '<id-1@example.com>', accepted: [...mail.bcc], rejected: [], envelope: {} });

test('smtp: security maps to secure and requireTLS; debug and logger are never set', () => {
  const cases = [
    ['ssl', { secure: true, requireTLS: false }],
    ['starttls', { secure: false, requireTLS: true }],
    ['none', { secure: false, requireTLS: false }],
  ];
  for (const [security, expected] of cases) {
    const options = provider(fakeTransport([accepted]), { security }).transportOptions();
    assert.equal(options.secure, expected.secure, security);
    assert.equal(options.requireTLS, expected.requireTLS, security);
    assert.equal(options.host, SMTP.host);
    assert.equal(options.port, SMTP.port);
    assert.deepEqual(options.auth, { user: SMTP.username, pass: SMTP.password });
    assert.equal(options.connectionTimeout, 10000);
    assert.ok(!('debug' in options), 'debug must not be set');
    assert.ok(!('logger' in options), 'logger must not be set');
    assert.ok(!('tls' in options), 'no TLS override, so certificate verification stays on');
  }
});

test('smtp: one message per action, recipients in bcc, from in to, header line breaks stripped', async () => {
  const transport = fakeTransport([accepted]);
  const results = await provider(transport, { from: { address: 'alex@example.com', name: 'Home\r\nBcc: x@y' } }).send({
    channel: 'email',
    recipients: RECIPIENTS,
    subject: 'Leak\r\nX-Injected: 1',
    body: 'Water detected.',
  });
  assert.deepEqual(results, [
    { recipient: 'a@example.com', ok: true, id: '<id-1@example.com>' },
    { recipient: 'B@example.com', ok: true, id: '<id-1@example.com>' },
  ]);
  assert.equal(transport.sent.length, 1);
  const mail = transport.sent[0];
  assert.deepEqual(mail.bcc, RECIPIENTS);
  assert.deepEqual(mail.from, { name: 'Home Bcc: x@y', address: 'alex@example.com' });
  assert.deepEqual(mail.to, mail.from);
  assert.equal(mail.subject, 'Leak X-Injected: 1');
  assert.equal(mail.text, 'Water detected.');
  assert.ok(!('html' in mail));
});

test('smtp: addresses the server rejected become per-recipient failures', async () => {
  const transport = fakeTransport([(mail) => Promise.resolve({
    messageId: '<id-2@example.com>',
    accepted: [mail.bcc[0]],
    rejected: [mail.bcc[1]],
    rejectedErrors: [nodemailerError({
      code: 'EENVELOPE', message: 'Recipient command failed', response: '550 5.1.1 No such user', responseCode: 550, recipient: mail.bcc[1],
    })],
    envelope: {},
  })]);
  const results = await provider(transport).send({ channel: 'email', recipients: RECIPIENTS, subject: 's', body: 'b' });
  assert.deepEqual(results[0], { recipient: 'a@example.com', ok: true, id: '<id-2@example.com>' });
  assert.equal(results[1].ok, false);
  assert.equal(results[1].error, 'SMTP EENVELOPE: Recipient command failed (550 5.1.1 No such user)');
  assert.equal(transport.sent.length, 1);
});

test('smtp: when every recipient is rejected the per-recipient errors are kept and nothing is retried', async () => {
  const transport = fakeTransport([(mail) => Promise.reject(nodemailerError({
    code: 'EENVELOPE',
    message: 'Can\'t send mail - all recipients were rejected',
    response: '550 5.1.1 No such user',
    responseCode: 550,
    rejected: [...mail.bcc],
    rejectedErrors: mail.bcc.map((recipient) => nodemailerError({
      code: 'EENVELOPE', message: 'Recipient command failed', response: `550 5.1.1 <${recipient}> not found`, responseCode: 550, recipient,
    })),
  }))]);
  const results = await provider(transport).send({ channel: 'email', recipients: RECIPIENTS, subject: 's', body: 'b' });
  assert.equal(results[0].ok, false);
  assert.equal(results[0].error, 'SMTP EENVELOPE: Recipient command failed (550 5.1.1 <a@example.com> not found)');
  assert.equal(results[1].error, 'SMTP EENVELOPE: Recipient command failed (550 5.1.1 <B@example.com> not found)');
  assert.equal(transport.sent.length, 1);
});

test('smtp: authentication failure is reported once with the password scrubbed', async () => {
  const transport = fakeTransport([() => Promise.reject(nodemailerError({
    code: 'EAUTH', message: `Invalid login for ${SMTP.username} using ${SMTP.password}`, response: '535 5.7.8 Authentication failed', responseCode: 535,
  }))]);
  const results = await provider(transport).send({ channel: 'email', recipients: RECIPIENTS, subject: 's', body: 'b' });
  for (const result of results) {
    assert.equal(result.ok, false);
    assert.equal(result.error, 'SMTP EAUTH: Invalid login for [redacted] using [redacted] (535 5.7.8 Authentication failed)');
  }
  assert.equal(transport.sent.length, 1, 'a rejected login is not retried');
});

test('smtp: a temporary server reply (rate limit) is retried once after 2s, then succeeds', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const transport = fakeTransport([
    () => Promise.reject(nodemailerError({
      code: 'EENVELOPE', message: 'Mail command failed', response: '450 4.7.1 Rate limit exceeded, try again later', responseCode: 450,
    })),
    accepted,
  ]);
  const results = await settle(t, provider(transport).send({ channel: 'email', recipients: RECIPIENTS, subject: 's', body: 'b' }), { steps: 1, stepMs: 2000 });
  assert.equal(transport.sent.length, 2);
  assert.deepEqual(results.map((r) => r.ok), [true, true]);
});

test('smtp: a connection error is retried once and then reported', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const transport = fakeTransport([() => Promise.reject(nodemailerError({ code: 'ECONNECTION', message: 'connect ECONNREFUSED 203.0.113.5:465' }))]);
  const results = await settle(t, provider(transport).send({ channel: 'email', recipients: RECIPIENTS, subject: 's', body: 'b' }), { steps: 2, stepMs: 2000 });
  assert.equal(transport.sent.length, 2);
  assert.equal(results[0].ok, false);
  assert.equal(results[0].error, 'SMTP ECONNECTION: connect ECONNREFUSED 203.0.113.5:465');
});

test('smtp: a transport that never answers times out after 10s, is retried once, then reported', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const transport = fakeTransport([() => new Promise(() => {})]);
  const results = await settle(t, provider(transport).send({ channel: 'email', recipients: RECIPIENTS, subject: 's', body: 'b' }));
  assert.equal(transport.sent.length, 2);
  for (const result of results) {
    assert.equal(result.ok, false);
    assert.equal(result.error, 'SMTP ETIMEDOUT: request timed out after 10s');
  }
});

test('smtp: a transport that throws synchronously still resolves to failures', async () => {
  const transport = fakeTransport([() => {
    throw new Error('boom');
  }]);
  const results = await provider(transport).send({ channel: 'email', recipients: RECIPIENTS, subject: 's', body: 'b' });
  assert.deepEqual(results.map((r) => r.ok), [false, false]);
  assert.equal(results[0].error, 'SMTP: boom');
});
