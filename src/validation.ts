import { DIAL_CODES, normalizePhone } from './countries.js';
import type { PluginLogger } from './logging.js';
import {
  COUNTRY_PATTERN, DISPLAY_NAME_PATTERN, EMAIL_PATTERN, HAP_NAME_MAX_LENGTH, HAP_NAME_PATTERN, NTFY_MAX_TAGS, NTFY_TAG_PATTERN, NTFY_TOPIC_PATTERN,
  SLUG_PATTERN, TELEGRAM_CHAT_ID_PATTERN, UUID_PATTERN,
} from './patterns.js';
import { CHANNEL_ACTION_LABEL, CHANNEL_ADDRESS_NOUN, uncoveredChannels } from './coverage.js';
import { loadCredentialsFile } from './credentials.js';
import { providersForChannel, servesChannel } from './defaults.js';
import type { DefaultProviders } from './defaults.js';
import { createProvider } from './providers/index.js';
import { findForbiddenKey } from './safeKeys.js';
import { MAX_ACTIONS_PER_SWITCH, MAX_ITEMS, MAX_LIST_ENTRIES, MAX_RECIPIENTS_PER_ACTION } from './settings.js';
import { stripLineBreaks } from './template.js';
import { quoteValue } from './text.js';
import type {
  ActionConfig, Channel, DateFormat, EmailIdentity, FailureMode, GroupConfig, MasterSwitchConfig, NotifySwitchConfig, NtfyAuth, NtfyPriority, Provider,
  ProviderConfig, ProviderType, ResolvedAction, ResolvedSwitch, SmtpSecurity, SwitchConfig, TelegramParseMode, TimeFormat, TwilioProviderConfig,
  ValidationIssue,
} from './types.js';
import {
  CHANNELS, DATE_FORMATS, DEFAULT_DATE_FORMAT, DEFAULT_TIME_FORMAT, FAILURE_MODES, NTFY_AUTHS, NTFY_DEFAULT_SERVER, NTFY_PRIORITIES, PROVIDER_CHANNELS,
  PROVIDER_TYPES, SMTP_SECURITIES, SUBJECT_CHANNELS, TELEGRAM_PARSE_MODES, TIME_FORMATS,
} from './types.js';

/**
 * Startup validation (SPEC section 10). Runs in code, independent of config.schema.json, and reports
 * every issue in one pass with its field path. Blocking issues mean the platform registers nothing.
 * Configuration values quoted in a message go through `quoteValue`, so a value can never shape the
 * log line it is reported on (SPEC section 12, item 12).
 */

export const DEFAULT_MASTER_SWITCH_NAME = 'Notifications Enabled';
export const DEFAULT_COUNTRY = 'US';
export const DEFAULT_FAILURE_SENSOR_RESET_SECONDS = 300;
export const MAX_COOLDOWN_SECONDS = 86400;

/** The name rule for providers and groups (SPEC section 5), as a startup warning. */
export const DISPLAY_NAME_WARNING = 'has characters that are not allowed; use letters, numbers, spaces, and punctuation, up to 64 characters';

export interface ValidationResult {
  issues: ValidationIssue[];
  /** Info-level notices, for example normalized phone numbers (SPEC section 10, last paragraph). */
  notices: string[];
  /** Present only when there are no blocking issues. */
  config?: NotifySwitchConfig;
  switches?: ResolvedSwitch[];
  /** Provider instances for every provider referenced by at least one switch, keyed by provider id. */
  providers?: Map<string, Provider>;
}

type Raw = Record<string, unknown>;

class Collector {
  readonly issues: ValidationIssue[] = [];
  readonly notices: string[] = [];

  error(path: string, message: string): void {
    this.issues.push({ path, message, level: 'error' });
  }

  warn(path: string, message: string): void {
    this.issues.push({ path, message, level: 'warning' });
  }

  notice(message: string): void {
    this.notices.push(message);
  }

  /** Re-homes issues reported relative to a nested block. */
  addPrefixed(prefix: string, issues: ValidationIssue[]): void {
    for (const issue of issues) {
      this.issues.push({ ...issue, path: issue.path ? `${prefix}.${issue.path}` : prefix });
    }
  }

  get hasErrors(): boolean {
    return this.issues.some((issue) => issue.level === 'error');
  }
}

// ---- Small typed readers ----------------------------------------------------

function isRaw(value: unknown): value is Raw {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readString(c: Collector, obj: Raw, key: string, path: string, opts: { required?: boolean; default?: string } = {}): string | undefined {
  const value = obj[key];
  if (value === undefined || value === null || (typeof value === 'string' && value.trim() === '')) {
    if (opts.required) {
      c.error(`${path}.${key}`, 'is required');
      return undefined;
    }
    return opts.default;
  }
  if (typeof value !== 'string') {
    c.error(`${path}.${key}`, 'must be a string');
    return undefined;
  }
  return value.trim();
}

function readBoolean(c: Collector, obj: Raw, key: string, path: string, fallback: boolean): boolean {
  const value = obj[key];
  if (value === undefined || value === null) {
    return fallback;
  }
  if (typeof value !== 'boolean') {
    c.error(`${path}.${key}`, 'must be true or false');
    return fallback;
  }
  return value;
}

function readInteger(c: Collector, obj: Raw, key: string, path: string, opts: { fallback: number; min?: number; max?: number }): number {
  const value = obj[key];
  if (value === undefined || value === null || value === '') {
    return opts.fallback;
  }
  const num = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  if (typeof num !== 'number' || !Number.isInteger(num)) {
    c.error(`${path}.${key}`, 'must be a whole number');
    return opts.fallback;
  }
  if ((opts.min !== undefined && num < opts.min) || (opts.max !== undefined && num > opts.max)) {
    const range = opts.max !== undefined ? `between ${opts.min ?? 0} and ${opts.max}` : `at least ${opts.min}`;
    c.error(`${path}.${key}`, `must be ${range}`);
    return opts.fallback;
  }
  return num;
}

function readEnum<T extends string>(c: Collector, obj: Raw, key: string, path: string, allowed: readonly T[], fallback: T | undefined): T | undefined {
  const value = obj[key];
  if (value === undefined || value === null || value === '') {
    if (fallback === undefined) {
      c.error(`${path}.${key}`, `is required (one of ${allowed.join(', ')})`);
    }
    return fallback;
  }
  if (typeof value !== 'string' || !(allowed as readonly string[]).includes(value)) {
    c.error(`${path}.${key}`, `must be one of ${allowed.join(', ')}`);
    return fallback;
  }
  return value as T;
}

/** A list of strings, blank entries dropped, cut to `max` entries with an error past that (SPEC section 12, item 12). */
function readStringArray(c: Collector, obj: Raw, key: string, path: string, max = MAX_LIST_ENTRIES): string[] {
  const value = obj[key];
  if (value === undefined || value === null) {
    return [];
  }
  if (!Array.isArray(value)) {
    c.error(`${path}.${key}`, 'must be a list');
    return [];
  }
  if (value.length > max) {
    c.error(`${path}.${key}`, `has ${value.length} entries; the limit is ${max}`);
  }
  const out: string[] = [];
  value.slice(0, max).forEach((item, i) => {
    if (typeof item !== 'string') {
      c.error(`${path}.${key}[${i}]`, 'must be a string');
    } else if (item.trim() !== '') {
      out.push(item.trim());
    }
  });
  return out;
}

function readEmailIdentity(c: Collector, obj: Raw, key: string, path: string): EmailIdentity | undefined {
  const value = obj[key];
  if (value === undefined || value === null) {
    return undefined;
  }
  if (!isRaw(value)) {
    c.error(`${path}.${key}`, 'must be an object with address and name');
    return undefined;
  }
  const address = readString(c, value, 'address', `${path}.${key}`);
  if (!address) {
    return undefined;
  }
  const name = readString(c, value, 'name', `${path}.${key}`);
  return { address, name: name ? stripLineBreaks(name) : undefined };
}

// ---- Helpers ----------------------------------------------------------------

function levenshtein(a: string, b: string): number {
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    let diag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const tmp = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = tmp;
    }
  }
  return prev[b.length];
}

function didYouMean(value: string, candidates: Iterable<string>): string {
  let best: string | undefined;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const candidate of candidates) {
    const distance = levenshtein(value.toLowerCase(), candidate.toLowerCase());
    if (distance < bestDistance) {
      best = candidate;
      bestDistance = distance;
    }
  }
  return best !== undefined && bestDistance <= Math.max(2, Math.floor(value.length / 3)) ? ` (did you mean ${quoteValue(best)}?)` : '';
}

function checkId(c: Collector, id: string | undefined, path: string, seen: Set<string>, kind: string): boolean {
  if (id === undefined) {
    return false;
  }
  if (!SLUG_PATTERN.test(id)) {
    c.error(`${path}.id`, 'must be lowercase letters, digits, dashes or underscores, starting with a letter or digit');
    return false;
  }
  if (seen.has(id)) {
    c.error(`${path}.id`, `duplicate ${kind} id ${quoteValue(id)}`);
    return false;
  }
  seen.add(id);
  return true;
}

/** The provider and group name rule (SPEC section 5): a warning, never an error, so an existing configuration keeps starting. */
function checkDisplayName(c: Collector, name: string | undefined, path: string): void {
  if (name !== undefined && !DISPLAY_NAME_PATTERN.test(name)) {
    c.warn(path, DISPLAY_NAME_WARNING);
  }
}

function normalizePhoneList(c: Collector, values: string[], path: string, defaultCountry: string): string[] {
  const out: string[] = [];
  values.forEach((value, i) => {
    const normalized = normalizePhone(value, defaultCountry);
    if (!normalized.value) {
      c.error(`${path}[${i}]`, `${quoteValue(value)} is not a valid phone number; use E.164 such as +16785550100`);
      return;
    }
    if (normalized.changed) {
      c.notice(`${path}[${i}]: normalized ${quoteValue(value)} to "${normalized.value}" using defaultCountry ${defaultCountry}`);
    }
    if (out.includes(normalized.value)) {
      c.warn(`${path}[${i}]`, `duplicate entry "${normalized.value}" ignored`);
      return;
    }
    out.push(normalized.value);
  });
  return out;
}

function checkList(c: Collector, values: string[], path: string, pattern: RegExp, describe: string): string[] {
  const out: string[] = [];
  values.forEach((value, i) => {
    if (!pattern.test(value)) {
      c.error(`${path}[${i}]`, `${quoteValue(value)} is not ${describe}`);
      return;
    }
    if (out.includes(value)) {
      c.warn(`${path}[${i}]`, `duplicate entry ${quoteValue(value)} ignored`);
      return;
    }
    out.push(value);
  });
  return out;
}

function normalizeAddressList(c: Collector, values: string[], path: string, channel: Channel, defaultCountry: string): string[] {
  switch (channel) {
  case 'sms':
    return normalizePhoneList(c, values, path, defaultCountry);
  case 'email':
    return checkList(c, values, path, EMAIL_PATTERN, 'a valid email address');
  case 'telegram':
    return checkList(c, values, path, TELEGRAM_CHAT_ID_PATTERN, 'a Telegram chat id (digits only, negative for group chats)');
  case 'ntfy':
    return checkList(c, values, path, NTFY_TOPIC_PATTERN, 'an ntfy topic name (letters, digits, dashes and underscores, up to 64 characters)');
  }
}

function checkHapName(c: Collector, name: string | undefined, path: string): boolean {
  if (name === undefined) {
    return false;
  }
  if (name.length > HAP_NAME_MAX_LENGTH) {
    c.error(path, `must be ${HAP_NAME_MAX_LENGTH} characters or fewer`);
    return false;
  }
  if (!HAP_NAME_PATTERN.test(name)) {
    c.error(path, 'may contain only letters, numbers, spaces and apostrophes, and must start and end with a letter or number');
    return false;
  }
  return true;
}

/** Number of addresses a group holds across every channel. */
function groupAddressCount(group: GroupConfig): number {
  return CHANNELS.reduce((sum, channel) => sum + group[channel].length, 0);
}

// ---- Section readers --------------------------------------------------------

function readProvider(
  c: Collector, rawProvider: unknown, path: string, seen: Set<string>, defaultCountry: string, storagePath: string | undefined,
): ProviderConfig | undefined {
  if (!isRaw(rawProvider)) {
    c.error(path, 'must be an object');
    return undefined;
  }
  const id = readString(c, rawProvider, 'id', path, { required: true });
  const idOk = checkId(c, id, path, seen, 'provider');
  const type = readEnum<ProviderType>(c, rawProvider, 'type', path, PROVIDER_TYPES, undefined);
  const name = readString(c, rawProvider, 'name', path, { required: true });
  checkDisplayName(c, name, `${path}.name`);
  if (!idOk || !id || !type || !name) {
    return undefined;
  }

  // SPEC section 12, item 2: keys in credentialsFile override the provider's secret fields. Read once, here.
  const credentialsFile = readString(c, rawProvider, 'credentialsFile', path);
  let raw: Raw = rawProvider;
  if (credentialsFile) {
    const loaded = loadCredentialsFile(credentialsFile, type, storagePath);
    for (const warning of loaded.warnings) {
      c.warn(`${path}.credentialsFile`, warning);
    }
    if (loaded.error) {
      c.error(`${path}.credentialsFile`, loaded.error);
    } else if (loaded.values) {
      raw = { ...rawProvider, ...loaded.values };
      c.notice(`${path}.credentialsFile: using ${Object.keys(loaded.values).join(', ')} from ${quoteValue(credentialsFile)}`);
    }
  }

  switch (type) {
  case 'twilio': {
    const messagingServiceSid = readString(c, raw, 'messagingServiceSid', path);
    return {
      id, type, name, credentialsFile,
      accountSid: readString(c, raw, 'accountSid', path, { required: true }) ?? '',
      apiKeySid: readString(c, raw, 'apiKeySid', path, { required: true }) ?? '',
      apiKeySecret: readString(c, raw, 'apiKeySecret', path, { required: true }) ?? '',
      smsSenders: normalizePhoneList(c, readStringArray(c, raw, 'smsSenders', path), `${path}.smsSenders`, defaultCountry),
      messagingServiceSid: messagingServiceSid || undefined,
      emailFrom: readEmailIdentity(c, raw, 'emailFrom', path),
    };
  }
  case 'smtp': {
    const from = readEmailIdentity(c, raw, 'from', path);
    if (!from) {
      c.error(`${path}.from.address`, 'is required');
    }
    return {
      id, type, name, credentialsFile,
      host: readString(c, raw, 'host', path, { required: true }) ?? '',
      port: readInteger(c, raw, 'port', path, { fallback: 465, min: 1, max: 65535 }),
      security: readEnum<SmtpSecurity>(c, raw, 'security', path, SMTP_SECURITIES, 'ssl') ?? 'ssl',
      username: readString(c, raw, 'username', path, { required: true }) ?? '',
      password: typeof raw.password === 'string' ? raw.password : (readString(c, raw, 'password', path, { required: true }) ?? ''),
      from: from ?? { address: '' },
    };
  }
  case 'telegram':
    return {
      id, type, name, credentialsFile,
      botToken: readString(c, raw, 'botToken', path, { required: true }) ?? '',
      parseMode: readEnum<TelegramParseMode>(c, raw, 'parseMode', path, TELEGRAM_PARSE_MODES, 'none') ?? 'none',
    };
  case 'ntfy': {
    // The provider instance validates the server URL and which credentials the auth mode needs.
    const auth = readEnum<NtfyAuth>(c, raw, 'auth', path, NTFY_AUTHS, 'none') ?? 'none';
    return {
      id, type, name, credentialsFile,
      server: readString(c, raw, 'server', path, { default: NTFY_DEFAULT_SERVER }) ?? NTFY_DEFAULT_SERVER,
      auth,
      token: readString(c, raw, 'token', path),
      username: readString(c, raw, 'username', path),
      password: typeof raw.password === 'string' && raw.password.length > 0 ? raw.password : undefined,
    };
  }
  }
}

function readGroup(c: Collector, raw: unknown, path: string, seen: Set<string>, defaultCountry: string): GroupConfig | undefined {
  if (!isRaw(raw)) {
    c.error(path, 'must be an object');
    return undefined;
  }
  const id = readString(c, raw, 'id', path, { required: true });
  const idOk = checkId(c, id, path, seen, 'group');
  const name = readString(c, raw, 'name', path, { required: true });
  checkDisplayName(c, name, `${path}.name`);
  if (!idOk || !id || !name) {
    return undefined;
  }
  return {
    id, name,
    sms: normalizeAddressList(c, readStringArray(c, raw, 'sms', path), `${path}.sms`, 'sms', defaultCountry),
    email: normalizeAddressList(c, readStringArray(c, raw, 'email', path), `${path}.email`, 'email', defaultCountry),
    telegram: normalizeAddressList(c, readStringArray(c, raw, 'telegram', path), `${path}.telegram`, 'telegram', defaultCountry),
    ntfy: normalizeAddressList(c, readStringArray(c, raw, 'ntfy', path), `${path}.ntfy`, 'ntfy', defaultCountry),
  };
}

/** ntfy tags (SPEC section 5.5, item 11): up to 8, each a short word or emoji short code. */
function readTags(c: Collector, raw: Raw, path: string): string[] {
  const tags = readStringArray(c, raw, 'tags', path, NTFY_MAX_TAGS);
  const out: string[] = [];
  tags.forEach((tag, i) => {
    if (!NTFY_TAG_PATTERN.test(tag)) {
      c.error(`${path}.tags[${i}]`, `${quoteValue(tag)} is not a tag; use letters, digits, dashes, underscores and plus signs, up to 32 characters`);
    } else if (!out.includes(tag)) {
      out.push(tag);
    }
  });
  return out;
}

function readAction(c: Collector, raw: unknown, path: string, defaultCountry: string): ActionConfig | undefined {
  if (!isRaw(raw)) {
    c.error(path, 'must be an object');
    return undefined;
  }
  const providerId = readString(c, raw, 'providerId', path, { required: true });
  const channel = readEnum<Channel>(c, raw, 'channel', path, CHANNELS, undefined);
  const body = typeof raw.body === 'string' ? raw.body : readString(c, raw, 'body', path, { required: true });
  if (!providerId || !channel || body === undefined) {
    return undefined;
  }
  const sender = readString(c, raw, 'sender', path);
  const subject = readString(c, raw, 'subject', path);
  if (sender && channel !== 'sms') {
    c.warn(`${path}.sender`, `only applies to the sms channel and is ignored for ${channel}`);
  }
  if (subject && !SUBJECT_CHANNELS.includes(channel)) {
    c.warn(`${path}.subject`, `only applies to the email and ntfy channels and is ignored for ${channel}`);
  }
  const bcc = readBoolean(c, raw, 'bcc', path, false);
  if (bcc && channel !== 'email') {
    c.warn(`${path}.bcc`, `only applies to the email channel and is ignored for ${channel}`);
  }
  const priority = readEnum<NtfyPriority>(c, raw, 'priority', path, NTFY_PRIORITIES, 'default') ?? 'default';
  const tags = readTags(c, raw, path);
  if (channel !== 'ntfy') {
    if (raw.priority !== undefined && raw.priority !== null && raw.priority !== '') {
      c.warn(`${path}.priority`, `only applies to the ntfy channel and is ignored for ${channel}`);
    }
    if (Array.isArray(raw.tags) && raw.tags.length > 0) {
      c.warn(`${path}.tags`, `only applies to the ntfy channel and is ignored for ${channel}`);
    }
  }
  return {
    providerId,
    channel,
    sender: channel === 'sms' && sender ? (normalizePhone(sender, defaultCountry).value ?? sender) : undefined,
    groups: readStringArray(c, raw, 'groups', path),
    recipients: normalizeAddressList(c, readStringArray(c, raw, 'recipients', path), `${path}.recipients`, channel, defaultCountry),
    subject: SUBJECT_CHANNELS.includes(channel) && subject ? stripLineBreaks(subject) : undefined,
    body,
    bcc: channel === 'email' && bcc ? true : undefined,
    priority: channel === 'ntfy' ? priority : undefined,
    tags: channel === 'ntfy' && tags.length > 0 ? tags : undefined,
  };
}

function readSwitch(c: Collector, raw: unknown, path: string, seenIds: Set<string>, seenNames: Set<string>, defaultCountry: string): SwitchConfig | undefined {
  if (!isRaw(raw)) {
    c.error(path, 'must be an object');
    return undefined;
  }
  const id = readString(c, raw, 'id', path, { required: true });
  let idOk = id !== undefined;
  if (id !== undefined) {
    const key = id.toLowerCase();
    if (!UUID_PATTERN.test(id)) {
      c.error(`${path}.id`, 'must be a UUID such as 6f1c2a9e-2b1c-4b8f-9d1e-0c5a1e2f3a4b');
      idOk = false;
    } else if (seenIds.has(key)) {
      c.error(`${path}.id`, `duplicate switch id ${quoteValue(id)}`);
      idOk = false;
    } else {
      seenIds.add(key);
    }
  }
  const name = readString(c, raw, 'name', path, { required: true });
  let nameOk = checkHapName(c, name, `${path}.name`);
  if (nameOk && name) {
    if (seenNames.has(name)) {
      c.error(`${path}.name`, `duplicate switch name "${name}"`);
      nameOk = false;
    } else {
      seenNames.add(name);
    }
  }

  const rawActions = raw.actions;
  const actions: ActionConfig[] = [];
  if (!Array.isArray(rawActions) || rawActions.length === 0) {
    c.error(`${path}.actions`, 'must contain at least one action');
  } else {
    if (rawActions.length > MAX_ACTIONS_PER_SWITCH) {
      c.error(`${path}.actions`, `has ${rawActions.length} actions; the limit is ${MAX_ACTIONS_PER_SWITCH}`);
    }
    rawActions.slice(0, MAX_ACTIONS_PER_SWITCH).forEach((item, i) => {
      const action = readAction(c, item, `${path}.actions[${i}]`, defaultCountry);
      if (action) {
        actions.push(action);
      }
    });
  }

  // Keep going even when id or name is invalid so every issue in the actions is reported in the same pass.
  // The collector already holds an error, so nothing will be registered.
  return {
    id: idOk && id ? id.toLowerCase() : (id ?? ''),
    name: nameOk && name ? name : (name ?? ''),
    enabled: readBoolean(c, raw, 'enabled', path, true),
    cooldownSeconds: readInteger(c, raw, 'cooldownSeconds', path, { fallback: 0, min: 0, max: MAX_COOLDOWN_SECONDS }),
    failureMode: readEnum<FailureMode>(c, raw, 'failureMode', path, FAILURE_MODES, 'any') ?? 'any',
    failureSensor: readBoolean(c, raw, 'failureSensor', path, false),
    failureSensorResetSeconds: readInteger(c, raw, 'failureSensorResetSeconds', path, {
      fallback: DEFAULT_FAILURE_SENSOR_RESET_SECONDS, min: 0, max: MAX_COOLDOWN_SECONDS,
    }),
    actions,
  };
}

// ---- Cross references -------------------------------------------------------

interface SenderResolution {
  sender?: string;
  ok: boolean;
}

function resolveSmsSender(c: Collector, action: ActionConfig, provider: TwilioProviderConfig, path: string): SenderResolution {
  const senders = provider.smsSenders;
  if (action.sender) {
    if (senders.includes(action.sender)) {
      return { sender: action.sender, ok: true };
    }
    if (senders.length === 1) {
      c.warn(`${path}.sender`, `${quoteValue(action.sender)} is not in provider "${provider.id}" smsSenders; using its only sender ${senders[0]}`);
      return { sender: senders[0], ok: true };
    }
    c.error(`${path}.sender`, `${quoteValue(action.sender)} is not one of provider "${provider.id}" smsSenders`);
    return { ok: false };
  }
  if (senders.length === 1) {
    return { sender: senders[0], ok: true };
  }
  if (provider.messagingServiceSid) {
    return { sender: undefined, ok: true };
  }
  if (senders.length === 0) {
    c.error(`${path}.providerId`, `provider "${provider.id}" has no smsSenders and no messagingServiceSid, so it cannot send sms`);
  } else {
    c.error(`${path}.sender`, `is required because provider "${provider.id}" has ${senders.length} smsSenders and no messagingServiceSid`);
  }
  return { ok: false };
}

async function resolveSwitch(
  c: Collector,
  sw: SwitchConfig,
  path: string,
  providers: Map<string, ProviderConfig>,
  providerInstances: Map<string, Provider>,
  groups: Map<string, GroupConfig>,
  usedProviders: Set<string>,
  referencedGroups: Set<string>,
): Promise<ResolvedSwitch> {
  const actions: ResolvedAction[] = [];
  for (const [index, action] of sw.actions.entries()) {
    const actionPath = `${path}.actions[${index}]`;
    const providerConfig = providers.get(action.providerId);
    if (!providerConfig) {
      c.error(`${actionPath}.providerId`, `no provider with id ${quoteValue(action.providerId)}${didYouMean(action.providerId, providers.keys())}`);
      continue;
    }
    usedProviders.add(providerConfig.id);

    if (!PROVIDER_CHANNELS[providerConfig.type].includes(action.channel)) {
      c.error(`${actionPath}.channel`, `provider "${providerConfig.id}" is type ${providerConfig.type}, which does not serve the ${action.channel} channel`);
      continue;
    }

    const provider = providerInstances.get(providerConfig.id);
    if (provider) {
      c.addPrefixed(actionPath, provider.validateBody(action.channel, action.body));
    }

    let sender: string | undefined;
    if (providerConfig.type === 'twilio') {
      if (action.channel === 'sms') {
        const resolution = resolveSmsSender(c, action, providerConfig, actionPath);
        if (!resolution.ok) {
          continue;
        }
        sender = resolution.sender;
      } else if (!providerConfig.emailFrom) {
        c.error(`${actionPath}.channel`,
          `provider "${providerConfig.id}" cannot send email until emailFrom.address is set on it (the domain must be authenticated in the Twilio Console)`);
        continue;
      }
    }

    const recipients: string[] = [];
    for (const [g, groupId] of action.groups.entries()) {
      const group = groups.get(groupId);
      if (!group) {
        c.error(`${actionPath}.groups[${g}]`, `no group with id ${quoteValue(groupId)}${didYouMean(groupId, groups.keys())}`);
        continue;
      }
      referencedGroups.add(group.id);
      const list = group[action.channel];
      if (list.length === 0 && groupAddressCount(group) > 0) {
        c.warn(`${actionPath}.groups[${g}]`, `group "${group.id}" has no ${action.channel} addresses`);
      }
      for (const address of list) {
        if (!recipients.includes(address)) {
          recipients.push(address);
        }
      }
    }
    for (const address of action.recipients) {
      if (!recipients.includes(address)) {
        recipients.push(address);
      }
    }
    if (recipients.length === 0) {
      c.error(actionPath, `no recipients resolve for ${action.channel}; add a group with ${action.channel} addresses or list recipients directly`);
    } else if (recipients.length > MAX_RECIPIENTS_PER_ACTION) {
      c.error(actionPath, `resolves to ${recipients.length} recipients; the limit is ${MAX_RECIPIENTS_PER_ACTION} per action`);
    }

    actions.push({
      index,
      providerId: providerConfig.id,
      channel: action.channel,
      sender,
      recipients,
      subject: SUBJECT_CHANNELS.includes(action.channel) ? (action.subject ?? sw.name) : undefined,
      body: action.body,
      bcc: action.channel === 'email' && action.bcc ? true : undefined,
      priority: action.channel === 'ntfy' ? (action.priority ?? 'default') : undefined,
      tags: action.channel === 'ntfy' ? action.tags : undefined,
    });
  }

  // Once per switch and channel: people in a targeted group whose channel no action sends on (SPEC section 10 warnings).
  for (const uncovered of uncoveredChannels(sw.actions, [...groups.values()])) {
    const list = uncovered.groups.map((id) => `"${id}"`).join(', ');
    c.warn(path, `switch "${sw.name}" sends to ${uncovered.groups.length === 1 ? 'group' : 'groups'} ${list} with ${CHANNEL_ADDRESS_NOUN[uncovered.channel]} `
      + `but has no ${CHANNEL_ACTION_LABEL[uncovered.channel]} action; those recipients will not receive anything`);
  }
  return { ...sw, actions };
}

// ---- Platform defaults (SPEC section 5.7) ------------------------------------

function readDefaultProviders(c: Collector, raw: Raw, root: string, providers: Map<string, ProviderConfig>): DefaultProviders {
  const out: DefaultProviders = {};
  const value = raw.defaultProviders;
  if (value !== undefined && value !== null) {
    if (!isRaw(value)) {
      c.error(`${root}.defaultProviders`, 'must be an object mapping a channel (sms, email, telegram, ntfy) to a provider id');
    } else {
      for (const [key, entry] of Object.entries(value)) {
        const path = `${root}.defaultProviders.${key}`;
        if (!(CHANNELS as readonly string[]).includes(key)) {
          c.error(path, `${quoteValue(key)} is not a channel; use one of ${CHANNELS.join(', ')}`);
          continue;
        }
        const channel = key as Channel;
        if (entry === undefined || entry === null || entry === '') {
          continue;
        }
        if (typeof entry !== 'string' || entry.trim() === '') {
          c.error(path, 'must be a provider id');
          continue;
        }
        const id = entry.trim();
        const provider = providers.get(id);
        if (!provider) {
          c.error(path, `no provider with id ${quoteValue(id)}${didYouMean(id, providers.keys())}`);
          continue;
        }
        if (!servesChannel(provider, channel)) {
          const reason = provider.type === 'twilio' && channel === 'email'
            ? 'cannot send email until emailFrom.address is set on it'
            : `is type ${provider.type}, which does not serve the ${channel} channel`;
          c.error(path, `provider "${id}" ${reason}`);
          continue;
        }
        out[channel] = id;
      }
    }
  }
  for (const channel of CHANNELS) {
    const candidates = providersForChannel([...providers.values()], channel);
    if (candidates.length > 1 && !out[channel]) {
      c.warn(`${root}.defaultProviders.${channel}`,
        `${candidates.length} providers can send ${channel} and none is the default; switches that do not name one use "${candidates[0].id}", `
        + 'the first in config order. Choose a default under Settings');
    }
  }
  return out;
}

// ---- Entry point ------------------------------------------------------------

/** Reads one of the three top-level lists, cut to `MAX_ITEMS` with an error past that. */
function readList(c: Collector, raw: Raw, key: string): unknown[] | undefined {
  const value = raw[key];
  if (value === undefined || value === null) {
    return undefined;
  }
  if (!Array.isArray(value)) {
    c.error(key, 'must be a list');
    return undefined;
  }
  if (value.length > MAX_ITEMS) {
    c.error(key, `has ${value.length} entries; the limit is ${MAX_ITEMS}`);
    return value.slice(0, MAX_ITEMS);
  }
  return value;
}

async function validateInner(c: Collector, rawConfig: unknown, log: PluginLogger, options: ValidateOptions): Promise<ValidationResult> {
  if (!isRaw(rawConfig)) {
    c.error('', 'platform configuration is missing');
    return { issues: c.issues, notices: c.notices };
  }
  // A key named __proto__, constructor or prototype anywhere in the block is never accepted (SPEC section 12, item 12).
  const forbidden = findForbiddenKey(rawConfig);
  if (forbidden !== undefined) {
    c.error(forbidden, 'is not an allowed key name');
    return { issues: c.issues, notices: c.notices };
  }
  const raw = rawConfig;
  const root = 'platform';

  const name = readString(c, raw, 'name', root, { required: true }) ?? 'Notify Switch';
  // Homebridge prefixes every log line with this name, so it follows the same rule as provider and group names.
  checkDisplayName(c, name, `${root}.name`);
  const configVersion = readInteger(c, raw, 'configVersion', root, { fallback: 1, min: 1, max: 1 });
  let defaultCountry = (readString(c, raw, 'defaultCountry', root, { default: DEFAULT_COUNTRY }) ?? DEFAULT_COUNTRY).toUpperCase();
  if (!COUNTRY_PATTERN.test(defaultCountry) || !DIAL_CODES[defaultCountry]) {
    c.error(`${root}.defaultCountry`, `${quoteValue(defaultCountry)} is not a known ISO 3166-1 alpha-2 country code`);
    defaultCountry = DEFAULT_COUNTRY;
  }
  // Time and date formats (SPEC section 5.1): closed enums; a missing value means the default and an invalid one is
  // an error that falls back to the default for the rest of the pass, exactly like defaultCountry above.
  const timeFormat = readEnum<TimeFormat>(c, raw, 'timeFormat', root, TIME_FORMATS, DEFAULT_TIME_FORMAT) ?? DEFAULT_TIME_FORMAT;
  const dateFormat = readEnum<DateFormat>(c, raw, 'dateFormat', root, DATE_FORMATS, DEFAULT_DATE_FORMAT) ?? DEFAULT_DATE_FORMAT;
  const debug = readBoolean(c, raw, 'debug', root, false);
  log.debugEnabled = debug;

  let masterSwitch: MasterSwitchConfig = { enabled: true, name: DEFAULT_MASTER_SWITCH_NAME };
  if (raw.masterSwitch !== undefined && raw.masterSwitch !== null) {
    if (!isRaw(raw.masterSwitch)) {
      c.error(`${root}.masterSwitch`, 'must be an object');
    } else {
      const msName = readString(c, raw.masterSwitch, 'name', `${root}.masterSwitch`, { default: DEFAULT_MASTER_SWITCH_NAME }) ?? DEFAULT_MASTER_SWITCH_NAME;
      checkHapName(c, msName, `${root}.masterSwitch.name`);
      masterSwitch = { enabled: readBoolean(c, raw.masterSwitch, 'enabled', `${root}.masterSwitch`, true), name: msName };
    }
  }

  // Providers
  const providerConfigs = new Map<string, ProviderConfig>();
  const providerIds = new Set<string>();
  const rawProviders = readList(c, raw, 'providers');
  if (!rawProviders || rawProviders.length === 0) {
    // Not an error: a fresh install or a reset configuration has no providers (SPEC section 10).
    c.warn('providers', 'no providers configured');
  } else {
    rawProviders.forEach((item, i) => {
      const provider = readProvider(c, item, `providers[${i}]`, providerIds, defaultCountry, options.storagePath);
      if (provider) {
        providerConfigs.set(provider.id, provider);
      }
    });
  }

  // Platform defaults per channel (SPEC section 5.7): every entry must name a provider that serves its channel; a
  // channel with several providers and no entry falls back to the first in configuration order with a warning.
  const defaultProviders = readDefaultProviders(c, raw, root, providerConfigs);

  const providerInstances = new Map<string, Provider>();
  const providerPaths = new Map<string, string>();
  for (const [i, item] of (rawProviders ?? []).entries()) {
    const id = isRaw(item) && typeof item.id === 'string' ? item.id.trim() : undefined;
    const config = id ? providerConfigs.get(id) : undefined;
    if (!config) {
      continue;
    }
    const path = `providers[${i}]`;
    providerPaths.set(config.id, path);
    try {
      const instance = await createProvider(config, log);
      c.addPrefixed(path, instance.validateConfig());
      providerInstances.set(config.id, instance);
    } catch (err) {
      c.error(path, `could not load the ${config.type} provider: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // Groups
  const groups = new Map<string, GroupConfig>();
  const groupPaths = new Map<string, string>();
  const groupIds = new Set<string>();
  const rawGroups = readList(c, raw, 'groups');
  if (rawGroups) {
    rawGroups.forEach((item, i) => {
      const group = readGroup(c, item, `groups[${i}]`, groupIds, defaultCountry);
      if (group) {
        groups.set(group.id, group);
        groupPaths.set(group.id, `groups[${i}]`);
      }
    });
  }

  // Switches
  const switchConfigs: Array<{ config: SwitchConfig; path: string }> = [];
  const switchIds = new Set<string>();
  const switchNames = new Set<string>();
  const rawSwitches = readList(c, raw, 'switches');
  if (!rawSwitches || rawSwitches.length === 0) {
    // Valid, with nothing to register: startup removes every cached accessory (SPEC section 4, item 9).
    c.warn('switches', 'no switches configured; every cached accessory will be removed');
  } else {
    rawSwitches.forEach((item, i) => {
      const sw = readSwitch(c, item, `switches[${i}]`, switchIds, switchNames, defaultCountry);
      if (sw) {
        switchConfigs.push({ config: sw, path: `switches[${i}]` });
      }
    });
  }

  // Cross references
  const usedProviders = new Set<string>();
  const referencedGroups = new Set<string>();
  const switches: ResolvedSwitch[] = [];
  for (const { config, path } of switchConfigs) {
    switches.push(await resolveSwitch(c, config, path, providerConfigs, providerInstances, groups, usedProviders, referencedGroups));
  }

  for (const [id, group] of groups) {
    if (referencedGroups.has(id) && groupAddressCount(group) === 0) {
      c.warn(groupPaths.get(id) ?? 'groups', `group "${id}" has no addresses`);
    }
  }
  for (const [id, path] of providerPaths) {
    if (!usedProviders.has(id)) {
      c.warn(path, `provider "${id}" is not used by any switch`);
    }
  }

  if (c.hasErrors) {
    return { issues: c.issues, notices: c.notices };
  }

  const providers = new Map<string, Provider>();
  for (const id of usedProviders) {
    const instance = providerInstances.get(id);
    if (instance) {
      providers.set(id, instance);
    }
  }

  const config: NotifySwitchConfig = {
    name,
    configVersion,
    defaultCountry,
    timeFormat,
    dateFormat,
    masterSwitch,
    debug,
    defaultProviders,
    providers: [...providerConfigs.values()],
    groups: [...groups.values()],
    switches: switchConfigs.map((entry) => entry.config),
  };
  return { issues: c.issues, notices: c.notices, config, switches, providers };
}

export interface ProviderValidationResult {
  issues: ValidationIssue[];
  /** Present only when the provider block has no blocking issues. */
  config?: ProviderConfig;
  provider?: Provider;
}

/**
 * Validates one provider block on its own, for the settings UI's Test connection, lookups and Find people and groups
 * (SPEC section 11.2, items 3 and 5). Applies `credentialsFile` the same way startup does. Never throws.
 */
export async function validateProvider(rawProvider: unknown, log: PluginLogger, options: ValidateOptions = {}): Promise<ProviderValidationResult> {
  const c = new Collector();
  try {
    const forbidden = findForbiddenKey(rawProvider, 'provider');
    if (forbidden !== undefined) {
      c.error(forbidden, 'is not an allowed key name');
      return { issues: c.issues };
    }
    const config = readProvider(c, rawProvider, 'provider', new Set(), DEFAULT_COUNTRY, options.storagePath);
    if (!config || c.hasErrors) {
      return { issues: c.issues };
    }
    const provider = await createProvider(config, log);
    c.addPrefixed('provider', provider.validateConfig());
    if (c.hasErrors) {
      return { issues: c.issues };
    }
    return { issues: c.issues, config, provider };
  } catch (err) {
    c.error('provider', `unexpected error while validating the provider: ${err instanceof Error ? err.message : String(err)}`);
    return { issues: c.issues };
  }
}

export interface ValidateOptions {
  /** Homebridge storage directory; relative `credentialsFile` paths are resolved against it. */
  storagePath?: string;
}

/**
 * Validates and normalizes the platform block. Never throws.
 */
export async function validateConfig(rawConfig: unknown, log: PluginLogger, options: ValidateOptions = {}): Promise<ValidationResult> {
  const c = new Collector();
  try {
    return await validateInner(c, rawConfig, log, options);
  } catch (err) {
    c.error('', `unexpected error while validating configuration: ${err instanceof Error ? err.message : String(err)}`);
    return { issues: c.issues, notices: c.notices };
  }
}
