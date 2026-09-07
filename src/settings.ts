import { readFileSync } from 'node:fs';

/**
 * The platform name users put in the `platform` field of the config.json platform block.
 * Must match `pluginAlias` in config.schema.json.
 */
export const PLATFORM_NAME = 'NotifySwitch';

/**
 * The npm package name. Must match `name` in package.json.
 */
export const PLUGIN_NAME = 'homebridge-notify-switch';

/** Seconds the switch stays on before the plugin flips it back off (SPEC section 7, step 8). */
export const SWITCH_RESET_DELAY_MS = 1000;

/** Per-provider request timeout (SPEC section 6, rule 2). */
export const PROVIDER_TIMEOUT_MS = 10000;

/** Backoff before the single retry (SPEC section 6, rule 2). */
export const PROVIDER_RETRY_BACKOFF_MS = 2000;

/** Upper bound applied to a provider's retry-after value so one slow response cannot hang a send. */
export const PROVIDER_MAX_RETRY_AFTER_MS = 60000;

/** Per-provider in-flight concurrency cap (SPEC section 6, rule 3). */
export const PROVIDER_CONCURRENCY = 5;

// ---- Size bounds (SPEC section 12, item 12) -----------------------------------------------------------

/** Bytes of a provider's HTTP response body that are read; anything past this is dropped. */
export const MAX_RESPONSE_BYTES = 1024 * 1024;

/** Distinct recipients one action may resolve to, after deduplication. */
export const MAX_RECIPIENTS_PER_ACTION = 100;

/** Entries in any address list: a group's lists, an action's extra recipients, a provider's sms senders. */
export const MAX_LIST_ENTRIES = 200;

/** Actions on one switch. */
export const MAX_ACTIONS_PER_SWITCH = 20;

/** Providers, groups and switches, each. */
export const MAX_ITEMS = 100;

/** Distinct chats "Find people and groups" lists from one getUpdates call (SPEC section 11.2, item 5). */
export const MAX_LISTED_CHATS = 100;

/** Length of the `switchId` a Test send request may carry (a UUID is 36 characters). */
export const MAX_SWITCH_ID_LENGTH = 64;

function readVersion(): string {
  try {
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version?: unknown };
    return typeof pkg.version === 'string' ? pkg.version : '0.0.0';
  } catch {
    return '0.0.0';
  }
}

/** Package version, reported as the accessory firmware revision. */
export const PLUGIN_VERSION: string = readVersion();
