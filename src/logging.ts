import type { Logging } from 'homebridge';

import { escapeControlCharacters } from './text.js';
import type { Channel } from './types.js';

/**
 * Partially masks an address for info-level logs (SPEC section 8, item 1).
 * `+16785550101` becomes `+1678***0101`, `alex@example.com` becomes `a***@example.com`,
 * a Telegram chat id `123456789` becomes `12***89`, an ntfy topic `home-alerts` becomes `ho***ts`.
 */
export function maskAddress(address: string, channel: Channel): string {
  switch (channel) {
  case 'sms': {
    if (address.length <= 6) {
      return `${address.slice(0, 2)}***`;
    }
    return `${address.slice(0, 5)}***${address.slice(-4)}`;
  }
  case 'email': {
    const at = address.indexOf('@');
    if (at <= 0) {
      return `${address.slice(0, 1)}***`;
    }
    return `${address.slice(0, 1)}***${address.slice(at)}`;
  }
  case 'telegram': {
    const sign = address.startsWith('-') ? '-' : '';
    const digits = sign ? address.slice(1) : address;
    if (digits.length <= 4) {
      return `${sign}${digits.slice(0, 1)}***`;
    }
    return `${sign}${digits.slice(0, 2)}***${digits.slice(-2)}`;
  }
  case 'ntfy': {
    // A topic name is what lets anyone read the topic, so it is masked like a chat id.
    if (address.length <= 4) {
      return `${address.slice(0, 1)}***`;
    }
    return `${address.slice(0, 2)}***${address.slice(-2)}`;
  }
  }
}

/**
 * Thin wrapper over the Homebridge logger that knows about the plugin's `debug` setting.
 * With `debug` on, verbose lines are emitted at info level so they show without `homebridge -D`.
 * Nothing routed through here should ever contain a credential; callers mask addresses via `address()`.
 * Every line has its control characters escaped (SPEC section 12, item 12), so a value from the
 * configuration or a provider response can never start a new log line or emit a terminal escape.
 */
export class PluginLogger {
  constructor(private readonly log: Logging, public debugEnabled = false) {}

  info(message: string): void {
    this.log.info(escapeControlCharacters(message));
  }

  warn(message: string): void {
    this.log.warn(escapeControlCharacters(message));
  }

  error(message: string): void {
    this.log.error(escapeControlCharacters(message));
  }

  /** Verbose output. Visible at info level only when the plugin's `debug` option is on. */
  debug(message: string): void {
    if (this.debugEnabled) {
      this.log.info(`[debug] ${escapeControlCharacters(message)}`);
    } else {
      this.log.debug(escapeControlCharacters(message));
    }
  }

  /** Address as it should appear in an info-level log line: full when debug is on, masked otherwise. */
  address(address: string, channel: Channel): string {
    return this.debugEnabled ? address : maskAddress(address, channel);
  }
}
