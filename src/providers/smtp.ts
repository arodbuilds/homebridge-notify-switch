import type { PluginLogger } from '../logging.js';
import type { Channel, Provider, RecipientResult, SendRequest, SmtpProviderConfig, ValidationIssue } from '../types.js';
import { PROVIDER_CHANNELS, SMTP_SECURITIES } from '../types.js';
import { notImplementedResults, validateBodyForChannel } from './bodyRules.js';
import { EMAIL_PATTERN } from '../patterns.js';

/**
 * SMTP provider (SPEC section 6.3). This version validates the configuration so users can set it up
 * ahead of time; sending is a later phase and resolves to a clear "not yet implemented" result.
 */
export class SmtpProvider implements Provider {
  readonly type = 'smtp' as const;
  readonly channels: Channel[] = [...PROVIDER_CHANNELS.smtp];

  constructor(private readonly config: SmtpProviderConfig, private readonly log: PluginLogger) {}

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

  async send(req: SendRequest): Promise<RecipientResult[]> {
    this.log.debug(`smtp ${this.id}: send requested but this provider type is not implemented yet`);
    return notImplementedResults(req.recipients, this.type, req.channel);
  }
}
