import { ACCOUNT_SID_PATTERN, API_KEY_SID_PATTERN, E164_PATTERN, EMAIL_PATTERN, MESSAGING_SERVICE_SID_PATTERN } from '../patterns.js';
import type { PluginLogger } from '../logging.js';
import { PROVIDER_CONCURRENCY } from '../settings.js';
import { stripLineBreaks } from '../template.js';
import type {
  Channel, ConnectionTestResult, Provider, ProviderDiagnostics, RecipientResult, SendRequest, TwilioLookupResult, TwilioNumber, TwilioProviderConfig,
  TwilioService, ValidationIssue,
} from '../types.js';
import { PROVIDER_CHANNELS } from '../types.js';
import { validateBodyForChannel } from './bodyRules.js';
import { parseJson, request, Semaphore, sendEach, shortMessage } from './http.js';

const TWILIO_API = 'https://api.twilio.com/2010-04-01';
const TWILIO_EMAIL_API = 'https://comms.twilio.com/v1/Emails';
const TWILIO_MESSAGING_API = 'https://messaging.twilio.com/v1';

/** Page size of the "Look up numbers" lists (SPEC section 11.2, item 9). */
export const TWILIO_LOOKUP_PAGE_SIZE = 20;

/** Copy from SPEC section 11.3 for the "Look up numbers" outcomes. */
export const TWILIO_LOOKUP_TRUNCATED = 'Showing the first 20; enter others manually.';
export const TWILIO_LOOKUP_DENIED = 'This API key cannot list numbers. Enter them manually.';

type ListOutcome<T> = { ok: true; items: T[]; more: boolean } | { ok: false; denied: boolean; error: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const HTML_ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', '\'': '&#39;' };

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (ch) => HTML_ESCAPES[ch]);
}

/**
 * The Emails API requires `content.html`. Bodies are plain text (SPEC section 5.5, item 8), so the
 * HTML part is the same text escaped and wrapped in a `pre` that keeps line breaks and wraps long lines.
 */
export function plainTextAsHtml(body: string): string {
  return `<pre style="font-family: inherit; white-space: pre-wrap">${escapeHtml(body)}</pre>`;
}

/**
 * Twilio provider. Serves `sms` (SPEC section 6.1) with one request per recipient and `email`
 * (SPEC section 6.2) with one request per action carrying every recipient.
 */
export class TwilioProvider implements Provider, ProviderDiagnostics {
  readonly type = 'twilio' as const;
  readonly channels: Channel[] = [...PROVIDER_CHANNELS.twilio];
  private readonly semaphore = new Semaphore(PROVIDER_CONCURRENCY);
  private readonly authorization: string;

  constructor(private readonly config: TwilioProviderConfig, private readonly log: PluginLogger) {
    this.authorization = 'Basic ' + Buffer.from(`${config.apiKeySid}:${config.apiKeySecret}`, 'utf8').toString('base64');
  }

  get id(): string {
    return this.config.id;
  }

  validateConfig(): ValidationIssue[] {
    const issues: ValidationIssue[] = [];
    const c = this.config;
    if (!ACCOUNT_SID_PATTERN.test(c.accountSid ?? '')) {
      issues.push({ path: 'accountSid', level: 'error', message: 'must start with AC followed by 32 hexadecimal characters' });
    }
    if (!API_KEY_SID_PATTERN.test(c.apiKeySid ?? '')) {
      issues.push({ path: 'apiKeySid', level: 'error', message: 'must start with SK followed by 32 hexadecimal characters' });
    }
    if (typeof c.apiKeySecret !== 'string' || c.apiKeySecret.trim().length === 0) {
      issues.push({ path: 'apiKeySecret', level: 'error', message: 'is required' });
    }
    c.smsSenders.forEach((sender, i) => {
      if (!E164_PATTERN.test(sender)) {
        issues.push({ path: `smsSenders[${i}]`, level: 'error', message: `"${sender}" is not an E.164 phone number (for example +16785550100)` });
      }
    });
    if (c.messagingServiceSid && !MESSAGING_SERVICE_SID_PATTERN.test(c.messagingServiceSid)) {
      issues.push({ path: 'messagingServiceSid', level: 'error', message: 'must start with MG followed by 32 hexadecimal characters' });
    }
    if (c.emailFrom && !EMAIL_PATTERN.test(c.emailFrom.address ?? '')) {
      issues.push({ path: 'emailFrom.address', level: 'error', message: 'is not a valid email address' });
    }
    return issues;
  }

  validateBody(channel: Channel, body: string): ValidationIssue[] {
    if (!this.channels.includes(channel)) {
      return [{ path: 'channel', level: 'error', message: `twilio does not serve the ${channel} channel` }];
    }
    return validateBodyForChannel(channel, body);
  }

  async send(req: SendRequest): Promise<RecipientResult[]> {
    try {
      switch (req.channel) {
      case 'sms':
        // One request per recipient; a failure for one number never stops the others (see `sendEach`).
        return await sendEach(req.recipients, this.semaphore, (recipient) => this.sendSms(req, recipient), {
          redact: [this.config.apiKeySecret, this.config.apiKeySid],
        });
      case 'email':
        return await this.semaphore.run(() => this.sendEmail(req));
      default:
        return req.recipients.map((recipient) => ({ recipient, ok: false, error: `twilio does not serve the ${req.channel} channel` }));
      }
    } catch (err) {
      // Defensive: nothing above should throw, but a provider must never reject (SPEC section 6, rule 4).
      const error = err instanceof Error ? err.message : String(err);
      return req.recipients.map((recipient) => ({ recipient, ok: false, error }));
    }
  }

  /**
   * Settings UI Test connection (SPEC section 11.2, item 3): list one message on the account with the
   * API key. Nothing is sent. The Messages list is used rather than the Account resource because
   * Twilio answered 401 on the Account resource for a valid Standard key, and a Restricted key scoped
   * to Messaging cannot read it at all, while any key that can send SMS can read this list.
   * Twilio's error code and message are kept in the result.
   */
  async testConnection(): Promise<ConnectionTestResult> {
    try {
      const url = `${TWILIO_API}/Accounts/${encodeURIComponent(this.config.accountSid)}/Messages.json?PageSize=1`;
      const outcome = await request(url, { method: 'GET', headers: this.headers() }, {
        redact: [this.config.apiKeySecret, this.config.apiKeySid],
      });
      if (!outcome.ok) {
        return { ok: false, message: outcome.error };
      }
      const { status, text } = outcome.response;
      const json = parseJson(text);
      if (status === 200) {
        return { ok: true, message: 'Connected to Twilio. The API key can access messages on this account.' };
      }
      const detail = this.twilioErrorDetail(json);
      if (status === 401) {
        return { ok: false, message: `Twilio rejected the API key${detail}. Check the API Key SID and Secret.` };
      }
      if (status === 403) {
        return { ok: false, message: `Twilio refused this API key access to messages${detail}. A Restricted key needs Messaging permissions on this account.` };
      }
      if (status === 404) {
        return { ok: false, message: `Twilio could not find that Account SID with this API key${detail}. Check the Account SID.` };
      }
      return { ok: false, message: this.describeFailure(status, json) };
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : String(err) };
    }
  }

  /**
   * Settings UI "Look up numbers" (SPEC section 11.2, item 9): the account's phone numbers and Messaging
   * Services, one page of each, with the same Basic auth as everything else. Nothing is sent. A key that
   * may not list numbers (401 or 403) gets the fixed copy from section 11.3; a page that reports more
   * entries than it holds sets `truncated`.
   */
  async lookupSenders(): Promise<TwilioLookupResult> {
    try {
      const account = encodeURIComponent(this.config.accountSid);
      const [numbers, services] = await Promise.all([
        this.list<TwilioNumber>(
          `${TWILIO_API}/Accounts/${account}/IncomingPhoneNumbers.json?PageSize=${TWILIO_LOOKUP_PAGE_SIZE}`,
          'incoming_phone_numbers',
          (json) => typeof json.next_page_uri === 'string' && json.next_page_uri.length > 0,
          (item) => {
            const phoneNumber = typeof item.phone_number === 'string' ? item.phone_number : '';
            return E164_PATTERN.test(phoneNumber) ? { phoneNumber, friendlyName: shortMessage(item.friendly_name ?? '', 64) } : undefined;
          },
        ),
        this.list<TwilioService>(
          `${TWILIO_MESSAGING_API}/Services?PageSize=${TWILIO_LOOKUP_PAGE_SIZE}`,
          'services',
          (json) => isRecord(json.meta) && typeof json.meta.next_page_url === 'string' && json.meta.next_page_url.length > 0,
          (item) => {
            const sid = typeof item.sid === 'string' ? item.sid : '';
            return MESSAGING_SERVICE_SID_PATTERN.test(sid) ? { sid, friendlyName: shortMessage(item.friendly_name ?? '', 64) } : undefined;
          },
        ),
      ]);
      if (!numbers.ok && !services.ok) {
        return { ok: false, message: numbers.denied ? TWILIO_LOOKUP_DENIED : numbers.error, numbers: [], services: [], truncated: false };
      }
      const truncated = (numbers.ok && numbers.more) || (services.ok && services.more);
      const parts: string[] = [];
      if (numbers.ok) {
        parts.push(`Found ${numbers.items.length} phone number${numbers.items.length === 1 ? '' : 's'}`);
      }
      if (services.ok) {
        parts.push(`${numbers.ok ? 'and ' : 'Found '}${services.items.length} Messaging Service${services.items.length === 1 ? '' : 's'}`);
      }
      let message = `${parts.join(' ')}.`;
      if (!numbers.ok) {
        message = numbers.denied ? TWILIO_LOOKUP_DENIED : `Phone numbers could not be listed: ${numbers.error}`;
      } else if (!services.ok) {
        message += services.denied ? ' This API key cannot list Messaging Services.' : ` Messaging Services could not be listed: ${services.error}`;
      }
      if (truncated) {
        message += ` ${TWILIO_LOOKUP_TRUNCATED}`;
      }
      return {
        ok: true, message, truncated,
        numbers: numbers.ok ? numbers.items : [],
        services: services.ok ? services.items : [],
      };
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : String(err), numbers: [], services: [], truncated: false };
    }
  }

  /** One GET of a Twilio list resource, reduced to the items `pick` accepts and a "more pages" flag. */
  private async list<T>(
    url: string, key: string, hasMore: (json: Record<string, unknown>) => boolean, pick: (item: Record<string, unknown>) => T | undefined,
  ): Promise<ListOutcome<T>> {
    const outcome = await request(url, { method: 'GET', headers: this.headers() }, { redact: [this.config.apiKeySecret, this.config.apiKeySid] });
    if (!outcome.ok) {
      return { ok: false, denied: false, error: outcome.error };
    }
    const { status, text } = outcome.response;
    const json = parseJson(text);
    if (status === 401 || status === 403) {
      return { ok: false, denied: true, error: this.describeFailure(status, json) };
    }
    if (status !== 200 || !json) {
      return { ok: false, denied: false, error: this.describeFailure(status, json) };
    }
    const raw = Array.isArray(json[key]) ? (json[key] as unknown[]) : [];
    const items: T[] = [];
    for (const item of raw) {
      const picked = isRecord(item) ? pick(item) : undefined;
      if (picked !== undefined) {
        items.push(picked);
      }
    }
    return { ok: true, items, more: hasMore(json) || raw.length > TWILIO_LOOKUP_PAGE_SIZE };
  }

  /** Request headers: Basic auth of `apiKeySid:apiKeySecret` (never the Account SID) plus a content type when there is a body. */
  private headers(contentType?: string): Record<string, string> {
    const headers: Record<string, string> = { 'Authorization': this.authorization, 'Accept': 'application/json' };
    if (contentType) {
      headers['Content-Type'] = contentType;
    }
    return headers;
  }

  /** Twilio's `code` and `message` from an error body as a parenthetical, or an empty string when the body has neither. */
  private twilioErrorDetail(json: Record<string, unknown> | undefined): string {
    const code = json?.code !== undefined ? shortMessage(json.code, 20) : '';
    const message = shortMessage(json?.message ?? '', 200);
    if (!code && !message) {
      return '';
    }
    const inner = code && message ? `error ${code}: ${message}` : code ? `error ${code}` : message;
    return ` (Twilio ${inner})`;
  }

  /** Reduces a Twilio error response to its `code` and `message` (SPEC section 6.1, section 8 item 5). */
  private describeFailure(status: number, json: Record<string, unknown> | undefined): string {
    const code = json?.code !== undefined ? shortMessage(json.code, 20) : undefined;
    const message = shortMessage(json?.message ?? '', 200);
    const detail = message.length > 0 ? message : `HTTP ${status}`;
    return code ? `Twilio error ${code}: ${detail}` : `Twilio HTTP ${status}: ${detail}`;
  }

  private async sendSms(req: SendRequest, recipient: string): Promise<RecipientResult> {
    const form = new URLSearchParams();
    form.set('To', recipient);
    form.set('Body', req.body);
    if (req.sender) {
      form.set('From', req.sender);
    } else if (this.config.messagingServiceSid) {
      form.set('MessagingServiceSid', this.config.messagingServiceSid);
    } else {
      return { recipient, ok: false, error: 'no sender available: set smsSenders or messagingServiceSid on the provider' };
    }

    const url = `${TWILIO_API}/Accounts/${encodeURIComponent(this.config.accountSid)}/Messages.json`;
    const outcome = await request(url, {
      method: 'POST',
      headers: this.headers('application/x-www-form-urlencoded'),
      body: form.toString(),
    }, {
      redact: [this.config.apiKeySecret, this.config.apiKeySid],
    });

    if (!outcome.ok) {
      return { recipient, ok: false, error: outcome.error };
    }

    const { status, text } = outcome.response;
    const json = parseJson(text);
    if (status === 201) {
      const sid = typeof json?.sid === 'string' ? json.sid : undefined;
      this.log.debug(`twilio ${this.id}: message accepted for ${this.log.address(recipient, 'sms')}${sid ? ` (${sid})` : ''}`);
      return { recipient, ok: true, id: sid };
    }
    return { recipient, ok: false, error: this.describeFailure(status, json) };
  }

  /**
   * SPEC section 6.2: one request per action with every recipient in `to` (or, when the action hides
   * recipients from each other and there is more than one, in `bcc` with the from address in `to`);
   * `operationId` is the id for all of them. The API takes `from`, `to` and `bcc` as `{ address, name }`
   * objects and requires `content.subject` and `content.html`; `content.text` carries the plain body.
   */
  private async sendEmail(req: SendRequest): Promise<RecipientResult[]> {
    const from = this.config.emailFrom;
    if (!from) {
      return req.recipients.map((recipient) => ({ recipient, ok: false, error: 'emailFrom is not configured on this provider' }));
    }
    const fromName = from.name ? stripLineBreaks(from.name) : '';
    const hide = req.bcc === true && req.recipients.length > 1;
    const payload = {
      from: fromName ? { address: from.address, name: fromName } : { address: from.address },
      to: hide ? [{ address: from.address }] : req.recipients.map((address) => ({ address })),
      ...(hide ? { bcc: req.recipients.map((address) => ({ address })) } : {}),
      content: {
        subject: stripLineBreaks(req.subject ?? ''),
        html: plainTextAsHtml(req.body),
        text: req.body,
      },
    };

    const outcome = await request(TWILIO_EMAIL_API, {
      method: 'POST',
      headers: this.headers('application/json'),
      body: JSON.stringify(payload),
    }, {
      redact: [this.config.apiKeySecret, this.config.apiKeySid],
    });

    if (!outcome.ok) {
      return req.recipients.map((recipient) => ({ recipient, ok: false, error: outcome.error }));
    }

    const { status, text } = outcome.response;
    const json = parseJson(text);
    if (status === 202) {
      const operationId = typeof json?.operationId === 'string' ? json.operationId : undefined;
      this.log.debug(`twilio ${this.id}: email accepted for ${req.recipients.length} recipient(s)${operationId ? ` (${operationId})` : ''}`);
      return req.recipients.map((recipient) => ({ recipient, ok: true, id: operationId }));
    }
    const error = this.describeFailure(status, json);
    return req.recipients.map((recipient) => ({ recipient, ok: false, error }));
  }
}
