import type { PluginLogger } from '../logging.js';
import { BOT_TOKEN_PATTERN } from '../patterns.js';
import { MAX_LISTED_CHATS, PROVIDER_CONCURRENCY } from '../settings.js';
import type {
  BotIdentity, Channel, ChatSummary, ConnectionTestResult, Provider, ProviderDiagnostics, RecipientResult, SendRequest, TelegramProviderConfig,
  ValidationIssue,
} from '../types.js';
import { PROVIDER_CHANNELS, TELEGRAM_PARSE_MODES } from '../types.js';
import { validateBodyForChannel } from './bodyRules.js';
import type { HttpResponse } from './http.js';
import { parseJson, request, Semaphore, sendEach, shortMessage } from './http.js';

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Human readable label for a chat object (SPEC section 11.2, item 5): the title for groups, supergroups
 * and channels; the first name and username for private chats.
 */
function describeChat(chat: Record<string, unknown>): string {
  const title = shortMessage(chat.title ?? '', 64);
  if (title) {
    return title;
  }
  const name = shortMessage(chat.first_name ?? '', 64);
  const username = typeof chat.username === 'string' && chat.username.length > 0 ? `@${shortMessage(chat.username, 32)}` : '';
  if (name && username) {
    return `${name} (${username})`;
  }
  return name || username || 'Unnamed chat';
}

/** Telegram bot usernames are 5 to 32 letters, digits and underscores; anything else is not put in a link. */
function cleanUsername(value: unknown): string | undefined {
  return typeof value === 'string' && /^[A-Za-z0-9_]{5,32}$/.test(value) ? value : undefined;
}

/**
 * Telegram provider (SPEC section 6.4): one `sendMessage` request per chat id, concurrency 5,
 * readable errors for blocked bots and bad chat ids, `retry_after` honored once on 429.
 */
export class TelegramProvider implements Provider, ProviderDiagnostics {
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
      // One request per chat id; a failure for one chat never stops the others (see `sendEach`).
      return await sendEach(req.recipients, this.semaphore, (chatId) => this.sendMessage(req, chatId), { redact: [this.config.botToken] });
    } catch (err) {
      // Defensive: nothing above should throw, but a provider must never reject (SPEC section 6, rule 4).
      const error = err instanceof Error ? err.message : String(err);
      return req.recipients.map((recipient) => ({ recipient, ok: false, error }));
    }
  }

  /** Settings UI Test connection (SPEC section 11.2, item 3): `getMe`. */
  async testConnection(): Promise<ConnectionTestResult> {
    const outcome = await this.call('getMe');
    if (!outcome.ok) {
      return { ok: false, message: outcome.message };
    }
    const result = isRecord(outcome.result) ? outcome.result : {};
    const username = shortMessage(result.username ?? '', 64);
    const name = shortMessage(result.first_name ?? '', 64);
    return { ok: true, message: `Connected to Telegram as ${username ? `@${username}` : (name || 'the bot')}.` };
  }

  /** Onboarding flow (SPEC section 11.2, item 10): `getMe`, reporting the bot's username so the UI can build links. */
  async getMe(): Promise<BotIdentity> {
    const outcome = await this.call('getMe');
    if (!outcome.ok) {
      return { ok: false, message: outcome.message };
    }
    const result = isRecord(outcome.result) ? outcome.result : {};
    const username = cleanUsername(result.username);
    if (!username) {
      return { ok: false, message: 'Telegram answered without a bot username. Check the token from BotFather.' };
    }
    return { ok: true, message: `Connected to @${username}`, username };
  }

  /**
   * Settings UI Find people and groups (SPEC section 11.2, item 5): `getUpdates` reduced to the distinct
   * chats the bot has seen. `my_chat_member` updates are included so a group appears as soon as the bot is
   * added to it, before anyone posts. Only chat ids, titles and types leave this method: one call, at most
   * 100 updates, at most `MAX_LISTED_CHATS` distinct chats, titles cut to 64 characters (SPEC section 12, item 12).
   */
  async findChats(): Promise<{ ok: boolean; message: string; chats: ChatSummary[] }> {
    const outcome = await this.call('getUpdates', { limit: 100, allowed_updates: ['message', 'channel_post', 'my_chat_member'] });
    if (!outcome.ok) {
      return { ok: false, message: outcome.message, chats: [] };
    }
    const chats = new Map<string, ChatSummary>();
    for (const update of Array.isArray(outcome.result) ? outcome.result : []) {
      if (!isRecord(update)) {
        continue;
      }
      for (const key of ['message', 'edited_message', 'channel_post', 'my_chat_member']) {
        const item = update[key];
        const chat = isRecord(item) && isRecord(item.chat) ? item.chat : undefined;
        if (!chat || (typeof chat.id !== 'number' && typeof chat.id !== 'string')) {
          continue;
        }
        const id = String(chat.id);
        if (!chats.has(id) && chats.size < MAX_LISTED_CHATS) {
          chats.set(id, { id, title: describeChat(chat), type: typeof chat.type === 'string' ? chat.type : 'chat' });
        }
      }
    }
    const list = [...chats.values()];
    const message = list.length === 0
      ? 'No people or groups found yet. Open the bot and press Start, or add it to a group, then try again. '
        + 'Telegram only keeps recent updates, and a webhook set on the bot hides them.'
      : `Found ${list.length} chat${list.length === 1 ? '' : 's'}.`;
    return { ok: true, message, chats: list };
  }

  /** One Bot API call with the token scrubbed from every error (SPEC section 12, item 4). */
  private async call(method: string, payload?: Record<string, unknown>): Promise<{ ok: true; result: unknown } | { ok: false; message: string }> {
    try {
      const url = `${TELEGRAM_API}/bot${this.config.botToken}/${method}`;
      const outcome = await request(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify(payload ?? {}),
      }, { redact: [this.config.botToken], retryAfterFromBody });
      if (!outcome.ok) {
        return { ok: false, message: outcome.error };
      }
      const { status, text } = outcome.response;
      const json = parseJson(text);
      if (json?.ok === true) {
        return { ok: true, result: json.result };
      }
      const description = shortMessage(json?.description ?? '', 200).split(this.config.botToken).join('[redacted]');
      const code = typeof json?.error_code === 'number' ? json.error_code : status;
      if (code === 401 || code === 404) {
        return { ok: false, message: `Telegram rejected the bot token (error ${code}). Check the token from BotFather.` };
      }
      if (code === 409) {
        return {
          ok: false,
          message: 'Telegram error 409: a webhook is set on this bot, so updates cannot be fetched. Remove it with deleteWebhook or use another bot.',
        };
      }
      return { ok: false, message: `Telegram error ${code}: ${description || `HTTP ${status}`}` };
    } catch (err) {
      return { ok: false, message: (err instanceof Error ? err.message : String(err)).split(this.config.botToken).join('[redacted]') };
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
