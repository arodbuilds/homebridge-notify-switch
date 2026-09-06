/**
 * Configuration and provider types shared across the plugin (SPEC sections 5 and 6).
 */

export type ProviderType = 'twilio' | 'smtp' | 'telegram';
export type Channel = 'sms' | 'email' | 'telegram';
export type FailureMode = 'any' | 'all' | 'off';
export type SmtpSecurity = 'ssl' | 'starttls' | 'none';
export type TelegramParseMode = 'none' | 'markdown' | 'html';

export const PROVIDER_TYPES: readonly ProviderType[] = ['twilio', 'smtp', 'telegram'];
export const CHANNELS: readonly Channel[] = ['sms', 'email', 'telegram'];
export const FAILURE_MODES: readonly FailureMode[] = ['any', 'all', 'off'];
export const SMTP_SECURITIES: readonly SmtpSecurity[] = ['ssl', 'starttls', 'none'];
export const TELEGRAM_PARSE_MODES: readonly TelegramParseMode[] = ['none', 'markdown', 'html'];

/** Channels each provider type serves (SPEC section 3, item 2). */
export const PROVIDER_CHANNELS: Readonly<Record<ProviderType, readonly Channel[]>> = {
  twilio: ['sms', 'email'],
  smtp: ['email'],
  telegram: ['telegram'],
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

export type ProviderConfig = TwilioProviderConfig | SmtpProviderConfig | TelegramProviderConfig;

export interface GroupConfig {
  id: string;
  name: string;
  sms: string[];
  email: string[];
  telegram: string[];
}

export interface ActionConfig {
  providerId: string;
  channel: Channel;
  /** Explicit sender from config, sms only. */
  sender?: string;
  groups: string[];
  recipients: string[];
  subject?: string;
  body: string;
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
  masterSwitch: MasterSwitchConfig;
  debug: boolean;
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
  subject?: string;
  body: string;
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
  subject?: string;
  body: string;
}

export interface RecipientResult {
  recipient: string;
  ok: boolean;
  /** Provider message id, operation id, etc. */
  id?: string;
  /** Sanitized, no secrets, no request dumps. */
  error?: string;
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
