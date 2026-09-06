import type { PluginLogger } from '../logging.js';
import type { Channel, Provider, ProviderConfig, ProviderType } from '../types.js';

/**
 * Channels that actually send in this version. Anything a provider type serves (per `PROVIDER_CHANNELS`)
 * but is missing here validates normally and resolves to a "not yet implemented" result at send time.
 */
export const IMPLEMENTED_CHANNELS: Readonly<Record<ProviderType, readonly Channel[]>> = {
  twilio: ['sms'],
  smtp: [],
  telegram: [],
};

export function isChannelImplemented(type: ProviderType, channel: Channel): boolean {
  return IMPLEMENTED_CHANNELS[type].includes(channel);
}

/**
 * Loads the provider module for the configured type on demand (SPEC section 6, rule 1), so a type
 * that is not configured is never imported.
 */
export async function createProvider(config: ProviderConfig, log: PluginLogger): Promise<Provider> {
  switch (config.type) {
  case 'twilio': {
    const { TwilioProvider } = await import('./twilio.js');
    return new TwilioProvider(config, log);
  }
  case 'smtp': {
    const { SmtpProvider } = await import('./smtp.js');
    return new SmtpProvider(config, log);
  }
  case 'telegram': {
    const { TelegramProvider } = await import('./telegram.js');
    return new TelegramProvider(config, log);
  }
  }
}
