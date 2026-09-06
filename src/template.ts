/**
 * Template variables available in `body` and `subject` (SPEC section 5.6).
 * Unknown variables are left exactly as typed. Times use the Homebridge host's local zone.
 */
export interface TemplateVariables {
  switchName: string;
  time: string;
  date: string;
  datetime: string;
}

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

export function buildTemplateVariables(switchName: string, now: Date = new Date()): TemplateVariables {
  const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const time = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
  const datetime = `${date}T${time}:${pad(now.getSeconds())}`;
  return { switchName, time, date, datetime };
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
