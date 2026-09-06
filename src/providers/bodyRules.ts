import { describeCharacter, firstNonGsm7Character, SMS_MAX_LENGTH } from '../gsm7.js';
import type { Channel, ValidationIssue } from '../types.js';

export const EMAIL_MAX_LENGTH = 10000;
export const TELEGRAM_MAX_LENGTH = 4096;

/** Number of user-perceived characters (code points) in a string. */
export function charCount(text: string): number {
  return Array.from(text).length;
}

/**
 * Body constraints by channel (SPEC section 5.5, item 8). Shared by every provider so the rules
 * are identical regardless of which provider serves the channel.
 */
export function validateBodyForChannel(channel: Channel, body: string): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const length = charCount(body);
  if (length === 0) {
    issues.push({ path: 'body', level: 'error', message: 'body must not be empty' });
    return issues;
  }
  switch (channel) {
  case 'sms': {
    if (length > SMS_MAX_LENGTH) {
      issues.push({ path: 'body', level: 'error', message: `sms body is ${length} characters; the limit is ${SMS_MAX_LENGTH}` });
    }
    const bad = firstNonGsm7Character(body);
    if (bad !== undefined) {
      issues.push({
        path: 'body',
        level: 'error',
        message: `sms body contains ${describeCharacter(bad)}, which is outside the GSM-7 character set`,
      });
    }
    break;
  }
  case 'email': {
    if (length > EMAIL_MAX_LENGTH) {
      issues.push({ path: 'body', level: 'error', message: `email body is ${length} characters; the limit is ${EMAIL_MAX_LENGTH}` });
    }
    break;
  }
  case 'telegram': {
    if (length > TELEGRAM_MAX_LENGTH) {
      issues.push({ path: 'body', level: 'error', message: `telegram body is ${length} characters; the limit is ${TELEGRAM_MAX_LENGTH}` });
    }
    break;
  }
  }
  return issues;
}
