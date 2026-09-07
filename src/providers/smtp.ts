import { createTransport } from 'nodemailer';
import type { SendMailOptions, SentMessageInfo, SMTPTransportOptions } from 'nodemailer';

import type { PluginLogger } from '../logging.js';
import { EMAIL_PATTERN } from '../patterns.js';
import { PROVIDER_CONCURRENCY, PROVIDER_RETRY_BACKOFF_MS, PROVIDER_TIMEOUT_MS } from '../settings.js';
import { stripLineBreaks } from '../template.js';
import type {
  Channel, ConnectionTestResult, Provider, ProviderDiagnostics, RecipientResult, SendRequest, SmtpProviderConfig, ValidationIssue,
} from '../types.js';
import { PROVIDER_CHANNELS, SMTP_SECURITIES } from '../types.js';
import { validateBodyForChannel } from './bodyRules.js';
import { Semaphore, shortMessage, sleep } from './http.js';

/** The part of a nodemailer transport this provider uses. The harness substitutes a fake. */
export interface MailTransport {
  sendMail(options: SendMailOptions): Promise<SentMessageInfo>;
  /** nodemailer's connection and login check; used by the settings UI's Test connection. */
  verify?(): Promise<true>;
  close?(): void;
}

export type MailTransportFactory = (options: SMTPTransportOptions) => MailTransport;

export interface SmtpProviderOptions {
  /** Replaces nodemailer's `createTransport`. Used by the local harness only. */
  createTransport?: MailTransportFactory;
}

/** Fields nodemailer attaches to the errors it hands back. Everything is optional. */
interface MailError {
  code?: unknown;
  message?: unknown;
  response?: unknown;
  responseCode?: unknown;
  recipient?: unknown;
  rejected?: unknown;
  rejectedErrors?: unknown;
}

class SmtpTimeoutError extends Error {
  readonly code = 'ETIMEDOUT';
  constructor() {
    super(`request timed out after ${PROVIDER_TIMEOUT_MS / 1000}s`);
    this.name = 'TimeoutError';
  }
}

/** nodemailer error codes that describe a connection problem rather than a rejected message. */
const TRANSIENT_CODES = new Set(['ECONNECTION', 'ETIMEDOUT', 'ESOCKET', 'EDNS']);

/** SMTP reply codes that ask the client to try again later (RFC 5321 section 4.2.3), including rate limits. */
const TRANSIENT_SMTP_REPLIES = new Set([421, 450, 451, 452]);

function asMailError(err: unknown): MailError {
  return typeof err === 'object' && err !== null ? (err as MailError) : { message: String(err) };
}

function isTransient(err: MailError): boolean {
  if (typeof err.code === 'string' && TRANSIENT_CODES.has(err.code)) {
    return true;
  }
  return typeof err.responseCode === 'number' && TRANSIENT_SMTP_REPLIES.has(err.responseCode);
}

interface Attempt {
  results: RecipientResult[];
  /** True when the whole message failed for a reason worth one retry (SPEC section 6, rule 2). */
  transient: boolean;
}

/**
 * SMTP provider (SPEC section 6.3) on nodemailer. One message per action with every recipient in
 * `to`; with the action's `bcc` option and more than one recipient, the recipients go in `bcc` and
 * the from address in `to` so they do not see each other. Certificate verification cannot be
 * disabled and nodemailer's `debug` and `logger` options are never set.
 */
export class SmtpProvider implements Provider, ProviderDiagnostics {
  readonly type = 'smtp' as const;
  readonly channels: Channel[] = [...PROVIDER_CHANNELS.smtp];
  private readonly semaphore = new Semaphore(PROVIDER_CONCURRENCY);
  private readonly factory: MailTransportFactory;
  private transport?: MailTransport;

  constructor(
    private readonly config: SmtpProviderConfig,
    private readonly log: PluginLogger,
    options: SmtpProviderOptions = {},
  ) {
    this.factory = options.createTransport ?? ((transportOptions) => createTransport(transportOptions));
  }

  get id(): string {
    return this.config.id;
  }

  validateConfig(): ValidationIssue[] {
    const issues: ValidationIssue[] = [];
    const c = this.config;
    if (typeof c.host !== 'string' || c.host.trim().length === 0) {
      issues.push({ path: 'host', level: 'error', message: 'is required' });
    }
    if (!Number.isInteger(c.port) || c.port < 1 || c.port > 65535) {
      issues.push({ path: 'port', level: 'error', message: 'must be an integer between 1 and 65535' });
    }
    if (!SMTP_SECURITIES.includes(c.security)) {
      issues.push({ path: 'security', level: 'error', message: `must be one of ${SMTP_SECURITIES.join(', ')}` });
    }
    if (typeof c.username !== 'string' || c.username.trim().length === 0) {
      issues.push({ path: 'username', level: 'error', message: 'is required' });
    }
    if (typeof c.password !== 'string' || c.password.length === 0) {
      issues.push({ path: 'password', level: 'error', message: 'is required' });
    }
    if (!c.from || !EMAIL_PATTERN.test(c.from.address ?? '')) {
      issues.push({ path: 'from.address', level: 'error', message: 'is required and must be a valid email address' });
    }
    return issues;
  }

  validateBody(channel: Channel, body: string): ValidationIssue[] {
    if (!this.channels.includes(channel)) {
      return [{ path: 'channel', level: 'error', message: `smtp does not serve the ${channel} channel` }];
    }
    return validateBodyForChannel(channel, body);
  }

  /**
   * nodemailer transport options for the configured `security` (SPEC section 5.2): `ssl` is an
   * implicit TLS connection, `starttls` requires the upgrade, `none` neither. TLS verification is
   * left at nodemailer's default (on) and there is no option to turn it off.
   */
  transportOptions(): SMTPTransportOptions {
    const c = this.config;
    return {
      host: c.host,
      port: c.port,
      secure: c.security === 'ssl',
      requireTLS: c.security === 'starttls',
      auth: { user: c.username, pass: c.password },
      connectionTimeout: PROVIDER_TIMEOUT_MS,
      greetingTimeout: PROVIDER_TIMEOUT_MS,
      socketTimeout: PROVIDER_TIMEOUT_MS,
    };
  }

  async send(req: SendRequest): Promise<RecipientResult[]> {
    try {
      if (req.channel !== 'email') {
        return req.recipients.map((recipient) => ({ recipient, ok: false, error: `smtp does not serve the ${req.channel} channel` }));
      }
      return await this.semaphore.run(() => this.sendMessage(req));
    } catch (err) {
      // Defensive: nothing above should throw, but a provider must never reject (SPEC section 6, rule 4).
      const error = this.redact(err instanceof Error ? err.message : String(err));
      return req.recipients.map((recipient) => ({ recipient, ok: false, error }));
    }
  }

  /**
   * Settings UI Test connection (SPEC section 11.2, item 3): nodemailer `verify()` on a throwaway
   * transport, which connects, negotiates TLS and logs in without sending a message.
   */
  async testConnection(): Promise<ConnectionTestResult> {
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new SmtpTimeoutError()), PROVIDER_TIMEOUT_MS);
    });
    const transport = this.factory(this.transportOptions());
    try {
      if (!transport.verify) {
        return { ok: false, message: 'SMTP: this transport cannot verify connections' };
      }
      await Promise.race([transport.verify(), timeout]);
      return { ok: true, message: `Connected to ${this.config.host}:${this.config.port} and logged in.` };
    } catch (err) {
      return { ok: false, message: this.describe(asMailError(err)) };
    } finally {
      clearTimeout(timer);
      transport.close?.();
    }
  }

  private getTransport(): MailTransport {
    if (!this.transport) {
      this.transport = this.factory(this.transportOptions());
    }
    return this.transport;
  }

  /** Scrubs the login from any text that goes into a result (SPEC section 12, item 4). */
  private redact(text: string): string {
    let out = text;
    for (const secret of [this.config.password, this.config.username]) {
      if (secret && secret.length > 0) {
        out = out.split(secret).join('[redacted]');
      }
    }
    return out;
  }

  private async sendMessage(req: SendRequest): Promise<RecipientResult[]> {
    const from = this.config.from;
    const fromName = from.name ? stripLineBreaks(from.name) : '';
    const identity = fromName ? { name: fromName, address: from.address } : { address: from.address };
    // Recipients see each other in To unless the action hides them; a single recipient always goes in To.
    const hide = req.bcc === true && req.recipients.length > 1;
    const mail: SendMailOptions = {
      from: identity,
      ...(hide ? { to: identity, bcc: req.recipients } : { to: req.recipients }),
      subject: stripLineBreaks(req.subject ?? ''),
      text: req.body,
    };

    const first = await this.attempt(req.recipients, mail);
    if (!first.transient) {
      return first.results;
    }
    this.log.debug(`smtp ${this.id}: retrying after ${PROVIDER_RETRY_BACKOFF_MS / 1000}s: ${first.results[0]?.error ?? 'transient failure'}`);
    await sleep(PROVIDER_RETRY_BACKOFF_MS);
    return (await this.attempt(req.recipients, mail)).results;
  }

  private async attempt(recipients: string[], mail: SendMailOptions): Promise<Attempt> {
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new SmtpTimeoutError()), PROVIDER_TIMEOUT_MS);
    });
    try {
      const info = await Promise.race([this.getTransport().sendMail(mail), timeout]);
      return { results: this.mapInfo(recipients, info), transient: false };
    } catch (err) {
      return this.mapError(recipients, asMailError(err));
    } finally {
      clearTimeout(timer);
    }
  }

  /** Reduces a nodemailer error to its code, message and the server's reply line, with the login scrubbed. */
  private describe(err: MailError): string {
    const code = typeof err.code === 'string' ? err.code : undefined;
    const message = shortMessage(err.message ?? '', 200);
    const response = shortMessage(err.response ?? '', 200);
    let text = message.length > 0 ? message : 'unknown error';
    if (response.length > 0 && !text.includes(response)) {
      text = `${text} (${response})`;
    }
    return this.redact(code ? `SMTP ${code}: ${text}` : `SMTP: ${text}`);
  }

  /** Builds the per-recipient error map from the `rejected` and `rejectedErrors` fields nodemailer fills in. */
  private rejections(rejected: unknown, rejectedErrors: unknown): Map<string, string> {
    const out = new Map<string, string>();
    if (Array.isArray(rejectedErrors)) {
      for (const item of rejectedErrors) {
        const rejection = asMailError(item);
        if (typeof rejection.recipient === 'string') {
          out.set(rejection.recipient.toLowerCase(), this.describe(rejection));
        }
      }
    }
    if (Array.isArray(rejected)) {
      for (const address of rejected) {
        if (typeof address === 'string' && !out.has(address.toLowerCase())) {
          out.set(address.toLowerCase(), 'SMTP: recipient rejected by the server');
        }
      }
    }
    return out;
  }

  /** A resolved `sendMail`: everyone not rejected by the server shares the `messageId` (SPEC section 6.3). */
  private mapInfo(recipients: string[], info: SentMessageInfo): RecipientResult[] {
    const rejected = this.rejections(info.rejected, info.rejectedErrors);
    const id = typeof info.messageId === 'string' && info.messageId.length > 0 ? info.messageId : undefined;
    const accepted = recipients.length - rejected.size;
    this.log.debug(`smtp ${this.id}: message accepted for ${accepted} of ${recipients.length} recipient(s)${id ? ` (${id})` : ''}`);
    return recipients.map((recipient) => {
      const error = rejected.get(recipient.toLowerCase());
      return error ? { recipient, ok: false, error } : { recipient, ok: true, id };
    });
  }

  /** A rejected `sendMail`: the message went to nobody. Per-recipient rejections are kept when the server reported them. */
  private mapError(recipients: string[], err: MailError): Attempt {
    const rejected = this.rejections(err.rejected, err.rejectedErrors);
    const general = this.describe(err);
    const results = recipients.map((recipient) => ({ recipient, ok: false, error: rejected.get(recipient.toLowerCase()) ?? general }));
    return { results, transient: isTransient(err) };
  }
}
