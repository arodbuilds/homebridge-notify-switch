import type { PluginLogger } from '../logging.js';
import { BOT_TOKEN_PATTERN } from '../patterns.js';
import { PROVIDER_CONCURRENCY } from '../settings.js';
import type { Channel, Provider, RecipientResult, SendRequest, TelegramProviderConfig, ValidationIssue } from '../types.js';
import { PROVIDER_CHANNELS, TELEGRAM_PARSE_MODES } from '../types.js';
import { validateBodyForChannel } from './bodyRules.js';
import type { HttpResponse } from './http.js';
import { parseJson, request, Semaphore, shortMessage } from './http.js';

const TELEGRAM_API = 'https://api.telegram.org';

/** Bot API `parse_mode` values for the configured `parseMode`. `none` sends plain text with no `parse_mode`. */
const PARSE_MODE_VALUES: Record<TelegramProviderConfig['parseMode'], string | undefined> = {
  none: undefined,
  markdown: 'Markdown',
  html: 'HTML',
};

/** Reads `parameters.retry_after` from a 429 response body (SPEC section 6.4). */
function retryAfterFromBody(response: HttpResponse): number | undefined {
  const json = parseJson(response.text);
  const parameters = json?.parameters;
  if (parameters && typeof parameters === 'object') {
    const retryAfter = (parameters as { retry_after?: unknown }).retry_after;
    if (typeof retryAfter === 'number' && Number.isFinite(retryAfter)) {
      return retryAfter;
    }
  }
  return undefined;
}

/**
 * Telegram provider (SPEC section 6.4): one `sendMessage` request per chat id, concurrency 5,
 * readable errors for blocked bots and bad chat ids, `retry_after` honored once on 429.
 */
export class TelegramProvider implements Provider {
  readonly type = 'telegram' as const;
  readonly channels: Channel[] = [...PROVIDER_CHANNELS.telegram];
  private readonly semaphore = new Semaphore(PROVIDER_CONCURRENCY);

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
    try {
      if (req.channel !== 'telegram') {
        return req.recipients.map((recipient) => ({ recipient, ok: false, error: `telegram does not serve the ${req.channel} channel` }));
      }
      return await Promise.all(req.recipients.map((chatId) => this.semaphore.run(() => this.sendMessage(req, chatId))));
    } catch (err) {
      // Defensive: nothing above should throw, but a provider must never reject (SPEC section 6, rule 4).
      const error = err instanceof Error ? err.message : String(err);
      return req.recipients.map((recipient) => ({ recipient, ok: false, error }));
    }
  }

  private async sendMessage(req: SendRequest, chatId: string): Promise<RecipientResult> {
    const payload: Record<string, string> = { chat_id: chatId, text: req.body };
    const parseMode = PARSE_MODE_VALUES[this.config.parseMode];
    if (parseMode) {
      payload.parse_mode = parseMode;
    }

    // The token is part of the URL, so every error string is scrubbed of it (SPEC section 12, item 4).
    const url = `${TELEGRAM_API}/bot${this.config.botToken}/sendMessage`;
    const outcome = await request(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify(payload),
    }, {
      redact: [this.config.botToken],
      retryAfterFromBody,
    });

    if (!outcome.ok) {
      return { recipient: chatId, ok: false, error: outcome.error };
    }

    const { status, text } = outcome.response;
    const json = parseJson(text);
    if (json?.ok === true) {
      const result = json.result;
      const messageId = result && typeof result === 'object' ? (result as { message_id?: unknown }).message_id : undefined;
      const id = typeof messageId === 'number' || typeof messageId === 'string' ? String(messageId) : undefined;
      this.log.debug(`telegram ${this.id}: message accepted for chat ${this.log.address(chatId, 'telegram')}${id ? ` (${id})` : ''}`);
      return { recipient: chatId, ok: true, id };
    }

    const description = shortMessage(json?.description ?? '', 200).split(this.config.botToken).join('[redacted]');
    const code = typeof json?.error_code === 'number' ? json.error_code : status;
    const detail = description.length > 0 ? description : `HTTP ${status}`;
    switch (code) {
    case 403:
      return { recipient: chatId, ok: false, error: `Telegram error 403: the bot is blocked by this chat or has not been started by the user (${detail})` };
    case 400:
      return { recipient: chatId, ok: false, error: `Telegram error 400: chat id not found or message rejected; check the chat id and parseMode (${detail})` };
    case 401:
      return { recipient: chatId, ok: false, error: `Telegram error 401: the bot token was rejected (${detail})` };
    default:
      return { recipient: chatId, ok: false, error: `Telegram error ${code}: ${detail}` };
    }
  }
}
