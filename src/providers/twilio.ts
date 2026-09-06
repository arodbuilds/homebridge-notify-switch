import { ACCOUNT_SID_PATTERN, API_KEY_SID_PATTERN, E164_PATTERN, EMAIL_PATTERN, MESSAGING_SERVICE_SID_PATTERN } from '../patterns.js';
import type { PluginLogger } from '../logging.js';
import { PROVIDER_CONCURRENCY } from '../settings.js';
import type { Channel, Provider, RecipientResult, SendRequest, TwilioProviderConfig, ValidationIssue } from '../types.js';
import { PROVIDER_CHANNELS } from '../types.js';
import { notImplementedResults, validateBodyForChannel } from './bodyRules.js';
import { parseJson, request, Semaphore, shortMessage } from './http.js';


const TWILIO_API = 'https://api.twilio.com/2010-04-01';

/**
 * Twilio provider (SPEC section 6.1). Serves `sms` now; `email` (section 6.2) is a later phase and
 * resolves to a clear "not yet implemented" result for every recipient.
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
      default:
        return notImplementedResults(req.recipients, this.type, req.channel);
      }
    } catch (err) {
      // Defensive: nothing above should throw, but a provider must never reject (SPEC section 6, rule 4).
      const error = err instanceof Error ? err.message : String(err);
      return req.recipients.map((recipient) => ({ recipient, ok: false, error }));
    }
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
      headers: {
        'Authorization': this.authorization,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'application/json',
      },
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

    const code = json?.code !== undefined ? shortMessage(json.code, 20) : undefined;
    const message = shortMessage(json?.message ?? '', 200);
    const detail = message.length > 0 ? message : `HTTP ${status}`;
    const error = code ? `Twilio error ${code}: ${detail}` : `Twilio HTTP ${status}: ${detail}`;
    return { recipient, ok: false, error };
  }
}
