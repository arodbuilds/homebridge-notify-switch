import { firstNonGsm7Character, SMS_MAX_LENGTH } from '../../src/gsm7.js';
import {
  ACCOUNT_SID_PATTERN, API_KEY_SID_PATTERN, BOT_TOKEN_PATTERN, E164_PATTERN, EMAIL_PATTERN, HAP_NAME_MAX_LENGTH, HAP_NAME_PATTERN,
  MESSAGING_SERVICE_SID_PATTERN, SLUG_PATTERN, TELEGRAM_CHAT_ID_PATTERN, UUID_PATTERN,
} from '../../src/patterns.js';
import { PROVIDER_CHANNELS } from '../../src/types.js';
import type { Channel } from '../../src/types.js';
import { VALIDATION } from './copy.js';
import { isCountry } from './phone.js';
import type { UiAction, UiConfig, UiGroup, UiProvider, UiSwitch } from './model.js';

/**
 * Client-side validation mirroring startup validation (SPEC section 10) so the Save button is
 * disabled while the configuration would fail at startup. Each issue carries the field path (for
 * inline marking) and a readable label for the issue list.
 */

export interface UiIssue {
  path: string;
  label: string;
  message: string;
  /**
   * Other fields this check reads (SPEC section 11.2, item 15): a cross-field issue such as "nobody would
   * receive this action" or a duplicate name belongs to every field it references, and it is shown inline
   * once any of them has been touched. Each entry is a path prefix: `switches[0].actions[1].recipients`
   * covers every entry of that list.
   */
  related?: string[];
}

const EMAIL_MAX_LENGTH = 10000;
const TELEGRAM_MAX_LENGTH = 4096;
const MAX_SECONDS = 86400;

class Issues {
  readonly list: UiIssue[] = [];

  add(path: string, label: string, message: string, related?: string[]): void {
    this.list.push(related && related.length > 0 ? { path, label, message, related } : { path, label, message });
  }
}

function providerLabel(p: UiProvider, i: number): string {
  return `Provider ${i + 1}${p.name.trim() ? ` "${p.name.trim()}"` : ''}`;
}

function groupLabel(g: UiGroup, i: number): string {
  return `Group ${i + 1}${g.name.trim() ? ` "${g.name.trim()}"` : ''}`;
}

function switchLabel(s: UiSwitch, i: number): string {
  return `Switch ${i + 1}${s.name.trim() ? ` "${s.name.trim()}"` : ''}`;
}

function checkHapName(issues: Issues, name: string, path: string, label: string, related?: string[]): void {
  const value = name.trim();
  if (!value) {
    issues.add(path, label, 'Name is required.', related);
  } else if (value.length > HAP_NAME_MAX_LENGTH) {
    issues.add(path, label, `Name must be ${HAP_NAME_MAX_LENGTH} characters or fewer.`, related);
  } else if (!HAP_NAME_PATTERN.test(value)) {
    issues.add(path, label, VALIDATION.switchName, related);
  }
}

function checkAddress(issues: Issues, channel: Channel, value: string, path: string, label: string, what: string): boolean {
  const text = value.trim();
  switch (channel) {
  case 'sms':
    if (!E164_PATTERN.test(text)) {
      issues.add(path, label, `${what} "${text}" is not a valid phone number.`);
      return false;
    }
    return true;
  case 'email':
    if (!EMAIL_PATTERN.test(text)) {
      issues.add(path, label, `${what} "${text}" is not a valid email address.`);
      return false;
    }
    return true;
  case 'telegram':
    if (!TELEGRAM_CHAT_ID_PATTERN.test(text)) {
      issues.add(path, label, `${what} "${text}" is not a Telegram chat ID (digits only, negative for group chats).`);
      return false;
    }
    return true;
  }
}

function checkProvider(issues: Issues, p: UiProvider, i: number, seen: Map<string, string>): void {
  const path = `providers[${i}]`;
  const label = providerLabel(p, i);
  const id = p.id.trim();
  // The id is generated from the name (SPEC section 11.2, item 14), so an id issue belongs to the name field too.
  if (!id) {
    issues.add(`${path}.id`, label, 'ID is required.', [`${path}.name`]);
  } else if (!SLUG_PATTERN.test(id)) {
    issues.add(`${path}.id`, label, 'ID must be lowercase letters, digits, dashes or underscores, starting with a letter or digit.', [`${path}.name`]);
  } else if (seen.has(id)) {
    const other = seen.get(id) as string;
    issues.add(`${path}.id`, label, `ID "${id}" is used by another provider.`, [`${path}.name`, `${other}.id`, `${other}.name`]);
  } else {
    seen.set(id, path);
  }
  if (!p.name.trim()) {
    issues.add(`${path}.name`, label, 'Name is required.');
  }
  // With a credentialsFile the secret fields may come from the file, which the UI cannot read (SPEC section 12, item 2).
  const fromFile = p.credentialsFile.trim().length > 0;
  switch (p.type) {
  case 'twilio':
    if (!(fromFile && !p.accountSid.trim()) && !ACCOUNT_SID_PATTERN.test(p.accountSid.trim())) {
      issues.add(`${path}.accountSid`, label, VALIDATION.accountSid);
    }
    if (!(fromFile && !p.apiKeySid.trim()) && !API_KEY_SID_PATTERN.test(p.apiKeySid.trim())) {
      issues.add(`${path}.apiKeySid`, label, VALIDATION.apiKeySid);
    }
    if (!fromFile && !p.apiKeySecret) {
      issues.add(`${path}.apiKeySecret`, label, 'API Key Secret is required.');
    }
    p.smsSenders.forEach((sender, s) => {
      if (!E164_PATTERN.test(sender.trim())) {
        issues.add(`${path}.smsSenders[${s}]`, label, `SMS sender "${sender.trim()}" is not a valid phone number.`);
      }
    });
    if (p.messagingServiceSid.trim() && !MESSAGING_SERVICE_SID_PATTERN.test(p.messagingServiceSid.trim())) {
      issues.add(`${path}.messagingServiceSid`, label, VALIDATION.messagingServiceSid);
    }
    if (p.emailFrom.address.trim() && !EMAIL_PATTERN.test(p.emailFrom.address.trim())) {
      issues.add(`${path}.emailFrom.address`, label, 'Email From address is not a valid email address.');
    }
    if (!p.emailFrom.address.trim() && p.emailFrom.name.trim()) {
      issues.add(`${path}.emailFrom.address`, label, 'Email From address is required when a from name is set.', [`${path}.emailFrom.name`]);
    }
    break;
  case 'smtp':
    if (!p.host.trim()) {
      issues.add(`${path}.host`, label, 'Host is required.');
    }
    if (!Number.isInteger(p.port) || p.port < 1 || p.port > 65535) {
      issues.add(`${path}.port`, label, VALIDATION.port);
    }
    if (!fromFile && !p.username.trim()) {
      issues.add(`${path}.username`, label, 'Username is required.');
    }
    if (!fromFile && !p.password) {
      issues.add(`${path}.password`, label, 'Password is required.');
    }
    if (!EMAIL_PATTERN.test(p.from.address.trim())) {
      issues.add(`${path}.from.address`, label, 'From address is required and must be a valid email address.');
    }
    break;
  case 'telegram':
    if (!(fromFile && !p.botToken.trim()) && !BOT_TOKEN_PATTERN.test(p.botToken.trim())) {
      issues.add(`${path}.botToken`, label, VALIDATION.botToken);
    }
    break;
  }
}

function checkGroup(issues: Issues, g: UiGroup, i: number, seen: Map<string, string>): void {
  const path = `groups[${i}]`;
  const label = groupLabel(g, i);
  const id = g.id.trim();
  if (!id) {
    issues.add(`${path}.id`, label, 'ID is required.', [`${path}.name`]);
  } else if (!SLUG_PATTERN.test(id)) {
    issues.add(`${path}.id`, label, 'ID must be lowercase letters, digits, dashes or underscores, starting with a letter or digit.', [`${path}.name`]);
  } else if (seen.has(id)) {
    const other = seen.get(id) as string;
    issues.add(`${path}.id`, label, `ID "${id}" is used by another group.`, [`${path}.name`, `${other}.id`, `${other}.name`]);
  } else {
    seen.set(id, path);
  }
  if (!g.name.trim()) {
    issues.add(`${path}.name`, label, 'Name is required.');
  }
  for (const channel of ['sms', 'email', 'telegram'] as const) {
    g[channel].forEach((value, k) => {
      if (value.trim()) {
        checkAddress(issues, channel, value, `${path}.${channel}[${k}]`, label, channel === 'sms' ? 'Phone number' : channel === 'email' ? 'Email' : 'Chat ID');
      }
    });
  }
}

function checkBody(issues: Issues, channel: Channel, body: string, path: string, label: string): void {
  const length = Array.from(body).length;
  if (length === 0) {
    issues.add(path, label, 'Message is required.');
    return;
  }
  switch (channel) {
  case 'sms': {
    if (length > SMS_MAX_LENGTH) {
      issues.add(path, label, `SMS message is ${length} characters; the limit is ${SMS_MAX_LENGTH}.`);
    }
    const bad = firstNonGsm7Character(body);
    if (bad !== undefined) {
      const code = (bad.codePointAt(0) ?? 0).toString(16).toUpperCase().padStart(4, '0');
      issues.add(path, label, `SMS message contains "${bad}" (U+${code}), which is not allowed in SMS.`);
    }
    break;
  }
  case 'email':
    if (length > EMAIL_MAX_LENGTH) {
      issues.add(path, label, `Email message is ${length} characters; the limit is ${EMAIL_MAX_LENGTH}.`);
    }
    break;
  case 'telegram':
    if (length > TELEGRAM_MAX_LENGTH) {
      issues.add(path, label, `Telegram message is ${length} characters; the limit is ${TELEGRAM_MAX_LENGTH}.`);
    }
    break;
  }
}

function checkAction(issues: Issues, config: UiConfig, a: UiAction, path: string, label: string): void {
  const provider = config.providers.find((p) => p.id.trim() === a.providerId && a.providerId);
  // Checks that read the provider as well as the channel or sender belong to the Provider dropdown too.
  const viaProvider = [`${path}.providerId`];
  if (!provider) {
    issues.add(`${path}.providerId`, label, a.providerId ? `Provider "${a.providerId}" does not exist.` : 'Choose a provider.');
  } else if (!PROVIDER_CHANNELS[provider.type].includes(a.channel)) {
    issues.add(`${path}.channel`, label, `Provider "${provider.name.trim() || provider.id}" is ${provider.type}, which cannot send ${a.channel}.`, viaProvider);
  } else if (provider.type === 'twilio' && a.channel === 'sms') {
    const senders = provider.smsSenders.map((s) => s.trim()).filter((s) => s.length > 0);
    const service = provider.messagingServiceSid.trim().length > 0;
    if (a.sender) {
      if (!senders.includes(a.sender)) {
        issues.add(`${path}.sender`, label, `Sender ${a.sender} is not one of the provider's SMS senders.`, viaProvider);
      }
    } else if (senders.length === 0 && !service) {
      issues.add(`${path}.sender`, label,
        `Provider "${provider.name.trim() || provider.id}" needs an SMS sender or a Messaging Service SID to send SMS.`, viaProvider);
    } else if (senders.length > 1 && !service) {
      issues.add(`${path}.sender`, label, 'Choose a sender: the provider has more than one SMS sender.', viaProvider);
    }
  } else if (provider.type === 'twilio' && a.channel === 'email' && !provider.emailFrom.address.trim()) {
    issues.add(`${path}.channel`, label,
      `Provider "${provider.name.trim() || provider.id}" needs an Email From address before it can send email.`, viaProvider);
  }

  let recipients = 0;
  a.groups.forEach((groupId, g) => {
    const group = config.groups.find((entry) => entry.id.trim() === groupId && groupId);
    if (!group) {
      issues.add(`${path}.groups[${g}]`, label, `Group "${groupId}" does not exist.`);
      return;
    }
    recipients += group[a.channel].filter((v) => v.trim().length > 0).length;
  });
  a.recipients.forEach((value, r) => {
    if (!value.trim()) {
      return;
    }
    if (checkAddress(issues, a.channel, value, `${path}.recipients[${r}]`, label, 'Extra recipient')) {
      recipients += 1;
    }
  });
  if (recipients === 0) {
    // Recipient coverage belongs to the Groups checkboxes and the extra recipients list alike.
    const message = `Nobody would receive this ${a.channel} action. Pick a group with ${a.channel} entries or add an extra recipient.`;
    issues.add(`${path}.groups`, label, message, [`${path}.recipients`]);
  }
  checkBody(issues, a.channel, a.body, `${path}.body`, label);
}

function checkSwitch(issues: Issues, config: UiConfig, s: UiSwitch, i: number, seenIds: Set<string>, seenNames: Map<string, string>): void {
  const path = `switches[${i}]`;
  const label = switchLabel(s, i);
  if (!UUID_PATTERN.test(s.id)) {
    issues.add(`${path}.id`, label, 'ID must be a UUID.');
  } else if (seenIds.has(s.id.toLowerCase())) {
    issues.add(`${path}.id`, label, 'ID is used by another switch.');
  } else {
    seenIds.add(s.id.toLowerCase());
  }
  checkHapName(issues, s.name, `${path}.name`, label);
  const name = s.name.trim();
  if (name && HAP_NAME_PATTERN.test(name)) {
    if (seenNames.has(name)) {
      // A duplicate name belongs to both name fields: touching either reveals it.
      issues.add(`${path}.name`, label, `Another switch is already named "${name}".`, [`${seenNames.get(name)}.name`]);
    } else {
      seenNames.set(name, path);
    }
  }
  if (!Number.isInteger(s.cooldownSeconds) || s.cooldownSeconds < 0 || s.cooldownSeconds > MAX_SECONDS) {
    issues.add(`${path}.cooldownSeconds`, label, `Cooldown must be a whole number between 0 and ${MAX_SECONDS}.`);
  }
  if (!Number.isInteger(s.failureSensorResetSeconds) || s.failureSensorResetSeconds < 0 || s.failureSensorResetSeconds > MAX_SECONDS) {
    issues.add(`${path}.failureSensorResetSeconds`, label, `Failure sensor reset must be a whole number between 0 and ${MAX_SECONDS}.`);
  }
  if (s.actions.length === 0) {
    // A new switch has no action field to touch yet; the name is the field the user fills in first.
    issues.add(`${path}.actions`, label, 'Add at least one action.', [`${path}.name`]);
  }
  s.actions.forEach((action, k) => checkAction(issues, config, action, `${path}.actions[${k}]`, `${label}, action ${k + 1}`));
}

export function validate(config: UiConfig): UiIssue[] {
  const issues = new Issues();
  if (!config.name.trim()) {
    issues.add('name', 'Settings', 'Platform name is required.');
  }
  if (!isCountry(config.defaultCountry)) {
    issues.add('defaultCountry', 'Settings', 'Default country is not a known country code.');
  }
  if (config.masterSwitch.enabled) {
    checkHapName(issues, config.masterSwitch.name, 'masterSwitch.name', 'Settings');
  }

  // No providers or no switches is valid (a fresh install, or after Reset plugin to fresh install); startup then registers nothing.
  const providerIds = new Map<string, string>();
  config.providers.forEach((p, i) => checkProvider(issues, p, i, providerIds));

  const groupIds = new Map<string, string>();
  config.groups.forEach((g, i) => checkGroup(issues, g, i, groupIds));

  const switchIds = new Set<string>();
  const switchNames = new Map<string, string>();
  config.switches.forEach((s, i) => checkSwitch(issues, config, s, i, switchIds, switchNames));

  return issues.list;
}
