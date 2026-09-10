import type { DateFormat, TimeFormat } from './types.js';
import { DEFAULT_DATE_FORMAT, DEFAULT_TIME_FORMAT } from './types.js';

/**
 * Template variables available in `body` and `subject` (SPEC section 5.6).
 * Unknown variables are left exactly as typed. Times use the Homebridge host's local zone and the
 * platform's `timeFormat` and `dateFormat` settings (SPEC section 5.1).
 */
export interface TemplateVariables {
  switchName: string;
  time: string;
  date: string;
  datetime: string;
}

/** The two platform settings that shape `{{time}}`, `{{date}}` and `{{datetime}}`. */
export interface TemplateFormats {
  timeFormat: TimeFormat;
  dateFormat: DateFormat;
}

export const DEFAULT_TEMPLATE_FORMATS: TemplateFormats = { timeFormat: DEFAULT_TIME_FORMAT, dateFormat: DEFAULT_DATE_FORMAT };

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/** `{{time}}`: "5:15 PM" (no leading zero, uppercase AM/PM, midnight "12:00 AM", noon "12:00 PM") or "17:15". No seconds. */
export function formatTime(now: Date, timeFormat: TimeFormat): string {
  const hours = now.getHours();
  const minutes = pad(now.getMinutes());
  if (timeFormat === '24h') {
    return `${pad(hours)}:${minutes}`;
  }
  const hour12 = hours % 12 === 0 ? 12 : hours % 12;
  return `${hour12}:${minutes} ${hours < 12 ? 'AM' : 'PM'}`;
}

/** `{{date}}`: "9/8/2026" (mdy), "8/9/2026" (dmy) or "2026-09-08" (ymd, the only zero-padded form). */
export function formatDate(now: Date, dateFormat: DateFormat): string {
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  const day = now.getDate();
  switch (dateFormat) {
  case 'dmy':
    return `${day}/${month}/${year}`;
  case 'ymd':
    return `${year}-${pad(month)}-${pad(day)}`;
  default:
    return `${month}/${day}/${year}`;
  }
}

/** `{{datetime}}`: the date, one space, the time, in the chosen formats, for example "9/8/2026 5:15 PM". */
export function formatDateTime(now: Date, formats: TemplateFormats): string {
  return `${formatDate(now, formats.dateFormat)} ${formatTime(now, formats.timeFormat)}`;
}

export function buildTemplateVariables(switchName: string, formats: TemplateFormats = DEFAULT_TEMPLATE_FORMATS, now: Date = new Date()): TemplateVariables {
  return { switchName, time: formatTime(now, formats.timeFormat), date: formatDate(now, formats.dateFormat), datetime: formatDateTime(now, formats) };
}

const VARIABLE_PATTERN = /\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g;

export function renderTemplate(text: string, vars: TemplateVariables): string {
  return text.replace(VARIABLE_PATTERN, (match: string, name: string): string => {
    if (Object.prototype.hasOwnProperty.call(vars, name)) {
      return vars[name as keyof TemplateVariables];
    }
    return match;
  });
}

/** Removes CR and LF from header-like values such as email subjects and from names (SPEC section 12, item 7). */
export function stripLineBreaks(text: string): string {
  return text.replace(/[\r\n]+/g, ' ').trim();
}
