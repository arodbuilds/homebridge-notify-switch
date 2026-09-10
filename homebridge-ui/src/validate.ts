import { firstNonGsm7Character, SMS_MAX_LENGTH } from '../../src/gsm7.js';
import {
  ACCOUNT_SID_PATTERN, API_KEY_SID_PATTERN, BOT_TOKEN_PATTERN, DISPLAY_NAME_PATTERN, E164_PATTERN, EMAIL_PATTERN, HAP_NAME_MAX_LENGTH,
  HAP_NAME_PATTERN, MESSAGING_SERVICE_SID_PATTERN, NTFY_MAX_TAGS, NTFY_TAG_PATTERN, NTFY_TOPIC_PATTERN, SLUG_PATTERN, TELEGRAM_CHAT_ID_PATTERN,
  UUID_PATTERN,
} from '../../src/patterns.js';
import { CHANNELS, DATE_FORMATS, TIME_FORMATS } from '../../src/types.js';
import type { Channel } from '../../src/types.js';
import { defaultNeeded, providersForChannel, servesChannel } from '../../src/defaults.js';
import { DEFAULTS, VALIDATION } from './copy.js';
import { isCountry } from './phone.js';
import { channelRecipients, channelUnserved, enabledChannels, presentChannels, switchProviderId } from './model.js';
import type { UiConfig, UiGroup, UiProvider, UiSwitch } from './model.js';

/**
 * Client-side validation mirroring startup validation (SPEC section 10) so the Save button is
 * disabled while the configuration would fail at startup. Each issue carries the field path (for
 * inline marking) and a readable label for the issue list.
 */

export interface UiIssue {
  path: string;
  label: string;
  message: string;
  /** A warning is listed in the summary box but never disables Save or marks a field (SPEC section 11.2, item 25). */
  level?: 'warning';
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
const NTFY_MAX_LENGTH = 4096;
const MAX_SECONDS = 86400;

/** The same bounds startup validation enforces (SPEC section 12, item 12). */
const MAX_RECIPIENTS_PER_ACTION = 100;
const MAX_LIST_ENTRIES = 200;
const MAX_ACTIONS_PER_SWITCH = 20;
const MAX_ITEMS = 100;

class Issues {
  readonly list: UiIssue[] = [];

  add(path: string, label: string, message: string, related?: string[]): void {
    this.list.push(related && related.length > 0 ? { path, label, message, related } : { path, label, message });
  }

  warn(path: string, label: string, message: string): void {
    this.list.push({ path, label, message, level: 'warning' });
  }
}

/** The issues that block Save: everything but warnings. */
export function errorsOnly(issues: UiIssue[]): UiIssue[] {
  return issues.filter((issue) => issue.level !== 'warning');
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

/** Provider, group and platform names (SPEC section 5): printable characters, no angle brackets, 1 to 64 characters. */
function checkDisplayName(issues: Issues, name: string, path: string, label: string, what = 'Name'): void {
  const value = name.trim();
  if (!value) {
    issues.add(path, label, `${what} is required.`);
  } else if (!DISPLAY_NAME_PATTERN.test(value)) {
    issues.add(path, label, VALIDATION.name);
  }
}

function checkListSize(issues: Issues, values: string[], path: string, label: string, what: string): void {
  if (values.length > MAX_LIST_ENTRIES) {
    issues.add(path, label, `${what} has ${values.length} entries; the limit is ${MAX_LIST_ENTRIES}.`);
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
  case 'ntfy':
    if (!NTFY_TOPIC_PATTERN.test(text)) {
      issues.add(path, label, VALIDATION.ntfyTopic(text));
      return false;
    }
    return true;
  }
}

/** True when `value` is an http or https URL without credentials, query or fragment. */
function isServerUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (url.protocol === 'http:' || url.protocol === 'https:') && !url.username && !url.password && !url.search && !url.hash;
  } catch {
    return false;
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
  checkDisplayName(issues, p.name, `${path}.name`, label);
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
    checkListSize(issues, p.smsSenders, `${path}.smsSenders`, label, 'SMS senders');
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
  case 'ntfy':
    if (!isServerUrl(p.server.trim())) {
      issues.add(`${path}.server`, label, VALIDATION.ntfyServer);
    }
    if (p.auth === 'token' && !fromFile && !p.token.trim()) {
      issues.add(`${path}.token`, label, 'Access token is required.');
    }
    if (p.auth === 'basic') {
      if (!fromFile && !p.username.trim()) {
        issues.add(`${path}.username`, label, 'Username is required.');
      } else if (p.username.includes(':')) {
        issues.add(`${path}.username`, label, 'Username must not contain a colon.');
      }
      if (!fromFile && !p.password) {
        issues.add(`${path}.password`, label, 'Password is required.');
      }
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
  checkDisplayName(issues, g.name, `${path}.name`, label);
  const what: Record<Channel, string> = { sms: 'Phone number', email: 'Email', telegram: 'Chat ID', ntfy: 'Topic' };
  for (const channel of CHANNELS) {
    checkListSize(issues, g[channel], `${path}.${channel}`, label, `The ${channel} list`);
    g[channel].forEach((value, k) => {
      if (value.trim()) {
        checkAddress(issues, channel, value, `${path}.${channel}[${k}]`, label, what[channel]);
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
  case 'ntfy':
    if (length > NTFY_MAX_LENGTH) {
      issues.add(path, label, `ntfy message is ${length} characters; the limit is ${NTFY_MAX_LENGTH}.`);
    }
    break;
  }
}

/** ntfy tags (SPEC section 5.5, item 11): at most 8, each a short word or emoji short code. */
function checkTags(issues: Issues, tags: string[], path: string, label: string): void {
  const values = tags.map((tag) => tag.trim()).filter((tag) => tag.length > 0);
  if (values.length > NTFY_MAX_TAGS) {
    issues.add(path, label, VALIDATION.ntfyTags);
    return;
  }
  const bad = values.find((tag) => !NTFY_TAG_PATTERN.test(tag));
  if (bad !== undefined) {
    issues.add(path, label, VALIDATION.ntfyTag(bad));
  }
}

function checkSwitchProvider(issues: Issues, config: UiConfig, s: UiSwitch, channel: Channel, path: string, label: string): void {
  const providerId = switchProviderId(s, channel, config);
  const provider = config.providers.find((p) => p.id.trim() === providerId && providerId);
  const field = `${path}.providers.${channel}`;
  if (!provider) {
    issues.add(field, label, providerId ? VALIDATION.missingProvider(providerId) : VALIDATION.noProvider(channel));
    return;
  }
  const name = provider.name.trim() || provider.id;
  if (!servesChannel(provider, channel)) {
    if (provider.type === 'twilio' && channel === 'email') {
      issues.add(field, label, VALIDATION.twilioEmailFrom(name));
    } else {
      issues.add(field, label, VALIDATION.wrongProvider(name, provider.type, channel));
    }
    return;
  }
  if (provider.type === 'twilio' && channel === 'sms') {
    const senders = provider.smsSenders.map((v) => v.trim()).filter((v) => v.length > 0);
    const service = provider.messagingServiceSid.trim().length > 0;
    if (s.sender) {
      if (!senders.includes(s.sender)) {
        issues.add(`${path}.sender`, label, `Sender ${s.sender} is not one of the provider's SMS senders.`, [field]);
      }
    } else if (senders.length === 0 && !service) {
      issues.add(`${path}.sender`, label, `Provider "${name}" needs an SMS sender or a Messaging Service SID to send SMS.`, [field]);
    } else if (senders.length > 1 && !service) {
      issues.add(`${path}.sender`, label, 'Choose a sender: the provider has more than one SMS sender.', [field]);
    }
  }
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

  // Recipients: every ticked group must exist; extra addresses are checked under their channel.
  for (const id of s.groups) {
    if (!config.groups.some((g) => g.id.trim() === id && id)) {
      issues.add(`${path}.groups`, label, VALIDATION.missingGroup(id));
    }
  }
  const what: Record<Channel, string> = { sms: 'Phone number', email: 'Email', telegram: 'Chat ID', ntfy: 'Topic' };
  for (const channel of CHANNELS) {
    checkListSize(issues, s.recipients[channel], `${path}.recipients.${channel}`, label, 'The extra recipients list');
    s.recipients[channel].forEach((value, r) => {
      if (value.trim()) {
        checkAddress(issues, channel, value, `${path}.recipients.${channel}[${r}]`, label, what[channel]);
      }
    });
  }

  // Send by: at least one channel, each enabled one reaching somebody (SPEC section 12, item 12 for the bound).
  const present = presentChannels(config, s);
  const enabled = enabledChannels(s, config);
  const recipientLists = [`${path}.recipients.sms`, `${path}.recipients.email`, `${path}.recipients.telegram`, `${path}.recipients.ntfy`];
  if (present.length === 0) {
    // A new switch has nothing ticked yet; the name is the field the user fills in first.
    issues.add(`${path}.groups`, label, VALIDATION.noRecipients, [`${path}.name`, ...recipientLists]);
  } else if (enabled.length === 0) {
    issues.add(`${path}.channels`, label, VALIDATION.noChannels, [`${path}.groups`]);
  }
  if (enabled.length > MAX_ACTIONS_PER_SWITCH) {
    issues.add(`${path}.channels`, label, `A switch can have at most ${MAX_ACTIONS_PER_SWITCH} actions.`);
  }
  for (const channel of enabled) {
    const recipients = channelRecipients(config, s, channel);
    if (recipients.size > MAX_RECIPIENTS_PER_ACTION) {
      issues.add(`${path}.channels.${channel}`, label, VALIDATION.tooMany(channel, recipients.size, MAX_RECIPIENTS_PER_ACTION),
        [`${path}.groups`, `${path}.recipients.${channel}`]);
    }
    if (channelUnserved(config, channel)) {
      // A stored action whose channel no provider serves any more (SPEC section 11.2, item 8): kept, and blocking
      // Save as it would block startup, until a provider is added or the channel is unticked.
      issues.add(`${path}.channels.${channel}`, label, VALIDATION.noProviderForChannel(channel));
      continue;
    }
    checkSwitchProvider(issues, config, s, channel, path, label);
  }

  // Message: the shared body against every enabled channel's rules, or each channel's own body.
  if (s.customize) {
    for (const channel of enabled) {
      checkBody(issues, channel, s.bodies[channel], `${path}.bodies.${channel}`, label);
    }
  } else if (enabled.length > 0) {
    const before = issues.list.length;
    for (const channel of enabled) {
      checkBody(issues, channel, s.body, `${path}.body`, label);
      if (issues.list.length > before) {
        break;
      }
    }
  }
  if (enabled.includes('ntfy')) {
    checkTags(issues, s.tags, `${path}.tags`, label);
  }
}

/** The providers whose cards have no error, in configuration order: the ones the default provider rules count. */
export function validProviders(config: UiConfig, issues: UiIssue[]): UiProvider[] {
  return config.providers.filter((_, i) => !issues.some((issue) => issue.path === `providers[${i}]` || issue.path.startsWith(`providers[${i}].`)));
}

/**
 * Platform defaults (SPEC section 5.7): a channel with several validated providers and no default is a warning,
 * never an error. A provider still being filled in does not count, so the warning appears when its prompt does.
 */
function checkDefaults(issues: Issues, config: UiConfig): void {
  const providers = validProviders(config, issues.list);
  for (const channel of CHANNELS) {
    if (providersForChannel(providers, channel).length > 1 && defaultNeeded(channel, providers, config.defaultProviders)) {
      issues.warn(`defaultProviders.${channel}`, 'Settings', DEFAULTS.warning(channel));
    }
  }
}

export function validate(config: UiConfig): UiIssue[] {
  const issues = new Issues();
  // Homebridge prefixes every log line with the platform name, so it follows the provider and group name rule.
  checkDisplayName(issues, config.name, 'name', 'Settings', 'Platform name');
  if (!isCountry(config.defaultCountry)) {
    issues.add('defaultCountry', 'Settings', 'Default country is not a known country code.');
  }
  // Closed enums (SPEC section 5.1): the model already falls back to the defaults, so this only ever fires on a value set by hand.
  if (!(TIME_FORMATS as readonly string[]).includes(config.timeFormat)) {
    issues.add('timeFormat', 'Settings', 'Time format must be 12-hour or 24-hour.');
  }
  if (!(DATE_FORMATS as readonly string[]).includes(config.dateFormat)) {
    issues.add('dateFormat', 'Settings', 'Date format must be Month/Day/Year, Day/Month/Year or Year-Month-Day.');
  }
  if (config.masterSwitch.enabled) {
    checkHapName(issues, config.masterSwitch.name, 'masterSwitch.name', 'Settings');
  }

  // No providers or no switches is valid (a fresh install, or after Reset plugin to fresh install); startup then registers nothing.
  for (const [key, what] of [['providers', 'providers'], ['groups', 'groups'], ['switches', 'switches']] as const) {
    if (config[key].length > MAX_ITEMS) {
      issues.add(key, 'Settings', `At most ${MAX_ITEMS} ${what} are allowed.`);
    }
  }
  const providerIds = new Map<string, string>();
  config.providers.forEach((p, i) => checkProvider(issues, p, i, providerIds));

  const groupIds = new Map<string, string>();
  config.groups.forEach((g, i) => checkGroup(issues, g, i, groupIds));

  const switchIds = new Set<string>();
  const switchNames = new Map<string, string>();
  config.switches.forEach((s, i) => checkSwitch(issues, config, s, i, switchIds, switchNames));

  checkDefaults(issues, config);
  return issues.list;
}
