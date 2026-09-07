import assert from 'node:assert/strict';
import { test } from 'node:test';

import { Characteristic, Service, uuid } from '@homebridge/hap-nodejs';

import { maskAddress } from '../../dist/logging.js';
import { NotifySwitchAccessory } from '../../dist/switchAccessory.js';
import { fakeLogger, flush } from './helpers.mjs';

/**
 * Logging rules (SPEC section 8): addresses are partially masked at info level and shown in full only
 * with `debug` on; message bodies never reach an info line unless `debug` is on.
 */

test('maskAddress: phone numbers keep the country code and the last four digits', () => {
  assert.equal(maskAddress('+16785550101', 'sms'), '+1678***0101');
  assert.equal(maskAddress('+447700900123', 'sms'), '+4477***0123');
  // Short values never reveal the tail.
  assert.equal(maskAddress('+1234', 'sms'), '+1***');
  assert.equal(maskAddress('123456', 'sms'), '12***');
  assert.equal(maskAddress('1234567', 'sms'), '12345***4567');
  assert.equal(maskAddress('', 'sms'), '***');
});

test('maskAddress: email addresses keep the first character and the domain', () => {
  assert.equal(maskAddress('alex@example.com', 'email'), 'a***@example.com');
  assert.equal(maskAddress('a@example.com', 'email'), 'a***@example.com');
  assert.equal(maskAddress('first.last+tag@mail.example.org', 'email'), 'f***@mail.example.org');
  // No local part, or no @ at all: nothing but the first character survives.
  assert.equal(maskAddress('@example.com', 'email'), '@***');
  assert.equal(maskAddress('not-an-address', 'email'), 'n***');
  assert.equal(maskAddress('', 'email'), '***');
});

test('maskAddress: Telegram chat ids keep the sign, two leading and two trailing digits', () => {
  assert.equal(maskAddress('123456789', 'telegram'), '12***89');
  assert.equal(maskAddress('-1001234567890', 'telegram'), '-10***90');
  assert.equal(maskAddress('12345', 'telegram'), '12***45');
  // Four digits or fewer: one leading digit only.
  assert.equal(maskAddress('1234', 'telegram'), '1***');
  assert.equal(maskAddress('-42', 'telegram'), '-4***');
  assert.equal(maskAddress('', 'telegram'), '***');
});

// ---- Flip handler log output -------------------------------------------------

const PHONE = '+16785550101';
const EMAIL = 'alex@example.com';
const CHAT = '123456789';
const BODY_MARKER = 'kitchen-sink-body-marker';
const SUBJECT_MARKER = 'subject-line-marker';

class FakeAccessory {
  constructor(displayName, UUID) {
    this.displayName = displayName;
    this.UUID = UUID;
    this.context = {};
    this.services = [];
  }

  getService(ctor) {
    return this.services.find((service) => service instanceof ctor);
  }

  getServiceById(ctor, subtype) {
    return this.services.find((service) => service instanceof ctor && service.subtype === subtype);
  }

  addService(ctor, name, subtype) {
    const service = new ctor(name ?? 'Switch', subtype);
    this.services.push(service);
    return service;
  }

  removeService(service) {
    this.services = this.services.filter((entry) => entry !== service);
  }
}

/** A provider that accepts everything (or fails the given recipients) and records the requests. */
function fakeProvider(id, channels, failing = []) {
  const requests = [];
  return {
    id,
    type: 'twilio',
    channels,
    requests,
    validateConfig: () => [],
    validateBody: () => [],
    async send(req) {
      requests.push(req);
      // Provider message ids carry no address, as the real providers' do.
      return req.recipients.map((recipient, i) => (failing.includes(recipient)
        ? { recipient, ok: false, error: `rejected ${recipient}` }
        : { recipient, ok: true, id: `msg-${requests.length}-${i + 1}` }));
    },
  };
}

const SWITCH = {
  id: '6f1c2a9e-2b1c-4b8f-9d1e-0c5a1e2f3a4b',
  name: 'Water Leak Alert',
  enabled: true,
  cooldownSeconds: 0,
  failureMode: 'any',
  failureSensor: false,
  failureSensorResetSeconds: 300,
  actions: [
    { index: 0, providerId: 'twilio-main', channel: 'sms', sender: '+16785550100', recipients: [PHONE], body: `Water at {{time}} ${BODY_MARKER}` },
    { index: 1, providerId: 'twilio-main', channel: 'email', recipients: [EMAIL], subject: `{{switchName}} ${SUBJECT_MARKER}`, body: `Email ${BODY_MARKER}` },
    { index: 2, providerId: 'telegram-home', channel: 'telegram', recipients: [CHAT], body: `Telegram ${BODY_MARKER}` },
  ],
};

/** Builds a switch accessory over a minimal fake platform, flips it on, and returns the recorded log lines. */
async function flip({ debug = false, failing = [] } = {}) {
  const logger = fakeLogger(debug);
  const platform = {
    Service, Characteristic, log: logger.log,
    masterSwitchName: 'Notifications Enabled',
    isMasterOn: () => true,
  };
  const providers = new Map([
    ['twilio-main', fakeProvider('twilio-main', ['sms', 'email'], failing)],
    ['telegram-home', fakeProvider('telegram-home', ['telegram'], failing)],
  ]);
  const accessory = new FakeAccessory(SWITCH.name, uuid.generate(SWITCH.id));
  new NotifySwitchAccessory(platform, accessory, SWITCH, providers);
  const on = accessory.getService(Service.Switch).getCharacteristic(Characteristic.On);
  await on.handleSetRequest(true);
  for (let i = 0; i < 50 && !/messages? sent/.test(logger.text()); i += 1) {
    await flush();
  }
  const at = (level) => logger.lines.filter((line) => line.level === level).map((line) => line.message);
  return { lines: logger.lines, text: logger.text(), info: at('info'), warn: at('warn'), debug: at('debug'), providers };
}

test('flip handler: at info level the body never appears and every address is masked; the body reaches the debug level only', async () => {
  const { info, warn, debug, text, providers } = await flip();
  assert.equal(providers.get('twilio-main').requests.length, 2, 'both Twilio actions were sent');
  assert.equal(providers.get('telegram-home').requests.length, 1);

  // One line per recipient, masked, plus the summary (SPEC section 8, item 1).
  assert.ok(info.includes('[Water Leak Alert] sms via twilio-main to +1678***0101: sent (msg-1-1)'), text);
  assert.ok(info.includes('[Water Leak Alert] email via twilio-main to a***@example.com: sent (msg-2-1)'), text);
  assert.ok(info.includes('[Water Leak Alert] telegram via telegram-home to 12***89: sent (msg-1-1)'), text);
  assert.ok(info.includes('[Water Leak Alert] 3 of 3 messages sent'), text);
  assert.deepEqual(warn, []);

  const visible = [...info, ...warn].join('\n');
  for (const full of [PHONE, EMAIL, CHAT]) {
    assert.ok(!visible.includes(full), `full address ${full} appears at info level:\n${visible}`);
  }
  assert.ok(!visible.includes(BODY_MARKER), `the body appears at info level:\n${visible}`);
  assert.ok(!visible.includes(SUBJECT_MARKER), `the subject appears at info level:\n${visible}`);

  // With debug off the body goes to the Homebridge debug level, which is silent unless Homebridge runs with -D.
  assert.ok(debug.some((line) => line.includes(BODY_MARKER)), 'the body is still available at the debug level');
});

test('flip handler: a failure is warned with the masked address and the error has the address masked too', async () => {
  const { info, warn, text } = await flip({ failing: [PHONE] });
  assert.ok(warn.includes('[Water Leak Alert] sms via twilio-main to +1678***0101: failed: rejected +1678***0101'), text);
  assert.ok(info.includes('[Water Leak Alert] 2 of 3 messages sent, 1 failed'), text);
  const visible = [...info, ...warn].join('\n');
  assert.ok(!visible.includes(PHONE), `full phone number appears at info or warn level:\n${visible}`);
  assert.ok(!visible.includes(BODY_MARKER));
});

test('flip handler: with debug on the body and the full addresses appear on info lines', async () => {
  const { info, warn, text } = await flip({ debug: true, failing: [PHONE] });
  const visible = [...info, ...warn].join('\n');
  assert.ok(visible.includes(BODY_MARKER), `the body is logged when debug is on:\n${text}`);
  assert.ok(visible.includes(`subject "Water Leak Alert ${SUBJECT_MARKER}"`), text);
  assert.ok(info.includes(`[Water Leak Alert] email via twilio-main to ${EMAIL}: sent (msg-2-1)`), text);
  assert.ok(info.includes(`[Water Leak Alert] telegram via telegram-home to ${CHAT}: sent (msg-1-1)`), text);
  assert.ok(warn.includes(`[Water Leak Alert] sms via twilio-main to ${PHONE}: failed: rejected ${PHONE}`), text);
  assert.ok(!visible.includes('***'), `nothing is masked when debug is on:\n${visible}`);
});
