import type { PluginLogger } from '../logging.js';
import { NTFY_CREDENTIAL_PATTERN, NTFY_MAX_TAGS, NTFY_TAG_PATTERN, NTFY_TOPIC_PATTERN } from '../patterns.js';
import { PROVIDER_CONCURRENCY } from '../settings.js';
import { stripControlCharacters } from '../text.js';
import type {
  Channel, ConnectionTestResult, NtfyProviderConfig, Provider, ProviderDiagnostics, RecipientResult, SendRequest, ValidationIssue,
} from '../types.js';
import { NTFY_AUTHS, NTFY_PRIORITIES, PROVIDER_CHANNELS } from '../types.js';
import { validateBodyForChannel } from './bodyRules.js';
import { parseJson, request, Semaphore, sendEach, shortMessage } from './http.js';

/** Longest title sent in the `Title` header, in characters, before encoding. */
const MAX_TITLE_LENGTH = 200;

/** Basic auth usernames go before the colon in `username:password`, so they cannot hold one. */
const BASIC_USERNAME_PATTERN = /^[^:\s\p{Cc}]{1,256}$/u;
const BASIC_PASSWORD_PATTERN = /^[^\p{Cc}]{1,256}$/u;

export interface NtfyServer {
  /** `origin` plus any path, without a trailing slash, when `server` is an http or https URL. */
  url?: string;
  error?: string;
}

/**
 * Normalizes the configured server URL (SPEC section 5.2): http or https, no credentials in the URL,
 * no query or fragment, trailing slashes dropped. A path is allowed for a server behind a prefix.
 */
export function normalizeNtfyServer(server: string): NtfyServer {
  let parsed: URL;
  try {
    parsed = new URL(server.trim());
  } catch {
    return { error: 'must be a URL such as https://ntfy.sh' };
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { error: 'must start with http:// or https://' };
  }
  if (parsed.username || parsed.password) {
    return { error: 'must not carry a username or password; use the auth fields instead' };
  }
  if (parsed.search || parsed.hash) {
    return { error: 'must not carry a query string or fragment' };
  }
  return { url: `${parsed.origin}${parsed.pathname.replace(/\/+$/, '')}` };
}

/**
 * A header value for free text (the title): control characters removed, cut to a sane length, and
 * RFC 2047 encoded when it holds anything outside printable ASCII, which ntfy decodes and `fetch`
 * would otherwise reject.
 */
export function encodeHeaderText(text: string): string {
  const clean = Array.from(stripControlCharacters(text).trim()).slice(0, MAX_TITLE_LENGTH).join('');
  if (/^[ -~]*$/.test(clean)) {
    return clean;
  }
  return `=?UTF-8?B?${Buffer.from(clean, 'utf8').toString('base64')}?=`;
}

/**
 * ntfy provider (SPEC section 6.5): one POST per topic, plain text body, the title, priority and tags
 * as headers, concurrency 5, the shared timeout and retry policy, `Retry-After` honored on 429. The
 * access token or password never appears in a result.
 */
export class NtfyProvider implements Provider, ProviderDiagnostics {
  readonly type = 'ntfy' as const;
  readonly channels: Channel[] = [...PROVIDER_CHANNELS.ntfy];
  private readonly semaphore = new Semaphore(PROVIDER_CONCURRENCY);
  private readonly server: string;
  private readonly authorization?: string;

  constructor(private readonly config: NtfyProviderConfig, private readonly log: PluginLogger) {
    this.server = normalizeNtfyServer(config.server ?? '').url ?? '';
    if (config.auth === 'token' && config.token) {
      this.authorization = `Bearer ${config.token}`;
    } else if (config.auth === 'basic' && config.username && config.password) {
      this.authorization = `Basic ${Buffer.from(`${config.username}:${config.password}`, 'utf8').toString('base64')}`;
    }
  }

  get id(): string {
    return this.config.id;
  }

  validateConfig(): ValidationIssue[] {
    const issues: ValidationIssue[] = [];
    const c = this.config;
    const server = normalizeNtfyServer(c.server ?? '');
    if (server.error) {
      issues.push({ path: 'server', level: 'error', message: server.error });
    }
    if (!NTFY_AUTHS.includes(c.auth)) {
      issues.push({ path: 'auth', level: 'error', message: `must be one of ${NTFY_AUTHS.join(', ')}` });
      return issues;
    }
    switch (c.auth) {
    case 'token':
      if (typeof c.token !== 'string' || c.token.length === 0) {
        issues.push({ path: 'token', level: 'error', message: 'is required when auth is token' });
      } else if (!NTFY_CREDENTIAL_PATTERN.test(c.token)) {
        issues.push({ path: 'token', level: 'error', message: 'must not contain spaces or control characters' });
      }
      break;
    case 'basic':
      if (typeof c.username !== 'string' || c.username.length === 0) {
        issues.push({ path: 'username', level: 'error', message: 'is required when auth is basic' });
      } else if (!BASIC_USERNAME_PATTERN.test(c.username)) {
        issues.push({ path: 'username', level: 'error', message: 'must not contain a colon, spaces or control characters' });
      }
      if (typeof c.password !== 'string' || c.password.length === 0) {
        issues.push({ path: 'password', level: 'error', message: 'is required when auth is basic' });
      } else if (!BASIC_PASSWORD_PATTERN.test(c.password)) {
        issues.push({ path: 'password', level: 'error', message: 'must not contain control characters' });
      }
      break;
    case 'none':
      for (const key of ['token', 'username', 'password'] as const) {
        if (typeof c[key] === 'string' && c[key].length > 0) {
          issues.push({ path: key, level: 'warning', message: 'is ignored because auth is none' });
        }
      }
      break;
    }
    return issues;
  }

  validateBody(channel: Channel, body: string): ValidationIssue[] {
    if (!this.channels.includes(channel)) {
      return [{ path: 'channel', level: 'error', message: `ntfy does not serve the ${channel} channel` }];
    }
    return validateBodyForChannel(channel, body);
  }

  async send(req: SendRequest): Promise<RecipientResult[]> {
    try {
      if (req.channel !== 'ntfy') {
        return req.recipients.map((recipient) => ({ recipient, ok: false, error: `ntfy does not serve the ${req.channel} channel` }));
      }
      // One request per topic; a failure for one topic never stops the others (see `sendEach`).
      return await sendEach(req.recipients, this.semaphore, (topic) => this.publish(req, topic), { redact: this.secrets() });
    } catch (err) {
      // Defensive: nothing above should throw, but a provider must never reject (SPEC section 6, rule 4).
      return req.recipients.map((recipient) => ({ recipient, ok: false, error: this.redact(err instanceof Error ? err.message : String(err)) }));
    }
  }

  /**
   * Settings UI Test connection (SPEC section 11.2, item 3): GET `/v1/health`, then, when credentials
   * are configured, GET `/v1/account`, where 401 means the credentials were rejected. Nothing is sent.
   */
  async testConnection(): Promise<ConnectionTestResult> {
    try {
      if (!this.server) {
        return { ok: false, message: 'The server URL is not valid.' };
      }
      const health = await request(`${this.server}/v1/health`, { method: 'GET', headers: { Accept: 'application/json' } }, { redact: this.secrets() });
      if (!health.ok) {
        return { ok: false, message: `Could not reach ${this.server}: ${health.error}` };
      }
      const json = parseJson(health.response.text);
      if (health.response.status === 404) {
        return { ok: false, message: `ntfy server not found at ${this.server} (HTTP 404). Check the server URL.` };
      }
      if (health.response.status !== 200 || !json || json.healthy !== true) {
        const why = json && json.healthy === false ? 'reports that it is not healthy' : `did not answer like an ntfy server (HTTP ${health.response.status})`;
        return { ok: false, message: `${this.server} ${why}.` };
      }
      if (!this.authorization) {
        return { ok: true, message: `Connected to ${this.server}. No credentials are set, so the topics must allow anonymous publishing.` };
      }
      const account = await request(`${this.server}/v1/account`, { method: 'GET', headers: this.headers() }, { redact: this.secrets() });
      if (!account.ok) {
        return { ok: false, message: `Could not reach ${this.server}: ${account.error}` };
      }
      const { status, text } = account.response;
      if (status === 200) {
        return { ok: true, message: `Connected to ${this.server} and the credentials were accepted.` };
      }
      if (status === 401 || status === 403) {
        const what = this.config.auth === 'token' ? 'access token' : 'username and password';
        return { ok: false, message: `ntfy rejected the credentials (HTTP ${status}). Check the ${what}.` };
      }
      return { ok: false, message: this.describeFailure(status, parseJson(text)) };
    } catch (err) {
      return { ok: false, message: this.redact(err instanceof Error ? err.message : String(err)) };
    }
  }

  /** The values that must never appear in a result: the token, the password, and the encoded Authorization value. */
  private secrets(): string[] {
    const values = [this.config.token, this.config.password, this.authorization?.replace(/^(Bearer|Basic) /, '')];
    return values.filter((value): value is string => typeof value === 'string' && value.length > 0);
  }

  private redact(text: string): string {
    let out = text;
    for (const secret of this.secrets()) {
      out = out.split(secret).join('[redacted]');
    }
    return out;
  }

  private headers(): Record<string, string> {
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (this.authorization) {
      headers.Authorization = this.authorization;
    }
    return headers;
  }

  /** Reduces an ntfy error response (`{ code, http, error }`) to a short message (SPEC section 6.5). */
  private describeFailure(status: number, json: Record<string, unknown> | undefined, topic?: string): string {
    const detail = shortMessage(json?.error ?? '', 200);
    switch (status) {
    case 401:
    case 403:
      return `ntfy rejected the credentials${topic ? ` for topic ${topic}` : ''} (HTTP ${status})`;
    case 404:
      return 'ntfy server not found (HTTP 404); check the server URL';
    case 413:
      return `ntfy error 413: the message is too large for this server${detail ? ` (${detail})` : ''}`;
    case 429:
      return `ntfy error 429: rate limited${detail ? ` (${detail})` : ''}`;
    default: {
      const code = typeof json?.code === 'number' ? String(json.code) : String(status);
      return `ntfy error ${code}: ${detail || `HTTP ${status}`}`;
    }
    }
  }

  private async publish(req: SendRequest, topic: string): Promise<RecipientResult> {
    if (!NTFY_TOPIC_PATTERN.test(topic)) {
      return { recipient: topic, ok: false, error: 'is not a valid ntfy topic name' };
    }
    if (!this.server) {
      return { recipient: topic, ok: false, error: 'the server URL is not valid' };
    }
    const headers = this.headers();
    headers['Content-Type'] = 'text/plain; charset=utf-8';
    const title = encodeHeaderText(req.subject ?? '');
    if (title.length > 0) {
      headers.Title = title;
    }
    headers.Priority = NTFY_PRIORITIES.includes(req.priority ?? 'default') ? (req.priority ?? 'default') : 'default';
    const tags = (req.tags ?? []).filter((tag) => NTFY_TAG_PATTERN.test(tag)).slice(0, NTFY_MAX_TAGS);
    if (tags.length > 0) {
      headers.Tags = tags.join(',');
    }

    const url = `${this.server}/${encodeURIComponent(topic)}`;
    const outcome = await request(url, { method: 'POST', headers, body: req.body }, { redact: this.secrets() });
    if (!outcome.ok) {
      return { recipient: topic, ok: false, error: outcome.error };
    }
    const { status, text } = outcome.response;
    const json = parseJson(text);
    if (status === 200) {
      const id = typeof json?.id === 'string' && json.id.length > 0 ? shortMessage(json.id, 64) : undefined;
      if (!id) {
        return { recipient: topic, ok: false, error: 'ntfy answered HTTP 200 without a message id; check that the server URL points at an ntfy server' };
      }
      this.log.debug(`ntfy ${this.id}: message accepted for topic ${this.log.address(topic, 'ntfy')} (${id})`);
      return { recipient: topic, ok: true, id };
    }
    return { recipient: topic, ok: false, error: this.describeFailure(status, json, topic) };
  }
}
