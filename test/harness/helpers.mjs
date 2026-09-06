import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { PluginLogger } from '../../dist/logging.js';

/**
 * Shared helpers for the local harness. Everything runs against the compiled `dist/` output with
 * `fetch` and the nodemailer transport replaced, so no network is touched.
 */

/** A PluginLogger over a recording Homebridge-style logger. */
export function fakeLogger(debug = false) {
  const lines = [];
  const record = (level) => (message) => {
    lines.push({ level, message: String(message) });
  };
  const logging = { info: record('info'), warn: record('warn'), error: record('error'), debug: record('debug'), success: record('info') };
  const log = new PluginLogger(logging, debug);
  return { log, lines, text: () => lines.map((line) => `${line.level}: ${line.message}`).join('\n') };
}

/**
 * Replaces `globalThis.fetch`. `handler(call, index)` returns `{ status, body?, headers? }`, an Error to
 * throw (network failure), or the string 'hang' to wait until the request's abort signal fires.
 */
export function installFetch(handler) {
  const calls = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    const call = { url: String(url), init, headers: init.headers ?? {}, body: typeof init.body === 'string' ? init.body : '' };
    calls.push(call);
    const reply = await handler(call, calls.length);
    if (reply === 'hang') {
      return new Promise((_, reject) => {
        init.signal?.addEventListener('abort', () => reject(init.signal.reason));
      });
    }
    if (reply instanceof Error) {
      throw reply;
    }
    return new Response(reply.body ?? '', { status: reply.status ?? 200, headers: reply.headers ?? {} });
  };
  return {
    calls,
    restore() {
      globalThis.fetch = original;
    },
  };
}

/** Lets promise continuations run between fake-timer ticks. */
export async function flush(rounds = 4) {
  for (let i = 0; i < rounds; i += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
}

/**
 * Drives a pending send through the plugin's timeout and retry timers with `t.mock.timers`
 * (which the caller enables for `setTimeout`) and returns its result.
 */
export async function settle(t, pending, { steps = 6, stepMs = 10000 } = {}) {
  for (let i = 0; i < steps; i += 1) {
    await flush();
    t.mock.timers.tick(stepMs);
  }
  await flush();
  return pending;
}

/** Fake nodemailer transport: `script` is a list of functions called in order with the mail options. */
export function fakeTransport(script) {
  const sent = [];
  let created;
  const factory = (options) => {
    created = options;
    return {
      sendMail(mail) {
        sent.push(mail);
        const step = script[Math.min(sent.length, script.length) - 1];
        return step(mail, sent.length);
      },
    };
  };
  return { factory, sent, options: () => created };
}

/** Writes JSON files into a fresh temporary directory standing in for the Homebridge storage path. */
export function storageDir(files = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'notify-switch-'));
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(join(dir, name), typeof content === 'string' ? content : JSON.stringify(content));
  }
  return dir;
}

export const TWILIO = {
  id: 'twilio-main',
  type: 'twilio',
  name: 'Twilio',
  accountSid: 'AC00000000000000000000000000000000',
  apiKeySid: 'SK00000000000000000000000000000000',
  apiKeySecret: 'secret-api-key-value',
  smsSenders: ['+16785550100'],
  emailFrom: { address: 'alerts@example.com', name: 'Home' },
};

export const SMTP = {
  id: 'fastmail',
  type: 'smtp',
  name: 'Fastmail',
  host: 'smtp.fastmail.com',
  port: 465,
  security: 'ssl',
  username: 'alex@example.com',
  password: 'app-password-value',
  from: { address: 'alex@example.com', name: 'Home' },
};

export const TELEGRAM = {
  id: 'telegram-home',
  type: 'telegram',
  name: 'Telegram',
  botToken: '123456789:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
  parseMode: 'none',
};

/** A platform block with one switch whose actions are given by the caller. */
export function platformConfig({ providers, groups, actions, debug = false }) {
  return {
    platform: 'NotifySwitch',
    name: 'Notify Switch',
    debug,
    providers,
    groups: groups ?? [{ id: 'family', name: 'Family', sms: ['+16785550101'], email: ['a@example.com'], telegram: ['123456789'] }],
    switches: [{
      id: '6f1c2a9e-2b1c-4b8f-9d1e-0c5a1e2f3a4b',
      name: 'Water Leak Alert',
      actions,
    }],
  };
}
