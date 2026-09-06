import { ACCOUNT_SID_PATTERN, API_KEY_SID_PATTERN, E164_PATTERN, EMAIL_PATTERN, MESSAGING_SERVICE_SID_PATTERN } from '../patterns.js';
import type { PluginLogger } from '../logging.js';
import { PROVIDER_CONCURRENCY } from '../settings.js';
import { stripLineBreaks } from '../template.js';
import type { Channel, Provider, RecipientResult, SendRequest, TwilioProviderConfig, ValidationIssue } from '../types.js';
import { PROVIDER_CHANNELS } from '../types.js';
import { validateBodyForChannel } from './bodyRules.js';
import { parseJson, request, Semaphore, shortMessage } from './http.js';

const TWILIO_API = 'https://api.twilio.com/2010-04-01';
const TWILIO_EMAIL_API = 'https://comms.twilio.com/v1/Emails';

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
export class TwilioProvider implements Provider {
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
        return await Promise.all(req.recipients.map((recipient) => this.semaphore.run(() => this.sendSms(req, recipient))));
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

  private headers(contentType: string): Record<string, string> {
    return {
      'Authorization': this.authorization,
      'Content-Type': contentType,
      'Accept': 'application/json',
    };
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
   * SPEC section 6.2: one request per action with every recipient in `to`; `operationId` is the id for
   * all of them. The API takes `from` and `to` as `{ address, name }` objects and requires
   * `content.subject` and `content.html`; `content.text` carries the plain body.
   */
  private async sendEmail(req: SendRequest): Promise<RecipientResult[]> {
    const from = this.config.emailFrom;
    if (!from) {
      return req.recipients.map((recipient) => ({ recipient, ok: false, error: 'emailFrom is not configured on this provider' }));
    }
    const fromName = from.name ? stripLineBreaks(from.name) : '';
    const payload = {
      from: fromName ? { address: from.address, name: fromName } : { address: from.address },
      to: req.recipients.map((address) => ({ address })),
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
