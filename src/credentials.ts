import { readFileSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';

import type { ProviderType } from './types.js';

/**
 * Optional `credentialsFile` on a provider (SPEC section 12, item 2): a JSON file, relative to the
 * Homebridge storage directory, whose keys override the provider's secret fields. Read once at
 * startup. A missing or malformed file is a blocking validation error. Nothing here ever logs or
 * returns file content beyond the values themselves, which the caller merges into the provider.
 */

/** Secret fields each provider type accepts from a credentials file. */
export const CREDENTIAL_KEYS: Readonly<Record<ProviderType, readonly string[]>> = {
  twilio: ['accountSid', 'apiKeySid', 'apiKeySecret'],
  smtp: ['username', 'password'],
  telegram: ['botToken'],
};

export interface CredentialsFileResult {
  /** Secret fields read from the file. Present only when the file was read and parsed. */
  values?: Record<string, string>;
  /** Blocking problem with the file itself. */
  error?: string;
  /** Non-blocking problems, for example keys the provider type does not use. */
  warnings: string[];
}

/** Resolves `credentialsFile` against the storage directory. Absolute paths are used as given. */
export function resolveCredentialsPath(credentialsFile: string, storagePath: string | undefined): string | undefined {
  if (isAbsolute(credentialsFile)) {
    return credentialsFile;
  }
  if (!storagePath) {
    return undefined;
  }
  return resolve(storagePath, credentialsFile);
}

function describeReadError(err: unknown): string {
  const code = typeof err === 'object' && err !== null ? (err as { code?: unknown }).code : undefined;
  switch (code) {
  case 'ENOENT':
    return 'file not found';
  case 'EACCES':
  case 'EPERM':
    return 'permission denied';
  case 'EISDIR':
    return 'is a directory, not a file';
  default:
    return err instanceof Error ? err.message : String(err);
  }
}

/**
 * Reads and parses a credentials file for a provider type. Never throws.
 */
export function loadCredentialsFile(credentialsFile: string, type: ProviderType, storagePath: string | undefined): CredentialsFileResult {
  const warnings: string[] = [];
  const path = resolveCredentialsPath(credentialsFile, storagePath);
  if (!path) {
    return { warnings, error: `"${credentialsFile}" is relative but the Homebridge storage directory is unknown; use an absolute path` };
  }

  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch (err) {
    return { warnings, error: `could not read "${path}": ${describeReadError(err)}` };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { warnings, error: `"${path}" is not valid JSON` };
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { warnings, error: `"${path}" must contain a JSON object such as {"apiKeySecret": "..."}` };
  }

  const allowed = CREDENTIAL_KEYS[type];
  const values: Record<string, string> = {};
  for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (!allowed.includes(key)) {
      warnings.push(`key "${key}" in "${path}" is not a secret field of ${type} providers and was ignored (accepted: ${allowed.join(', ')})`);
      continue;
    }
    if (typeof value !== 'string') {
      return { warnings, error: `key "${key}" in "${path}" must be a string` };
    }
    if (value.trim().length === 0) {
      return { warnings, error: `key "${key}" in "${path}" is empty` };
    }
    values[key] = value;
  }
  if (Object.keys(values).length === 0) {
    return { warnings, error: `"${path}" does not set any of ${allowed.join(', ')}` };
  }
  // Report keys in the provider's documented order regardless of the order in the file.
  const ordered: Record<string, string> = {};
  for (const key of allowed) {
    if (key in values) {
      ordered[key] = values[key];
    }
  }
  return { warnings, values: ordered };
}
