import { isGsm7Char, isGsm7Extension, SMS_MAX_LENGTH } from '../../src/gsm7.js';
import { el } from './dom.js';

/**
 * Live SMS body counter (SPEC section 11.2, item 2): character count, septet count against the
 * 160 limit, segment estimate, and a highlighted preview of any character outside GSM-7.
 */

export interface SmsStats {
  chars: number;
  septets: number;
  segments: number;
  bad: string[];
}

export function smsStats(body: string): SmsStats {
  let septets = 0;
  const bad: string[] = [];
  const chars = Array.from(body);
  for (const ch of chars) {
    if (!isGsm7Char(ch)) {
      if (!bad.includes(ch)) {
        bad.push(ch);
      }
      septets += 1;
    } else {
      septets += isGsm7Extension(ch) ? 2 : 1;
    }
  }
  const segments = septets === 0 ? 0 : septets <= SMS_MAX_LENGTH ? 1 : Math.ceil(septets / 153);
  return { chars: chars.length, septets, segments, bad };
}

function describe(ch: string): string {
  const code = ch.codePointAt(0) ?? 0;
  const hex = code.toString(16).toUpperCase().padStart(4, '0');
  return code < 0x20 || code === 0x7f ? `control character U+${hex}` : `"${ch}" (U+${hex})`;
}

/** Returns a counter element and a function that re-renders it for a body. */
export function smsCounter(): { el: HTMLElement; update(body: string): void } {
  const line = el('div', { class: 'form-text sms-counter' });
  const preview = el('div', { class: 'sms-preview', hidden: true });
  const wrapper = el('div', {}, line, preview);
  return {
    el: wrapper,
    update(body: string) {
      const stats = smsStats(body);
      const over = stats.septets > SMS_MAX_LENGTH;
      line.textContent = `${stats.chars} character${stats.chars === 1 ? '' : 's'}, ${stats.septets} of ${SMS_MAX_LENGTH} used, `
        + `${stats.segments} segment${stats.segments === 1 ? '' : 's'}`;
      line.className = `form-text sms-counter${over || stats.bad.length > 0 ? ' text-danger' : ''}`;
      if (stats.bad.length === 0) {
        preview.hidden = true;
        preview.textContent = '';
        return;
      }
      preview.hidden = false;
      preview.textContent = '';
      preview.appendChild(el('div', { class: 'small text-danger mb-1' },
        `Not allowed in SMS: ${stats.bad.map(describe).join(', ')}. Replace the highlighted characters.`));
      const text = el('div', { class: 'sms-preview-text' });
      for (const ch of Array.from(body)) {
        if (isGsm7Char(ch)) {
          text.appendChild(document.createTextNode(ch));
        } else {
          text.appendChild(el('mark', { class: 'sms-bad', title: describe(ch) }, ch === '\n' ? '⏎' : ch));
        }
      }
      preview.appendChild(text);
    },
  };
}
