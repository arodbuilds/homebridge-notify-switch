import type { Channel, DateFormat, FailureMode, NtfyAuth, NtfyPriority, ProviderType, SmtpSecurity, TelegramParseMode, TimeFormat } from '../../src/types.js';
import {
  CHANNELS, CREDENTIAL_KEYS, DATE_FORMATS, DEFAULT_DATE_FORMAT, DEFAULT_TIME_FORMAT, FAILURE_MODES, NTFY_AUTHS, NTFY_DEFAULT_SERVER, NTFY_PRIORITIES,
  PROVIDER_TYPES, SMTP_SECURITIES, SUBJECT_CHANNELS, TELEGRAM_PARSE_MODES, TIME_FORMATS,
} from '../../src/types.js';
import { findForbiddenKey, FORBIDDEN_KEYS } from '../../src/safeKeys.js';
import { providersForChannel, pruneDefaults, resolveDefaultProvider } from '../../src/defaults.js';
import type { DefaultProviders } from '../../src/defaults.js';

/**
 * The configuration object the settings UI edits. It is the platform block from config.json with
 * every known field present (defaults filled in) so the sections can bind inputs to it directly.
 * Unknown top-level keys are preserved (except `__proto__`, `constructor` and `prototype`, which are
 * never carried); unknown keys inside providers, groups and switches are dropped.
 */

export interface UiEmailIdentity {
  address: string;
  name: string;
}

export interface UiProvider {
  id: string;
  type: ProviderType;
  name: string;
  credentialsFile: string;
  // twilio
  accountSid: string;
  apiKeySid: string;
  apiKeySecret: string;
  smsSenders: string[];
  messagingServiceSid: string;
  emailFrom: UiEmailIdentity;
  // smtp (username and password are shared with ntfy's basic auth)
  host: string;
  port: number;
  security: SmtpSecurity;
  username: string;
  password: string;
  from: UiEmailIdentity;
  /** Mail provider preset key, kept for redisplay only (SPEC section 11.2, item 22); '' means Other. */
  smtpPreset: string;
  // telegram
  botToken: string;
  parseMode: TelegramParseMode;
  // ntfy
  server: string;
  auth: NtfyAuth;
  token: string;
}

export interface UiGroup {
  id: string;
  name: string;
  sms: string[];
  email: string[];
  telegram: string[];
  ntfy: string[];
}

export interface UiAction {
  providerId: string;
  channel: Channel;
  sender: string;
  groups: string[];
  recipients: string[];
  /** Email subject, or the ntfy title. */
  subject: string;
  body: string;
  /** Email only: hide recipients from each other (SPEC section 6.2 and 6.3). */
  bcc: boolean;
  /** ntfy only. */
  priority: NtfyPriority;
  /** ntfy only. */
  tags: string[];
}

/**
 * The switch as the editor shows it (SPEC section 11.2, item 8): one set of recipients, a checkbox per
 * channel, one message, and the per-channel details under Advanced. config.json keeps the `actions`
 * array; `readSwitch` derives this shape from it and `switchActions` writes it back, one action per
 * enabled channel (SPEC section 5.4).
 */
export interface UiSwitch {
  id: string;
  name: string;
  enabled: boolean;
  cooldownSeconds: number;
  failureMode: FailureMode;
  failureSensor: boolean;
  failureSensorResetSeconds: number;
  /** Recipients: the groups every channel sends to. */
  groups: string[];
  /** Recipients: extra addresses per channel, on top of the groups. */
  recipients: Record<Channel, string[]>;
  /** Send by: true for a channel the switch sends on (an action exists for it). */
  channels: Record<Channel, boolean>;
  /** The channel order of the stored actions, so a saved configuration is written back in its own order. */
  order: Channel[];
  /** The shared message and subject, used while `customize` is off. */
  body: string;
  subject: string;
  /** Customize message per channel: each channel has its own body (and, for email and ntfy, subject). */
  customize: boolean;
  bodies: Record<Channel, string>;
  subjects: Record<Channel, string>;
  /** Per-channel provider override; '' means the platform default (SPEC section 5.7). */
  providers: Record<Channel, string>;
  /** SMS sender override, '' for automatic (SPEC section 5.5, item 3). */
  sender: string;
  /** Email only: hide recipients from each other (SPEC section 6.2 and 6.3). */
  bcc: boolean;
  /** ntfy only. */
  priority: NtfyPriority;
  tags: string[];
}

export interface UiConfig {
  platform: string;
  name: string;
  configVersion: number;
  defaultCountry: string;
  /** How `{{time}}`, `{{date}}` and `{{datetime}}` render (SPEC section 5.1 and 5.6). */
  timeFormat: TimeFormat;
  dateFormat: DateFormat;
  masterSwitch: { enabled: boolean; name: string };
  debug: boolean;
  /** Platform defaults per channel (SPEC section 5.7); only stored for channels with more than one provider. */
  defaultProviders: DefaultProviders;
  providers: UiProvider[];
  groups: UiGroup[];
  switches: UiSwitch[];
  [extra: string]: unknown;
}

/** Bytes of a backup file, or of a stored draft, past which it is rejected without being parsed (SPEC section 12, item 12). */
export const MAX_BACKUP_BYTES = 1024 * 1024;

type Raw = Record<string, unknown>;

function isRaw(value: unknown): value is Raw {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function str(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function int(value: unknown, fallback: number): number {
  const n = typeof value === 'string' ? Number(value) : value;
  return typeof n === 'number' && Number.isInteger(n) ? n : fallback;
}

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

function list(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function identity(value: unknown): UiEmailIdentity {
  return isRaw(value) ? { address: str(value.address), name: str(value.name) } : { address: '', name: '' };
}

export function newProvider(type: ProviderType = 'twilio'): UiProvider {
  return {
    id: '', type, name: '', credentialsFile: '',
    accountSid: '', apiKeySid: '', apiKeySecret: '', smsSenders: [], messagingServiceSid: '', emailFrom: { address: '', name: '' },
    host: '', port: 465, security: 'ssl', username: '', password: '', from: { address: '', name: '' }, smtpPreset: '',
    botToken: '', parseMode: 'none',
    server: NTFY_DEFAULT_SERVER, auth: 'none', token: '',
  };
}

export function newGroup(): UiGroup {
  return { id: '', name: '', sms: [], email: [], telegram: [], ntfy: [] };
}

/** RFC 4122 v4 UUID. `crypto.randomUUID` needs a secure context, which a LAN Homebridge UI over http is not. */
export function generateUuid(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === 'function') {
    try {
      return c.randomUUID();
    } catch {
      // fall through to the manual version
    }
  }
  const bytes = new Uint8Array(16);
  if (c && typeof c.getRandomValues === 'function') {
    c.getRandomValues(bytes);
  } else {
    for (let i = 0; i < 16; i += 1) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function perChannel<T>(value: () => T): Record<Channel, T> {
  return { sms: value(), email: value(), telegram: value(), ntfy: value() };
}

export function newSwitch(): UiSwitch {
  return {
    id: generateUuid(), name: '', enabled: true, cooldownSeconds: 0, failureMode: 'any', failureSensor: false, failureSensorResetSeconds: 300,
    groups: [], recipients: perChannel(() => []), channels: perChannel(() => false), order: [],
    body: '', subject: '', customize: false, bodies: perChannel(() => ''), subjects: perChannel(() => ''),
    providers: perChannel(() => ''), sender: '', bcc: false, priority: 'default', tags: [],
  };
}

function readProvider(raw: unknown): UiProvider {
  const r = isRaw(raw) ? raw : {};
  const p = newProvider(oneOf(r.type, PROVIDER_TYPES, 'twilio'));
  p.id = str(r.id);
  p.name = str(r.name);
  p.credentialsFile = str(r.credentialsFile);
  p.accountSid = str(r.accountSid);
  p.apiKeySid = str(r.apiKeySid);
  p.apiKeySecret = str(r.apiKeySecret);
  p.smsSenders = list(r.smsSenders);
  p.messagingServiceSid = str(r.messagingServiceSid);
  p.emailFrom = identity(r.emailFrom);
  p.host = str(r.host);
  p.port = int(r.port, 465);
  p.security = oneOf(r.security, SMTP_SECURITIES, 'ssl');
  p.username = str(r.username);
  p.password = str(r.password);
  p.from = identity(r.from);
  p.smtpPreset = str(r.smtpPreset);
  p.botToken = str(r.botToken);
  p.parseMode = oneOf(r.parseMode, TELEGRAM_PARSE_MODES, 'none');
  p.server = str(r.server, NTFY_DEFAULT_SERVER) || NTFY_DEFAULT_SERVER;
  p.auth = oneOf(r.auth, NTFY_AUTHS, 'none');
  p.token = str(r.token);
  return p;
}

function readGroup(raw: unknown): UiGroup {
  const r = isRaw(raw) ? raw : {};
  return { id: str(r.id), name: str(r.name), sms: list(r.sms), email: list(r.email), telegram: list(r.telegram), ntfy: list(r.ntfy) };
}

function readAction(raw: unknown): UiAction {
  const r = isRaw(raw) ? raw : {};
  return {
    providerId: str(r.providerId),
    channel: oneOf(r.channel, CHANNELS, 'sms'),
    sender: str(r.sender),
    groups: list(r.groups),
    recipients: list(r.recipients),
    subject: str(r.subject),
    body: str(r.body),
    bcc: bool(r.bcc, false),
    priority: oneOf(r.priority, NTFY_PRIORITIES, 'default'),
    tags: list(r.tags),
  };
}

/**
 * The switches of a stored platform block that hold more than one action on the same channel, by name (or
 * "Switch {n}" while unnamed). The editor shows one action per channel, so such a configuration, written by a
 * 1.0.x action list or by hand, is not represented at all: the page shows the upgrade notice instead and
 * offers only the backups and Reset (SPEC section 11.2, item 26). Startup validation runs it unchanged.
 */
export function legacySwitches(raw: unknown): string[] {
  const r = isRaw(raw) ? raw : {};
  const out: string[] = [];
  if (!Array.isArray(r.switches)) {
    return out;
  }
  r.switches.forEach((item: unknown, index: number) => {
    if (!isRaw(item) || !Array.isArray(item.actions)) {
      return;
    }
    const seen = new Set<string>();
    for (const action of item.actions) {
      const channel = isRaw(action) && typeof action.channel === 'string' ? action.channel : '';
      if (seen.has(channel)) {
        out.push(str(item.name).trim() || `Switch ${index + 1}`);
        return;
      }
      seen.add(channel);
    }
  });
  return out;
}

/**
 * Derives the editor shape from a switch's `actions` (SPEC section 11.2, item 8). The action per channel
 * fills that channel: its groups join the switch's group list, its extra recipients and provider override are
 * kept per channel, and its body and subject go to the shared fields when every channel agrees, or to the
 * per-channel fields with Customize on when they differ. A provider that is the channel's platform default
 * is stored as no override, so switching the default later moves the switch with it; one that no provider
 * resolves to (the provider was removed) stays as the override, so the action is written back as it was until
 * the channel is unticked. A second action on the same channel never reaches this function: `legacySwitches`
 * keeps such a configuration out of the editor.
 */
export function switchFromActions(s: UiSwitch, actions: UiAction[], providers: UiProvider[], defaults: DefaultProviders): UiSwitch {
  const first: Partial<Record<Channel, UiAction>> = {};
  s.order = [];
  for (const action of actions) {
    if (first[action.channel]) {
      continue;
    }
    first[action.channel] = action;
    s.order.push(action.channel);
  }
  s.groups = [];
  for (const channel of s.order) {
    for (const id of first[channel]?.groups ?? []) {
      if (!s.groups.includes(id)) {
        s.groups.push(id);
      }
    }
  }
  for (const channel of CHANNELS) {
    const action = first[channel];
    s.channels[channel] = action !== undefined;
    s.recipients[channel] = action ? [...action.recipients] : [];
    s.bodies[channel] = action?.body ?? '';
    s.subjects[channel] = action?.subject ?? '';
    const resolved = resolveDefaultProvider(channel, providers, defaults).id;
    s.providers[channel] = action && action.providerId !== resolved ? action.providerId : '';
  }
  s.sender = first.sms?.sender ?? '';
  s.bcc = first.email?.bcc ?? false;
  s.priority = first.ntfy?.priority ?? 'default';
  s.tags = first.ntfy ? [...first.ntfy.tags] : [];
  // Identical bodies (and subjects) collapse to the shared fields; differing ones open Customize per channel.
  const present = s.order;
  const bodies = new Set(present.map((channel) => s.bodies[channel]));
  const subjects = new Set(present.filter((channel) => SUBJECT_CHANNELS.includes(channel)).map((channel) => s.subjects[channel]));
  s.customize = bodies.size > 1 || subjects.size > 1;
  s.body = present.length > 0 ? s.bodies[present[0]] : '';
  s.subject = [...subjects][0] ?? '';
  for (const channel of CHANNELS) {
    if (!first[channel] || !s.customize) {
      s.bodies[channel] = s.body;
      s.subjects[channel] = s.subject;
    }
  }
  return s;
}

function readSwitch(raw: unknown, providers: UiProvider[], defaults: DefaultProviders): UiSwitch {
  const r = isRaw(raw) ? raw : {};
  const s = newSwitch();
  s.id = str(r.id) || s.id;
  s.name = str(r.name);
  s.enabled = bool(r.enabled, true);
  s.cooldownSeconds = int(r.cooldownSeconds, 0);
  s.failureMode = oneOf(r.failureMode, FAILURE_MODES, 'any');
  s.failureSensor = bool(r.failureSensor, false);
  s.failureSensorResetSeconds = int(r.failureSensorResetSeconds, 300);
  return switchFromActions(s, Array.isArray(r.actions) ? r.actions.map(readAction) : [], providers, defaults);
}

/** The `defaultProviders` block as stored: string values under channel keys; anything else is dropped. */
function readDefaultProviders(raw: unknown): DefaultProviders {
  const out: DefaultProviders = {};
  if (!isRaw(raw)) {
    return out;
  }
  for (const channel of CHANNELS) {
    const value = raw[channel];
    if (typeof value === 'string' && value.trim()) {
      out[channel] = value.trim();
    }
  }
  return out;
}

/** The unknown top-level keys of a block that are carried through unchanged; the forbidden names never are. */
function extraKeys(r: Raw): Raw {
  const out: Raw = {};
  for (const key of Object.keys(r)) {
    if (!FORBIDDEN_KEYS.includes(key)) {
      out[key] = r[key];
    }
  }
  return out;
}

/** Builds the editable model from a platform block (or nothing, for a fresh install). */
export function readConfig(raw: unknown): UiConfig {
  const r = isRaw(raw) ? raw : {};
  const master = isRaw(r.masterSwitch) ? r.masterSwitch : {};
  const providers = Array.isArray(r.providers) ? r.providers.map(readProvider) : [];
  const defaultProviders = readDefaultProviders(r.defaultProviders);
  return {
    ...extraKeys(r),
    platform: 'NotifySwitch',
    name: str(r.name, 'Notify Switch'),
    configVersion: int(r.configVersion, 1),
    defaultCountry: str(r.defaultCountry, 'US').toUpperCase() || 'US',
    timeFormat: oneOf(r.timeFormat, TIME_FORMATS, DEFAULT_TIME_FORMAT),
    dateFormat: oneOf(r.dateFormat, DATE_FORMATS, DEFAULT_DATE_FORMAT),
    masterSwitch: { enabled: bool(master.enabled, true), name: str(master.name, 'Notifications Enabled') },
    debug: bool(r.debug, false),
    defaultProviders,
    providers,
    groups: Array.isArray(r.groups) ? r.groups.map(readGroup) : [],
    switches: Array.isArray(r.switches) ? r.switches.map((item) => readSwitch(item, providers, defaultProviders)) : [],
  };
}

function cleanIdentity(value: UiEmailIdentity): Raw | undefined {
  if (!value.address.trim()) {
    return undefined;
  }
  const out: Raw = { address: value.address.trim() };
  if (value.name.trim()) {
    out.name = value.name.trim();
  }
  return out;
}

function trimList(values: string[]): string[] {
  return values.map((v) => v.trim()).filter((v) => v.length > 0);
}

/** The provider block as written to config.json: only the fields for its type, optional fields only when set. */
export function exportProvider(p: UiProvider): Raw {
  const out: Raw = { id: p.id.trim(), type: p.type, name: p.name.trim() };
  if (p.credentialsFile.trim()) {
    out.credentialsFile = p.credentialsFile.trim();
  }
  switch (p.type) {
  case 'twilio': {
    out.accountSid = p.accountSid.trim();
    out.apiKeySid = p.apiKeySid.trim();
    if (p.apiKeySecret) {
      out.apiKeySecret = p.apiKeySecret;
    }
    out.smsSenders = trimList(p.smsSenders);
    if (p.messagingServiceSid.trim()) {
      out.messagingServiceSid = p.messagingServiceSid.trim();
    }
    const emailFrom = cleanIdentity(p.emailFrom);
    if (emailFrom) {
      out.emailFrom = emailFrom;
    }
    break;
  }
  case 'smtp': {
    out.host = p.host.trim();
    out.port = p.port;
    out.security = p.security;
    out.username = p.username.trim();
    if (p.password) {
      out.password = p.password;
    }
    out.from = cleanIdentity(p.from) ?? { address: '' };
    if (p.smtpPreset.trim()) {
      out.smtpPreset = p.smtpPreset.trim();
    }
    break;
  }
  case 'telegram':
    out.botToken = p.botToken.trim();
    out.parseMode = p.parseMode;
    break;
  case 'ntfy':
    out.server = p.server.trim() || NTFY_DEFAULT_SERVER;
    out.auth = p.auth;
    if (p.auth === 'token' && p.token.trim()) {
      out.token = p.token.trim();
    }
    if (p.auth === 'basic') {
      out.username = p.username.trim();
      if (p.password) {
        out.password = p.password;
      }
    }
    break;
  }
  return out;
}

function exportAction(a: UiAction): Raw {
  const out: Raw = { providerId: a.providerId, channel: a.channel };
  if (a.channel === 'sms' && a.sender) {
    out.sender = a.sender;
  }
  out.groups = [...a.groups];
  out.recipients = trimList(a.recipients);
  if ((a.channel === 'email' || a.channel === 'ntfy') && a.subject.trim()) {
    out.subject = a.subject.trim();
  }
  if (a.channel === 'email' && a.bcc) {
    out.bcc = true;
  }
  if (a.channel === 'ntfy') {
    if (a.priority !== 'default') {
      out.priority = a.priority;
    }
    const tags = trimList(a.tags);
    if (tags.length > 0) {
      out.tags = tags;
    }
  }
  out.body = a.body;
  return out;
}

/** Distinct addresses of one channel across the switch's groups and its extra recipients, the way startup resolves them. */
export function channelRecipients(config: UiConfig, s: UiSwitch, channel: Channel): Set<string> {
  const out = new Set<string>();
  for (const id of s.groups) {
    const group = config.groups.find((entry) => entry.id.trim() === id && id);
    for (const value of group?.[channel] ?? []) {
      if (value.trim()) {
        out.add(value.trim());
      }
    }
  }
  for (const value of s.recipients[channel]) {
    if (value.trim()) {
      out.add(value.trim());
    }
  }
  return out;
}

/** True when no provider can send on `channel`: none of its type, or a Twilio provider without a from address for email (SPEC section 5.7). */
export function channelUnserved(config: UiConfig, channel: Channel): boolean {
  return providersForChannel(config.providers, channel).length === 0;
}

/**
 * The channels Send by lists (SPEC section 11.2, item 8): those with somebody to reach and a provider that can send
 * on them, plus a ticked channel that no provider serves any more (a stored action whose provider was removed),
 * which stays listed, disabled with a note, until it is unticked. A channel with nobody to reach is not listed
 * and gets no action.
 */
export function presentChannels(config: UiConfig, s: UiSwitch): Channel[] {
  return CHANNELS.filter((channel) => channelRecipients(config, s, channel).size > 0 && (!channelUnserved(config, channel) || s.channels[channel]));
}

/** The channels the switch sends on (present and ticked), in the order its actions are written: the stored order first, new channels after. */
export function enabledChannels(s: UiSwitch, config: UiConfig): Channel[] {
  const enabled = presentChannels(config, s).filter((channel) => s.channels[channel]);
  return [...s.order.filter((channel) => enabled.includes(channel)), ...enabled.filter((channel) => !s.order.includes(channel))];
}

/** The ticked channels of the switch that no provider serves (SPEC section 11.2, item 8): kept as stored, written back unchanged. */
export function unservedChannels(config: UiConfig, s: UiSwitch): Channel[] {
  return enabledChannels(s, config).filter((channel) => channelUnserved(config, channel));
}

/** The provider id a channel of the switch sends through: the override, else the platform default (SPEC section 5.7). */
export function switchProviderId(s: UiSwitch, channel: Channel, config: UiConfig): string {
  return s.providers[channel] || resolveDefaultProvider(channel, config.providers, config.defaultProviders).id || '';
}

/**
 * The `actions` array config.json keeps for a switch (SPEC section 5.4): one action per enabled channel with
 * the switch's groups, that channel's extra recipients, the shared or per-channel body and subject, and the
 * provider from the override or the platform default.
 */
export function switchActions(s: UiSwitch, config: UiConfig): Raw[] {
  return enabledChannels(s, config).map((channel) => exportAction({
    providerId: switchProviderId(s, channel, config),
    channel,
    sender: channel === 'sms' ? s.sender : '',
    groups: [...s.groups],
    recipients: [...s.recipients[channel]],
    subject: s.customize ? s.subjects[channel] : s.subject,
    body: s.customize ? s.bodies[channel] : s.body,
    bcc: s.bcc,
    priority: s.priority,
    tags: [...s.tags],
  }));
}

/** The platform block as written to config.json. */
export function exportConfig(config: UiConfig): Raw {
  const out: Raw = {
    ...config,
    platform: 'NotifySwitch',
    name: config.name.trim() || 'Notify Switch',
    configVersion: config.configVersion,
    defaultCountry: config.defaultCountry,
    timeFormat: config.timeFormat,
    dateFormat: config.dateFormat,
    masterSwitch: { enabled: config.masterSwitch.enabled, name: config.masterSwitch.name.trim() },
    debug: config.debug,
    providers: config.providers.map(exportProvider),
    groups: config.groups.map((g) => ({
      id: g.id.trim(), name: g.name.trim(), sms: trimList(g.sms), email: trimList(g.email), telegram: trimList(g.telegram), ntfy: trimList(g.ntfy),
    })),
    switches: config.switches.map((s) => ({
      id: s.id,
      name: s.name.trim(),
      enabled: s.enabled,
      cooldownSeconds: s.cooldownSeconds,
      failureMode: s.failureMode,
      failureSensor: s.failureSensor,
      failureSensorResetSeconds: s.failureSensorResetSeconds,
      actions: switchActions(s, config),
    })),
  };
  // Only channels with more than one provider carry a default (SPEC section 5.7); nothing is stored otherwise.
  const defaults = pruneDefaults(config.providers, config.defaultProviders);
  if (Object.keys(defaults).length > 0) {
    out.defaultProviders = defaults;
  } else {
    delete out.defaultProviders;
  }
  return out;
}

/** The fields per provider type that are secrets on their own (SPEC section 5.2). ntfy's depend on its auth mode. */
function ownSecretFields(p: UiProvider): string[] {
  switch (p.type) {
  case 'twilio':
    return ['apiKeySecret'];
  case 'smtp':
    return ['password'];
  case 'telegram':
    return ['botToken'];
  case 'ntfy':
    return p.auth === 'token' ? ['token'] : p.auth === 'basic' ? ['password'] : [];
  }
}

/**
 * The fields a backup without credentials empties (SPEC section 11.2, item 12): the provider's secret, and,
 * when a `credentialsFile` is set, every key that file may supply, since those values are credentials too.
 */
export function secretFields(p: UiProvider): string[] {
  const keys = new Set<string>(ownSecretFields(p));
  if (p.credentialsFile.trim()) {
    for (const key of CREDENTIAL_KEYS[p.type]) {
      keys.add(key);
    }
  }
  return [...keys];
}

/**
 * A stored platform block with every secret field emptied and `credentialsRemoved: true`, without going through
 * the editor model, so a configuration the editor cannot represent (SPEC section 11.2, item 26) is backed up
 * as it is. Each provider's secret fields follow its type, auth mode and credentials file as in `secretFields`.
 */
export function blockWithoutCredentials(block: Raw): Raw {
  const out: Raw = { ...block };
  if (Array.isArray(block.providers)) {
    out.providers = block.providers.map((item: unknown) => {
      if (!isRaw(item)) {
        return item;
      }
      const raw: Raw = { ...item };
      for (const key of secretFields(readProvider(item))) {
        raw[key] = '';
      }
      return raw;
    });
  }
  out.credentialsRemoved = true;
  return out;
}

/**
 * The platform block for a backup without credentials: the same JSON as `exportConfig`, with every secret
 * field replaced by an empty string and a top-level `credentialsRemoved: true` so Restore knows what to expect.
 */
export function exportConfigWithoutCredentials(config: UiConfig): Raw {
  return blockWithoutCredentials(exportConfig(config));
}

/** The field paths (`providers[0].apiKeySecret`) of the secret fields that are empty in `config`. */
export function emptySecretPaths(config: UiConfig): string[] {
  const paths: string[] = [];
  config.providers.forEach((p, i) => {
    for (const key of secretFields(p)) {
      const value = (p as unknown as Record<string, unknown>)[key];
      if (typeof value !== 'string' || value.trim().length === 0) {
        paths.push(`providers[${i}].${key}`);
      }
    }
  });
  return paths;
}

/** Lowercase slug from a display name, for suggesting provider and group ids. */
export function slugify(name: string): string {
  return name.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64);
}

/**
 * The slug for `name` (or `fallback` when the name has no usable characters), with a numeric suffix
 * when another item already uses it: `twilio`, then `twilio-2`, `twilio-3` (SPEC section 11.2, item 14).
 */
export function uniqueSlug(name: string, taken: Iterable<string>, fallback: string): string {
  const used = new Set(Array.from(taken, (id) => id.trim()));
  const base = slugify(name) || fallback;
  if (!used.has(base)) {
    return base;
  }
  for (let n = 2; ; n += 1) {
    const candidate = `${base.slice(0, 64 - String(n).length - 1)}-${n}`;
    if (!used.has(candidate)) {
      return candidate;
    }
  }
}

/** A provider created from the chooser: type fixed, name prefilled, id generated from the name (SPEC section 11.2, item 13). */
export function createProvider(type: ProviderType, name: string, existing: UiProvider[]): UiProvider {
  const p = newProvider(type);
  p.name = name;
  p.id = uniqueSlug(name, existing.map((other) => other.id), type);
  return p;
}

/** A group created by Add group: the id is generated from the name as it is typed until a switch refers to it. */
export function createGroup(existing: UiGroup[]): UiGroup {
  const g = newGroup();
  g.id = uniqueSlug('', existing.map((other) => other.id), 'group');
  return g;
}

/** The empty default configuration written by Reset plugin to fresh install (SPEC section 11.2, item 12). */
export function emptyConfig(): UiConfig {
  return readConfig({ platform: 'NotifySwitch', name: 'Notify Switch', configVersion: 1, providers: [], groups: [], switches: [] });
}

/**
 * Reads a backup file's JSON into a platform block: either the block itself or a whole config.json
 * holding one under `platforms`. Returns the block, or the reason it was rejected. A key named
 * `__proto__`, `constructor` or `prototype` at any nesting level rejects the file (SPEC section 12, item 12).
 */
export function backupBlock(parsed: unknown): { block?: Raw; error?: string; forbiddenKey?: string } {
  if (!isRaw(parsed)) {
    return { error: 'The file does not contain a JSON object.' };
  }
  const forbiddenKey = findForbiddenKey(parsed);
  if (forbiddenKey !== undefined) {
    return { forbiddenKey };
  }
  let block: Raw = parsed;
  if (Array.isArray(parsed.platforms)) {
    const found = parsed.platforms.find((entry: unknown) => isRaw(entry) && entry.platform === 'NotifySwitch');
    if (!isRaw(found)) {
      return { error: 'The file is a Homebridge config.json without a NotifySwitch platform block.' };
    }
    block = found;
  }
  if (block.platform !== 'NotifySwitch') {
    return { error: 'The file is not a Notify Switch backup: "platform" must be "NotifySwitch".' };
  }
  for (const key of ['providers', 'groups', 'switches']) {
    if (block[key] !== undefined && block[key] !== null && !Array.isArray(block[key])) {
      return { error: `"${key}" must be a list.` };
    }
  }
  return { block };
}
