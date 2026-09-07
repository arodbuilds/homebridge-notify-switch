import type { Channel } from './types.js';
import { CHANNELS } from './types.js';

/**
 * Uncovered channel detection (SPEC section 10 warnings). A switch "covers" a channel when at least
 * one of its actions sends on it. A group the switch targets may hold addresses on channels the
 * switch never sends on; those people receive nothing, silently. Startup logs one warning per switch
 * and channel. From 1.1.0 the settings UI no longer shows this as a warning: its Send by checkboxes
 * make the choice explicit, so the startup warning is for hand-edited configurations.
 */

/** The parts of an action the check reads. Both the validated config and the UI model satisfy this. */
export interface CoverageAction {
  channel: Channel;
  groups: string[];
  /** Extra recipients on the action's own channel. Present only so callers can pass actions as-is. */
  recipients?: string[];
}

/** The parts of a group the check reads. */
export interface CoverageGroup {
  id: string;
  sms: string[];
  email: string[];
  telegram: string[];
  ntfy: string[];
}

export interface UncoveredChannel {
  channel: Channel;
  /** Ids of the targeted groups that hold addresses on this channel, in configuration order. */
  groups: string[];
}

function hasEntries(list: string[] | undefined): boolean {
  return Array.isArray(list) && list.some((value) => typeof value === 'string' && value.trim().length > 0);
}

/**
 * Channels present in the groups (and extra recipients) a switch targets that none of its actions
 * send on. Returned in channel order (sms, email, telegram, ntfy); empty when everyone is covered.
 * Group ids are matched trimmed so the UI can pass its editable model directly. Unknown group ids
 * are ignored here; validation reports them separately.
 */
export function uncoveredChannels(actions: readonly CoverageAction[], groups: readonly CoverageGroup[]): UncoveredChannel[] {
  const covered = new Set<Channel>();
  const targetedIds = new Set<string>();
  for (const action of actions) {
    covered.add(action.channel);
    for (const groupId of action.groups) {
      const id = groupId.trim();
      if (id.length > 0) {
        targetedIds.add(id);
      }
    }
  }
  const targeted = groups.filter((group) => targetedIds.has(group.id.trim()));
  // Extra recipients belong to their action's channel, which that action covers by definition; they
  // are read here only so the "present" set is complete if an action model ever carries other channels.
  const out: UncoveredChannel[] = [];
  for (const channel of CHANNELS) {
    if (covered.has(channel)) {
      continue;
    }
    const withAddresses = targeted.filter((group) => hasEntries(group[channel])).map((group) => group.id.trim());
    if (withAddresses.length > 0) {
      out.push({ channel, groups: withAddresses });
    }
  }
  return out;
}

/** Human wording for a channel's address kind, used by the startup warning. */
export const CHANNEL_ADDRESS_NOUN: Readonly<Record<Channel, string>> = {
  sms: 'phone numbers',
  email: 'email addresses',
  telegram: 'Telegram chat IDs',
  ntfy: 'ntfy topics',
};

/** Human label for a channel in warnings. */
export const CHANNEL_ACTION_LABEL: Readonly<Record<Channel, string>> = {
  sms: 'SMS',
  email: 'email',
  telegram: 'Telegram',
  ntfy: 'ntfy',
};
