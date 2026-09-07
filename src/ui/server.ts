import { HomebridgePluginUiServer } from '@homebridge/plugin-ui-utils';

import {
  findChats, hostTimeZone, lookupTwilio, payloadProvider, payloadTestSend, pluginVersion, telegramBot, testProvider, testSend,
} from './handlers.js';

/**
 * Server side of the custom settings UI (SPEC section 11.2). Started by the Homebridge UI as a child
 * process through `homebridge-ui/server.js`; the plugin itself never loads this module.
 * Credentials arrive in request payloads, are used in memory for that one request, and are never
 * logged, stored, or returned (SPEC section 12, item 5).
 */
class NotifySwitchUiServer extends HomebridgePluginUiServer {
  constructor() {
    super();
    const options = (): { storagePath?: string } => ({ storagePath: this.homebridgeStoragePath });
    this.onRequest('/test-provider', (payload: unknown) => testProvider(payloadProvider(payload), options()));
    this.onRequest('/find-chats', (payload: unknown) => findChats(payloadProvider(payload), options()));
    this.onRequest('/telegram-bot', (payload: unknown) => telegramBot(payloadProvider(payload), options()));
    this.onRequest('/twilio-lookup', (payload: unknown) => lookupTwilio(payloadProvider(payload), options()));
    this.onRequest('/version', () => pluginVersion());
    this.onRequest('/host-timezone', () => hostTimeZone());
    this.onRequest('/test-send', (payload: unknown) => {
      const { config, switchId } = payloadTestSend(payload);
      return testSend(config, switchId, options());
    });
    this.ready();
  }
}

export function startUiServer(): NotifySwitchUiServer {
  return new NotifySwitchUiServer();
}
