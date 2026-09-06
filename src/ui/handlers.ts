import type { Logging } from 'homebridge';

import { PluginLogger } from '../logging.js';
import { renderAction, sendAction } from '../send.js';
import { buildTemplateVariables } from '../template.js';
import type { ChatSummary, Channel, ConnectionTestResult, ProviderDiagnostics, RecipientResult, ValidationIssue } from '../types.js';
import { validateConfig, validateProvider } from '../validation.js';

/**
 * Request handlers behind the settings UI's server side (SPEC section 11.2, items 3 to 5, and
 * section 12, item 5). Submitted credentials live only in the provider instance created for the
 * request; nothing here logs, persists, or echoes them, and every failure resolves to a plain
 * result object so the UI never sees a stack trace. Only the hosts the user configured (or the
 * fixed Twilio and Telegram API hosts) are contacted.
 */

export interface HandlerOptions {
  /** Homebridge storage directory, used to resolve relative `credentialsFile` paths. */
  storagePath?: string;
}

export interface FindChatsResult {
  ok: boolean;
  message: string;
  chats: ChatSummary[];
}

export interface TestSendActionResult {
  index: number;
  providerId: string;
  channel: Channel;
  results: RecipientResult[];
}

export interface TestSendResult {
  ok: boolean;
  message: string;
  /** Validation errors that prevented the send, with their field paths. */
  errors?: string[];
  actions?: TestSendActionResult[];
}

/** A logger that discards everything. The UI server process must not write credentials or bodies anywhere. */
export function silentLogger(): PluginLogger {
  const noop = (): void => undefined;
  const logging = { info: noop, warn: noop, error: noop, debug: noop, success: noop, log: noop } as unknown as Logging;
  return new PluginLogger(logging, false);
}

function formatIssue(issue: ValidationIssue): string {
  return issue.path ? `${issue.path}: ${issue.message}` : issue.message;
}

function hasDiagnostics(value: unknown): value is ProviderDiagnostics {
  return typeof value === 'object' && value !== null && typeof (value as { testConnection?: unknown }).testConnection === 'function';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function describeError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Test connection for one provider block as submitted by the form. */
export async function testProvider(rawProvider: unknown, options: HandlerOptions = {}): Promise<ConnectionTestResult> {
  try {
    const validated = await validateProvider(rawProvider, silentLogger(), { storagePath: options.storagePath });
    const errors = validated.issues.filter((issue) => issue.level === 'error');
    if (!validated.provider || errors.length > 0) {
      return { ok: false, message: `Fix these fields first: ${errors.map(formatIssue).join('; ') || 'provider is not valid'}` };
    }
    if (!hasDiagnostics(validated.provider)) {
      return { ok: false, message: `The ${validated.provider.type} provider does not support connection tests.` };
    }
    return await validated.provider.testConnection();
  } catch (err) {
    return { ok: false, message: `Test failed: ${describeError(err)}` };
  }
}

/** Find chat IDs for a Telegram provider block as submitted by the form. */
export async function findChats(rawProvider: unknown, options: HandlerOptions = {}): Promise<FindChatsResult> {
  try {
    const validated = await validateProvider(rawProvider, silentLogger(), { storagePath: options.storagePath });
    const errors = validated.issues.filter((issue) => issue.level === 'error');
    if (!validated.provider || errors.length > 0) {
      return { ok: false, message: `Fix these fields first: ${errors.map(formatIssue).join('; ') || 'provider is not valid'}`, chats: [] };
    }
    if (!hasDiagnostics(validated.provider) || !validated.provider.findChats) {
      return { ok: false, message: 'Find chat IDs works with Telegram providers only.', chats: [] };
    }
    return await validated.provider.findChats();
  } catch (err) {
    return { ok: false, message: `Lookup failed: ${describeError(err)}`, chats: [] };
  }
}

/**
 * Test send for one switch: validates the whole platform block exactly as startup does, then sends
 * the switch's actions to their resolved recipients and reports one result per recipient.
 * The master switch, enabled flag and cooldown do not apply; the user clicked Confirm.
 */
export async function testSend(rawConfig: unknown, switchId: unknown, options: HandlerOptions = {}): Promise<TestSendResult> {
  try {
    if (typeof switchId !== 'string' || switchId.length === 0) {
      return { ok: false, message: 'No switch selected.' };
    }
    const result = await validateConfig(rawConfig, silentLogger(), { storagePath: options.storagePath });
    const errors = result.issues.filter((issue) => issue.level === 'error').map(formatIssue);
    if (!result.switches || !result.providers) {
      return { ok: false, message: 'The configuration has errors. Fix them before testing.', errors };
    }
    const sw = result.switches.find((entry) => entry.id === switchId.toLowerCase());
    if (!sw) {
      return { ok: false, message: 'That switch is not in the current configuration.', errors };
    }
    const vars = buildTemplateVariables(sw.name);
    const actions: TestSendActionResult[] = [];
    for (const action of sw.actions) {
      const results = await sendAction(action, result.providers.get(action.providerId), renderAction(action, vars));
      actions.push({ index: action.index, providerId: action.providerId, channel: action.channel, results });
    }
    const total = actions.reduce((sum, action) => sum + action.results.length, 0);
    const failed = actions.reduce((sum, action) => sum + action.results.filter((r) => !r.ok).length, 0);
    const message = failed === 0
      ? `Sent ${total} message${total === 1 ? '' : 's'}.`
      : `${total - failed} of ${total} message${total === 1 ? '' : 's'} sent, ${failed} failed.`;
    return { ok: failed === 0, message, actions };
  } catch (err) {
    return { ok: false, message: `Test send failed: ${describeError(err)}` };
  }
}

/** Reads the `provider` field of a request payload without trusting its shape. */
export function payloadProvider(payload: unknown): unknown {
  return isRecord(payload) ? payload.provider : undefined;
}

/** Reads the `config` and `switchId` fields of a test send payload. */
export function payloadTestSend(payload: unknown): { config: unknown; switchId: unknown } {
  return isRecord(payload) ? { config: payload.config, switchId: payload.switchId } : { config: undefined, switchId: undefined };
}
