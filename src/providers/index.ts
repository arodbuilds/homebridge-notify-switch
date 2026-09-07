import type { PluginLogger } from '../logging.js';
import type { Provider, ProviderConfig } from '../types.js';

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
  case 'ntfy': {
    const { NtfyProvider } = await import('./ntfy.js');
    return new NtfyProvider(config, log);
  }
  }
}
