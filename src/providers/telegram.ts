import type { PluginLogger } from '../logging.js';
import { BOT_TOKEN_PATTERN } from '../patterns.js';
import type { Channel, Provider, RecipientResult, SendRequest, TelegramProviderConfig, ValidationIssue } from '../types.js';
import { PROVIDER_CHANNELS, TELEGRAM_PARSE_MODES } from '../types.js';
import { notImplementedResults, validateBodyForChannel } from './bodyRules.js';


/**
 * Telegram provider (SPEC section 6.4). This version validates the configuration; sending is a
 * later phase and resolves to a clear "not yet implemented" result.
 */
export class TelegramProvider implements Provider {
  readonly type = 'telegram' as const;
  readonly channels: Channel[] = [...PROVIDER_CHANNELS.telegram];

  constructor(private readonly config: TelegramProviderConfig, private readonly log: PluginLogger) {}

  get id(): string {
    return this.config.id;
  }

  validateConfig(): ValidationIssue[] {
    const issues: ValidationIssue[] = [];
    const c = this.config;
    if (!BOT_TOKEN_PATTERN.test(c.botToken ?? '')) {
      issues.push({ path: 'botToken', level: 'error', message: 'does not look like a bot token (expected digits, a colon, then at least 30 characters)' });
    }
    if (!TELEGRAM_PARSE_MODES.includes(c.parseMode)) {
      issues.push({ path: 'parseMode', level: 'error', message: `must be one of ${TELEGRAM_PARSE_MODES.join(', ')}` });
    }
    return issues;
  }

  validateBody(channel: Channel, body: string): ValidationIssue[] {
    if (!this.channels.includes(channel)) {
      return [{ path: 'channel', level: 'error', message: `telegram does not serve the ${channel} channel` }];
    }
    return validateBodyForChannel(channel, body);
  }

  async send(req: SendRequest): Promise<RecipientResult[]> {
    this.log.debug(`telegram ${this.id}: send requested but this provider type is not implemented yet`);
    return notImplementedResults(req.recipients, this.type, req.channel);
  }
}
