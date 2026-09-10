/**
 * Configuration and provider types shared across the plugin (SPEC sections 5 and 6).
 */

export type ProviderType = 'twilio' | 'smtp' | 'telegram' | 'ntfy';
export type Channel = 'sms' | 'email' | 'telegram' | 'ntfy';
export type FailureMode = 'any' | 'all' | 'off';
export type SmtpSecurity = 'ssl' | 'starttls' | 'none';
export type TelegramParseMode = 'none' | 'markdown' | 'html';
export type NtfyAuth = 'none' | 'token' | 'basic';
export type NtfyPriority = 'min' | 'low' | 'default' | 'high' | 'urgent';
/** How `{{time}}` renders (SPEC section 5.1 and 5.6): "5:15 PM" or "17:15". */
export type TimeFormat = '12h' | '24h';
/** How `{{date}}` renders (SPEC section 5.1 and 5.6): "9/8/2026", "8/9/2026" or "2026-09-08". */
export type DateFormat = 'mdy' | 'dmy' | 'ymd';

export const PROVIDER_TYPES: readonly ProviderType[] = ['twilio', 'smtp', 'telegram', 'ntfy'];
export const CHANNELS: readonly Channel[] = ['sms', 'email', 'telegram', 'ntfy'];
export const FAILURE_MODES: readonly FailureMode[] = ['any', 'all', 'off'];
export const SMTP_SECURITIES: readonly SmtpSecurity[] = ['ssl', 'starttls', 'none'];
export const TELEGRAM_PARSE_MODES: readonly TelegramParseMode[] = ['none', 'markdown', 'html'];
export const NTFY_AUTHS: readonly NtfyAuth[] = ['none', 'token', 'basic'];
export const NTFY_PRIORITIES: readonly NtfyPriority[] = ['min', 'low', 'default', 'high', 'urgent'];
export const TIME_FORMATS: readonly TimeFormat[] = ['12h', '24h'];
export const DATE_FORMATS: readonly DateFormat[] = ['mdy', 'dmy', 'ymd'];
export const DEFAULT_TIME_FORMAT: TimeFormat = '12h';
export const DEFAULT_DATE_FORMAT: DateFormat = 'mdy';

/** The ntfy server used when a provider names none (SPEC section 5.2). */
export const NTFY_DEFAULT_SERVER = 'https://ntfy.sh';

/** Channels each provider type serves (SPEC section 3, item 2). */
export const PROVIDER_CHANNELS: Readonly<Record<ProviderType, readonly Channel[]>> = {
  twilio: ['sms', 'email'],
  smtp: ['email'],
  telegram: ['telegram'],
  ntfy: ['ntfy'],
};

/** Channels whose actions carry a `subject` (the email subject, or the ntfy notification title). */
export const SUBJECT_CHANNELS: readonly Channel[] = ['email', 'ntfy'];

/** Secret fields each provider type accepts from a `credentialsFile` (SPEC section 12, item 2). */
export const CREDENTIAL_KEYS: Readonly<Record<ProviderType, readonly string[]>> = {
  twilio: ['accountSid', 'apiKeySid', 'apiKeySecret'],
  smtp: ['username', 'password'],
  telegram: ['botToken'],
  ntfy: ['token', 'username', 'password'],
};

export interface EmailIdentity {
  address: string;
  name?: string;
}

export interface ProviderConfigBase {
  id: string;
  type: ProviderType;
  name: string;
  /** Path, relative to the Homebridge storage directory, of a JSON file whose keys override the secret fields (SPEC section 12, item 2). */
  credentialsFile?: string;
}

export interface TwilioProviderConfig extends ProviderConfigBase {
  type: 'twilio';
  accountSid: string;
  apiKeySid: string;
  apiKeySecret: string;
  smsSenders: string[];
  messagingServiceSid?: string;
  emailFrom?: EmailIdentity;
}

export interface SmtpProviderConfig extends ProviderConfigBase {
  type: 'smtp';
  host: string;
  port: number;
  security: SmtpSecurity;
  username: string;
  password: string;
  from: EmailIdentity;
}

export interface TelegramProviderConfig extends ProviderConfigBase {
  type: 'telegram';
  botToken: string;
  parseMode: TelegramParseMode;
}

export interface NtfyProviderConfig extends ProviderConfigBase {
  type: 'ntfy';
  /** Base URL of the ntfy server, http or https, without a trailing slash. */
  server: string;
  auth: NtfyAuth;
  /** Access token, required when `auth` is `token`. */
  token?: string;
  /** Required when `auth` is `basic`. */
  username?: string;
  password?: string;
}

export type ProviderConfig = TwilioProviderConfig | SmtpProviderConfig | TelegramProviderConfig | NtfyProviderConfig;

export interface GroupConfig {
  id: string;
  name: string;
  sms: string[];
  email: string[];
  telegram: string[];
  ntfy: string[];
}

export interface ActionConfig {
  providerId: string;
  channel: Channel;
  /** Explicit sender from config, sms only. */
  sender?: string;
  groups: string[];
  recipients: string[];
  /** Email subject, or the ntfy notification title (SPEC section 5.5, item 7). */
  subject?: string;
  body: string;
  /** Email only. Hide recipients from each other: they go in Bcc and the from address in To (SPEC section 6.2 and 6.3). Default false. */
  bcc?: boolean;
  /** ntfy only (SPEC section 5.5, item 10). Default `default`. */
  priority?: NtfyPriority;
  /** ntfy only (SPEC section 5.5, item 11). */
  tags?: string[];
}

export interface SwitchConfig {
  id: string;
  name: string;
  enabled: boolean;
  cooldownSeconds: number;
  failureMode: FailureMode;
  failureSensor: boolean;
  failureSensorResetSeconds: number;
  actions: ActionConfig[];
}

export interface MasterSwitchConfig {
  enabled: boolean;
  name: string;
}

/** Fully validated and normalized platform configuration. */
export interface NotifySwitchConfig {
  name: string;
  configVersion: number;
  defaultCountry: string;
  /** How `{{time}}`, `{{date}}` and `{{datetime}}` render (SPEC section 5.6). Default `12h` and `mdy`. */
  timeFormat: TimeFormat;
  dateFormat: DateFormat;
  masterSwitch: MasterSwitchConfig;
  debug: boolean;
  /**
   * Platform defaults per channel (SPEC section 5.7): the provider switches use on a channel unless an action
   * names another. Only channels with more than one provider carry an entry. The runtime never reads it; the
   * settings UI derives each action's `providerId` from it and startup validation checks it.
   */
  defaultProviders: Partial<Record<Channel, string>>;
  providers: ProviderConfig[];
  groups: GroupConfig[];
  switches: SwitchConfig[];
}

/**
 * An action after validation: recipients resolved, deduplicated and normalized,
 * and the sms sender resolved per SPEC section 5.5 item 3.
 */
export interface ResolvedAction {
  index: number;
  providerId: string;
  channel: Channel;
  /** Resolved sms sender. Undefined means "use the provider's Messaging Service". */
  sender?: string;
  recipients: string[];
  /** Email subject or ntfy title, defaulted to the switch name. */
  subject?: string;
  body: string;
  /** Email only: recipients in Bcc instead of To. */
  bcc?: boolean;
  /** ntfy only. */
  priority?: NtfyPriority;
  /** ntfy only. */
  tags?: string[];
}

export interface ResolvedSwitch extends Omit<SwitchConfig, 'actions'> {
  actions: ResolvedAction[];
}

export interface ValidationIssue {
  /** Field path, for example `switches[2].actions[0].providerId`. Empty for platform-wide issues. */
  path: string;
  message: string;
  level: 'error' | 'warning';
}

// ---- Provider interface (SPEC section 6) -----------------------------------

export interface SendRequest {
  channel: Channel;
  sender?: string;
  recipients: string[];
  /** Email subject or ntfy title, already rendered and stripped of line breaks. */
  subject?: string;
  body: string;
  /**
   * Email only. When true and there is more than one recipient, recipients go in Bcc and the from
   * address in To, so they do not see each other. Otherwise every recipient is in To (SPEC section 6.2 and 6.3).
   */
  bcc?: boolean;
  /** ntfy only (SPEC section 6.5). */
  priority?: NtfyPriority;
  /** ntfy only (SPEC section 6.5). */
  tags?: string[];
}

export interface RecipientResult {
  recipient: string;
  ok: boolean;
  /** Provider message id, operation id, etc. */
  id?: string;
  /** Sanitized, no secrets, no request dumps. */
  error?: string;
}

/** Outcome of a settings UI connection test (SPEC section 11.2, item 3). `message` never contains a credential. */
export interface ConnectionTestResult {
  ok: boolean;
  message: string;
}

/** A chat the bot has seen, as listed by Find people and groups (SPEC section 11.2, item 5). */
export interface ChatSummary {
  id: string;
  /** First name and username for a private chat; the title for a group, supergroup or channel. */
  title: string;
  type: string;
}

/** Outcome of the Telegram bot lookup behind the onboarding flow (SPEC section 11.2, item 10). */
export interface BotIdentity {
  ok: boolean;
  message: string;
  /** The bot's username without the leading @, present only when `ok`. */
  username?: string;
}

/** A Twilio phone number the account owns (SPEC section 11.2, item 9). */
export interface TwilioNumber {
  phoneNumber: string;
  friendlyName: string;
}

/** A Twilio Messaging Service on the account (SPEC section 11.2, item 9). */
export interface TwilioService {
  sid: string;
  friendlyName: string;
}

/** Outcome of the Twilio "Look up numbers" request (SPEC section 11.2, item 9). */
export interface TwilioLookupResult {
  ok: boolean;
  message: string;
  numbers: TwilioNumber[];
  services: TwilioService[];
  /** True when either list has more entries than the page returned. */
  truncated: boolean;
}

/**
 * Optional diagnostics a provider can offer to the settings UI. Not part of the `Provider` interface the
 * switch code depends on; the UI server checks for these methods at runtime.
 */
export interface ProviderDiagnostics {
  /** Checks the credentials against the service without sending anything. Never throws. */
  testConnection(): Promise<ConnectionTestResult>;
  /** Telegram only: lists chats the bot has seen. Never throws. */
  findChats?(): Promise<{ ok: boolean; message: string; chats: ChatSummary[] }>;
  /** Telegram only: `getMe`, for the onboarding flow. Never throws. */
  getMe?(): Promise<BotIdentity>;
  /** Twilio only: lists the account's phone numbers and Messaging Services. Never throws. */
  lookupSenders?(): Promise<TwilioLookupResult>;
}

export interface Provider {
  readonly id: string;
  readonly type: ProviderType;
  readonly channels: Channel[];
  /** Issues are reported with paths relative to the provider block, for example `accountSid`. */
  validateConfig(): ValidationIssue[];
  validateBody(channel: Channel, body: string): ValidationIssue[];
  /** Never throws. Every recipient in the request gets exactly one result. */
  send(req: SendRequest): Promise<RecipientResult[]>;
}
