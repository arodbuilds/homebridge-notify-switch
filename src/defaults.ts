import type { Channel, ProviderType } from './types.js';
import { CHANNELS, PROVIDER_CHANNELS } from './types.js';

/**
 * Platform defaults per channel (SPEC section 5.7). Shared by startup validation and the settings UI so
 * the two can never disagree about which provider a switch uses when it does not say.
 *
 * Rules: when exactly one provider serves a channel it is the default and nothing is stored; with more
 * than one, `defaultProviders[channel]` names the default; a missing or stale entry falls back to the
 * first provider in configuration order.
 */

export type DefaultProviders = Partial<Record<Channel, string>>;

/** The parts of a provider the rules read. The validated config and the UI model both satisfy this. */
export interface DefaultsProvider {
  id: string;
  type: ProviderType;
  /** Twilio serves email only once a from address is set (SPEC section 5.2). */
  emailFrom?: { address: string } | undefined;
}

/** True when `provider` can send on `channel`: its type serves it, and for Twilio email the from address is set. */
export function servesChannel(provider: DefaultsProvider, channel: Channel): boolean {
  if (!PROVIDER_CHANNELS[provider.type].includes(channel)) {
    return false;
  }
  if (provider.type === 'twilio' && channel === 'email') {
    return typeof provider.emailFrom?.address === 'string' && provider.emailFrom.address.trim().length > 0;
  }
  return true;
}

/** The providers that serve `channel`, in configuration order; entries without an id are skipped. */
export function providersForChannel<T extends DefaultsProvider>(providers: readonly T[], channel: Channel): T[] {
  return providers.filter((provider) => provider.id.trim().length > 0 && servesChannel(provider, channel));
}

export interface DefaultResolution {
  /** The provider id switches use on this channel unless told otherwise; undefined when no provider serves it. */
  id?: string;
  /** `only`: one provider serves the channel. `stored`: `defaultProviders` names one. `first`: fallback to configuration order. `none`: nobody serves it. */
  source: 'only' | 'stored' | 'first' | 'none';
  /** Ids of the providers that serve the channel, in configuration order. */
  candidates: string[];
}

/** Which provider a switch uses on `channel` when it names none (SPEC section 5.7). */
export function resolveDefaultProvider(channel: Channel, providers: readonly DefaultsProvider[], defaults: DefaultProviders | undefined): DefaultResolution {
  const candidates = providersForChannel(providers, channel).map((provider) => provider.id.trim());
  if (candidates.length === 0) {
    return { source: 'none', candidates };
  }
  if (candidates.length === 1) {
    return { id: candidates[0], source: 'only', candidates };
  }
  const stored = typeof defaults?.[channel] === 'string' ? defaults[channel]?.trim() : undefined;
  if (stored && candidates.includes(stored)) {
    return { id: stored, source: 'stored', candidates };
  }
  return { id: candidates[0], source: 'first', candidates };
}

/** True while the channel has more than one provider and none of them is the stored default. */
export function defaultNeeded(channel: Channel, providers: readonly DefaultsProvider[], defaults: DefaultProviders | undefined): boolean {
  return resolveDefaultProvider(channel, providers, defaults).source === 'first';
}

/**
 * The entries worth storing: a channel with more than one provider whose stored default is one of them.
 * Everything else is dropped, so removing the default provider leaves the single remaining one as the
 * implicit default, or the channel without a default when several remain (SPEC section 5.7).
 */
export function pruneDefaults(providers: readonly DefaultsProvider[], defaults: DefaultProviders | undefined): DefaultProviders {
  const out: DefaultProviders = {};
  for (const channel of CHANNELS) {
    const resolution = resolveDefaultProvider(channel, providers, defaults);
    if (resolution.source === 'stored' && resolution.id) {
      out[channel] = resolution.id;
    }
  }
  return out;
}
