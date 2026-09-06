import { PROVIDER_MAX_RETRY_AFTER_MS, PROVIDER_RETRY_BACKOFF_MS, PROVIDER_TIMEOUT_MS } from '../settings.js';

/**
 * Small HTTP layer shared by the HTTP-based providers. Implements SPEC section 6 rules 2 and 3:
 * a 10 second timeout, at most one retry with a 2 second backoff (or the provider's retry-after
 * on a rate limit response, honored once), and a per-provider in-flight cap via `Semaphore`.
 * Nothing here throws; every failure resolves to an `HttpOutcome` with a sanitized error string.
 */

export interface HttpResponse {
  status: number;
  text: string;
  headers: Headers;
}

export type HttpOutcome =
  | { ok: true; response: HttpResponse }
  | { ok: false; error: string };

export interface RequestOptions {
  /** Strings that must never appear in an error message (credentials embedded in URLs, for example). */
  redact?: string[];
  /** Extracts a retry-after delay in seconds from a rate limit response body, if the API reports one there. */
  retryAfterFromBody?: (response: HttpResponse) => number | undefined;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function redact(message: string, secrets: string[] | undefined): string {
  let out = message;
  for (const secret of secrets ?? []) {
    if (secret.length > 0) {
      out = out.split(secret).join('[redacted]');
    }
  }
  return out;
}

/** Reduces an unknown thrown value to a short message with no request dumps. */
export function describeError(err: unknown): string {
  if (err instanceof Error) {
    if (err.name === 'TimeoutError' || err.name === 'AbortError') {
      return `request timed out after ${PROVIDER_TIMEOUT_MS / 1000}s`;
    }
    const cause = (err as { cause?: unknown }).cause;
    if (cause && typeof cause === 'object') {
      const code = (cause as { code?: unknown }).code;
      const causeMessage = (cause as { message?: unknown }).message;
      if (typeof code === 'string') {
        return `${err.message} (${code})`;
      }
      if (typeof causeMessage === 'string') {
        return `${err.message}: ${causeMessage}`;
      }
    }
    return err.message;
  }
  return String(err);
}

function parseRetryAfterHeader(headers: Headers): number | undefined {
  const value = headers.get('retry-after');
  if (!value) {
    return undefined;
  }
  const seconds = Number(value);
  if (Number.isFinite(seconds)) {
    return seconds;
  }
  const at = Date.parse(value);
  if (Number.isFinite(at)) {
    return Math.max(0, (at - Date.now()) / 1000);
  }
  return undefined;
}

function isRetryableStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

class RequestTimeoutError extends Error {
  constructor() {
    super('request timed out');
    this.name = 'TimeoutError';
  }
}

async function attempt(url: string, init: RequestInit, options: RequestOptions): Promise<HttpOutcome> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new RequestTimeoutError()), PROVIDER_TIMEOUT_MS);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    const text = await response.text();
    return { ok: true, response: { status: response.status, text, headers: response.headers } };
  } catch (err) {
    const reason = controller.signal.aborted ? controller.signal.reason : err;
    return { ok: false, error: redact(describeError(reason), options.redact) };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Performs the request with the plugin's timeout and retry policy.
 * A response is returned as-is even for non-2xx statuses; callers interpret the status.
 */
export async function request(url: string, init: RequestInit, options: RequestOptions = {}): Promise<HttpOutcome> {
  const first = await attempt(url, init, options);

  let delayMs = PROVIDER_RETRY_BACKOFF_MS;
  if (first.ok) {
    if (!isRetryableStatus(first.response.status)) {
      return first;
    }
    if (first.response.status === 429) {
      const seconds = parseRetryAfterHeader(first.response.headers) ?? options.retryAfterFromBody?.(first.response);
      if (seconds !== undefined && Number.isFinite(seconds) && seconds >= 0) {
        delayMs = Math.min(seconds * 1000, PROVIDER_MAX_RETRY_AFTER_MS);
      }
    }
  }

  await sleep(delayMs);
  return attempt(url, init, options);
}

/** Limits the number of concurrently running tasks. */
export class Semaphore {
  private active = 0;
  private readonly waiting: Array<() => void> = [];

  constructor(private readonly limit: number) {}

  async run<T>(task: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await task();
    } finally {
      this.release();
    }
  }

  private acquire(): Promise<void> {
    if (this.active < this.limit) {
      this.active += 1;
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      this.waiting.push(() => {
        this.active += 1;
        resolve();
      });
    });
  }

  private release(): void {
    this.active -= 1;
    const next = this.waiting.shift();
    if (next) {
      next();
    }
  }
}

/** Parses a JSON body, returning undefined instead of throwing. */
export function parseJson(text: string): Record<string, unknown> | undefined {
  try {
    const parsed: unknown = JSON.parse(text);
    if (parsed && typeof parsed === 'object') {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // not JSON
  }
  return undefined;
}

/** Trims a free-text provider message to a log-friendly length. */
export function shortMessage(value: unknown, max = 200): string {
  const text = typeof value === 'string' ? value : value === undefined ? '' : String(value);
  const oneLine = text.replace(/\s+/g, ' ').trim();
  return oneLine.length > max ? `${oneLine.slice(0, max - 1)}…` : oneLine;
}
