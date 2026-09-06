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
