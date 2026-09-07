/**
 * Text helpers shared by the runtime and the settings UI bundle. No Node or DOM dependencies.
 */

/** C0 and C1 control characters, DEL, and the Unicode line and paragraph separators. Matching them is the point. */
// eslint-disable-next-line no-control-regex
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g;

const NAMED_ESCAPES: Record<string, string> = { '\n': '\\n', '\r': '\\r', '\t': '\\t' };

/**
 * Makes a string safe for a single log line: every control character is replaced by its escaped form
 * (`\n`, `\r`, `\t`, or `\u001b` style), so nothing sourced from configuration or a provider response
 * can start a new line or emit a terminal escape sequence (SPEC section 12, item 12).
 */
export function escapeControlCharacters(text: string): string {
  return text.replace(CONTROL_CHARACTERS, (ch) => NAMED_ESCAPES[ch] ?? `\\u${(ch.codePointAt(0) ?? 0).toString(16).padStart(4, '0')}`);
}

/** True when `text` holds a control character, DEL, or a Unicode line or paragraph separator. */
export function hasControlCharacters(text: string): boolean {
  CONTROL_CHARACTERS.lastIndex = 0;
  const found = CONTROL_CHARACTERS.test(text);
  CONTROL_CHARACTERS.lastIndex = 0;
  return found;
}

/** Removes every control character (line breaks included) from a value that goes into a header or a title. */
export function stripControlCharacters(text: string): string {
  return text.replace(CONTROL_CHARACTERS, '');
}

/**
 * A configuration value quoted for a validation message: control characters escaped and the value cut
 * to `max` characters, so a bad value is readable in the log without being able to shape the line.
 */
export function quoteValue(value: string, max = 80): string {
  const chars = Array.from(value);
  const shown = chars.length > max ? `${chars.slice(0, max - 1).join('')}…` : value;
  return `"${escapeControlCharacters(shown)}"`;
}
