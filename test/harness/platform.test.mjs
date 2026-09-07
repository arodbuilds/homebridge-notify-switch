import assert from 'node:assert/strict';
import { test } from 'node:test';

import { Characteristic, Service, uuid } from '@homebridge/hap-nodejs';

import { NotifySwitchPlatform } from '../../dist/platform.js';
import { fakeLogger, flush, platformConfig, TWILIO } from './helpers.mjs';

/**
 * Platform startup against a fake Homebridge API (SPEC section 4, items 4, 7 and 9): a valid
 * configuration with no switches removes every cached accessory and the state persisted in their
 * contexts, while a configuration with errors leaves cached accessories untouched.
 */

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

function fakeApi() {
  const handlers = {};
  const calls = { registered: [], unregistered: [], updated: [] };
  const api = {
    hap: { Service, Characteristic, uuid },
    platformAccessory: FakeAccessory,
    user: { storagePath: () => '/nonexistent' },
    on(event, handler) {
      handlers[event] = handler;
    },
    registerPlatformAccessories(_plugin, _platform, accessories) {
      calls.registered.push(...accessories);
    },
    unregisterPlatformAccessories(_plugin, _platform, accessories) {
      calls.unregistered.push(...accessories);
    },
    updatePlatformAccessories(accessories) {
      calls.updated.push(...accessories);
    },
  };
  return { api, calls, launch: () => handlers.didFinishLaunching() };
}

/** The Homebridge-style logging object behind a PluginLogger from `fakeLogger`. */
function loggingOf(logger) {
  const record = (level) => (message) => logger.lines.push({ level, message: String(message) });
  return { info: record('info'), warn: record('warn'), error: record('error'), debug: record('debug'), success: record('info') };
}

/** Starts the platform with `cached` accessories restored and waits for startup to settle. */
async function start(config, cached) {
  const { api, calls, launch } = fakeApi();
  const logger = fakeLogger();
  const platform = new NotifySwitchPlatform(loggingOf(logger), config, api);
  for (const accessory of cached) {
    platform.configureAccessory(accessory);
  }
  launch();
  for (let i = 0; i < 50 && !/Registered|No switches configured|no accessories will be registered|startup failed/.test(logger.text()); i += 1) {
    await flush();
  }
  return { platform, calls, logger };
}

function cachedSet() {
  const sw = new FakeAccessory('Water Leak Alert', uuid.generate('6f1c2a9e-2b1c-4b8f-9d1e-0c5a1e2f3a4b'));
  sw.context.switchId = '6f1c2a9e-2b1c-4b8f-9d1e-0c5a1e2f3a4b';
  const master = new FakeAccessory('Notifications Enabled', uuid.generate('homebridge-notify-switch:master-switch'));
  master.context.master = true;
  master.context.masterOn = false;
  return { sw, master };
}

test('startup: a valid configuration with zero switches unregisters every cached accessory and clears their persisted state', async () => {
  const { sw, master } = cachedSet();
  const config = { platform: 'NotifySwitch', name: 'Notify Switch', configVersion: 1, providers: [], groups: [], switches: [] };
  const { calls, logger } = await start(config, [sw, master]);
  assert.deepEqual(calls.registered, [], 'nothing is registered');
  assert.deepEqual(calls.unregistered.map((a) => a.displayName).sort(), ['Notifications Enabled', 'Water Leak Alert']);
  assert.deepEqual(master.context, {}, 'the persisted master switch state is cleared');
  assert.deepEqual(sw.context, {}, 'the switch context is cleared');
  assert.match(logger.text(), /warn: switches: no switches configured/);
  assert.match(logger.text(), /info: No switches configured; nothing is registered/);
  assert.ok(!/error:/.test(logger.text()), `no errors: ${logger.text()}`);
});

test('startup: a configuration that fails validation leaves cached accessories untouched', async () => {
  const { sw, master } = cachedSet();
  const config = platformConfig({ providers: [TWILIO], actions: [{ providerId: 'twilio-main', channel: 'sms', groups: ['family'], body: '' }] });
  const { calls, logger } = await start(config, [sw, master]);
  assert.deepEqual(calls.registered, []);
  assert.deepEqual(calls.unregistered, [], 'cached accessories stay');
  assert.equal(master.context.masterOn, false, 'the persisted master switch state stays');
  assert.match(logger.text(), /error: switches\[0\]\.actions\[0\]\.body/);
  assert.match(logger.text(), /Cached accessories are left untouched/);
});

test('startup: a valid configuration registers its switches, keeps the master switch state, and removes only stale accessories', async () => {
  const { sw, master } = cachedSet();
  const stale = new FakeAccessory('Old Switch', uuid.generate('00000000-0000-4000-8000-000000000000'));
  const config = platformConfig({ providers: [TWILIO], actions: [{ providerId: 'twilio-main', channel: 'sms', groups: ['family'], body: 'hi' }] });
  const { calls, logger } = await start(config, [sw, master, stale]);
  assert.deepEqual(calls.registered, [], 'cached accessories are reused, not registered again');
  assert.deepEqual(calls.unregistered.map((a) => a.displayName), ['Old Switch']);
  assert.equal(master.context.masterOn, false, 'the master switch stays off across the restart');
  assert.match(logger.text(), /Registered 1 switch and master switch "Notifications Enabled"/);
});
