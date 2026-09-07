import type { Channel, FailureMode, ProviderType, SmtpSecurity, TelegramParseMode } from '../../src/types.js';
import { CHANNELS, FAILURE_MODES, PROVIDER_TYPES, SMTP_SECURITIES, TELEGRAM_PARSE_MODES } from '../../src/types.js';

/**
 * The configuration object the settings UI edits. It is the platform block from config.json with
 * every known field present (defaults filled in) so the sections can bind inputs to it directly.
 * Unknown top-level keys are preserved; unknown keys inside providers, groups and switches are dropped.
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
  // smtp
  host: string;
  port: number;
  security: SmtpSecurity;
  username: string;
  password: string;
  from: UiEmailIdentity;
  // telegram
  botToken: string;
  parseMode: TelegramParseMode;
}

export interface UiGroup {
  id: string;
  name: string;
  sms: string[];
  email: string[];
  telegram: string[];
}

export interface UiAction {
  providerId: string;
  channel: Channel;
  sender: string;
  groups: string[];
  recipients: string[];
  subject: string;
  body: string;
}

export interface UiSwitch {
  id: string;
  name: string;
  enabled: boolean;
  cooldownSeconds: number;
  failureMode: FailureMode;
  failureSensor: boolean;
  failureSensorResetSeconds: number;
  actions: UiAction[];
}

export interface UiConfig {
  platform: string;
  name: string;
  configVersion: number;
  defaultCountry: string;
  masterSwitch: { enabled: boolean; name: string };
  debug: boolean;
  providers: UiProvider[];
  groups: UiGroup[];
  switches: UiSwitch[];
  [extra: string]: unknown;
}

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
    host: '', port: 465, security: 'ssl', username: '', password: '', from: { address: '', name: '' },
    botToken: '', parseMode: 'none',
  };
}

export function newGroup(): UiGroup {
  return { id: '', name: '', sms: [], email: [], telegram: [] };
}

export function newAction(providerId = '', channel: Channel = 'sms'): UiAction {
  return { providerId, channel, sender: '', groups: [], recipients: [], subject: '', body: '' };
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

export function newSwitch(): UiSwitch {
  return {
    id: generateUuid(), name: '', enabled: true, cooldownSeconds: 0, failureMode: 'any', failureSensor: false, failureSensorResetSeconds: 300,
    actions: [],
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
  p.botToken = str(r.botToken);
  p.parseMode = oneOf(r.parseMode, TELEGRAM_PARSE_MODES, 'none');
  return p;
}

function readGroup(raw: unknown): UiGroup {
  const r = isRaw(raw) ? raw : {};
  return { id: str(r.id), name: str(r.name), sms: list(r.sms), email: list(r.email), telegram: list(r.telegram) };
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
  };
}

function readSwitch(raw: unknown): UiSwitch {
  const r = isRaw(raw) ? raw : {};
  return {
    id: str(r.id) || generateUuid(),
    name: str(r.name),
    enabled: bool(r.enabled, true),
    cooldownSeconds: int(r.cooldownSeconds, 0),
    failureMode: oneOf(r.failureMode, FAILURE_MODES, 'any'),
    failureSensor: bool(r.failureSensor, false),
    failureSensorResetSeconds: int(r.failureSensorResetSeconds, 300),
    actions: Array.isArray(r.actions) ? r.actions.map(readAction) : [],
  };
}

/** Builds the editable model from a platform block (or nothing, for a fresh install). */
export function readConfig(raw: unknown): UiConfig {
  const r = isRaw(raw) ? raw : {};
  const master = isRaw(r.masterSwitch) ? r.masterSwitch : {};
  return {
    ...r,
    platform: 'NotifySwitch',
    name: str(r.name, 'Notify Switch'),
    configVersion: int(r.configVersion, 1),
    defaultCountry: str(r.defaultCountry, 'US').toUpperCase() || 'US',
    masterSwitch: { enabled: bool(master.enabled, true), name: str(master.name, 'Notifications Enabled') },
    debug: bool(r.debug, false),
    providers: Array.isArray(r.providers) ? r.providers.map(readProvider) : [],
    groups: Array.isArray(r.groups) ? r.groups.map(readGroup) : [],
    switches: Array.isArray(r.switches) ? r.switches.map(readSwitch) : [],
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
    break;
  }
  case 'telegram':
    out.botToken = p.botToken.trim();
    out.parseMode = p.parseMode;
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
  if (a.channel === 'email' && a.subject.trim()) {
    out.subject = a.subject.trim();
  }
  out.body = a.body;
  return out;
}

/** The platform block as written to config.json. */
export function exportConfig(config: UiConfig): Raw {
  return {
    ...config,
    platform: 'NotifySwitch',
    name: config.name.trim() || 'Notify Switch',
    configVersion: config.configVersion,
    defaultCountry: config.defaultCountry,
    masterSwitch: { enabled: config.masterSwitch.enabled, name: config.masterSwitch.name.trim() },
    debug: config.debug,
    providers: config.providers.map(exportProvider),
    groups: config.groups.map((g) => ({
      id: g.id.trim(), name: g.name.trim(), sms: trimList(g.sms), email: trimList(g.email), telegram: trimList(g.telegram),
    })),
    switches: config.switches.map((s) => ({
      id: s.id,
      name: s.name.trim(),
      enabled: s.enabled,
      cooldownSeconds: s.cooldownSeconds,
      failureMode: s.failureMode,
      failureSensor: s.failureSensor,
      failureSensorResetSeconds: s.failureSensorResetSeconds,
      actions: s.actions.map(exportAction),
    })),
  };
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
 * holding one under `platforms`. Returns the block, or the reason it was rejected.
 */
export function backupBlock(parsed: unknown): { block?: Raw; error?: string } {
  if (!isRaw(parsed)) {
    return { error: 'The file does not contain a JSON object.' };
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
