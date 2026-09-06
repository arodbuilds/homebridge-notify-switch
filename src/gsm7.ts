/**
 * GSM 03.38 7-bit default alphabet, basic set plus the extension table.
 * Used to validate sms bodies at startup (SPEC section 5.5, item 8).
 */
const GSM7_BASIC = '@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !"#¤%&\'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà';
const GSM7_EXTENSION = '\f^{}\\[~]|€';

const GSM7_SET: ReadonlySet<string> = new Set([...GSM7_BASIC, ...GSM7_EXTENSION]);

/** Characters allowed in an sms body, as a JSON-schema friendly character class. */
export const SMS_MAX_LENGTH = 160;

/** Returns the first character in `text` outside the GSM-7 alphabet, or undefined if all are allowed. */
export function firstNonGsm7Character(text: string): string | undefined {
  for (const ch of text) {
    if (!GSM7_SET.has(ch)) {
      return ch;
    }
  }
  return undefined;
}

export function isGsm7(text: string): boolean {
  return firstNonGsm7Character(text) === undefined;
}

/** Human readable label for a character that failed the GSM-7 check. */
export function describeCharacter(ch: string): string {
  const code = ch.codePointAt(0) ?? 0;
  const hex = code.toString(16).toUpperCase().padStart(4, '0');
  if (code < 0x20 || code === 0x7f) {
    return `control character U+${hex}`;
  }
  return `"${ch}" (U+${hex})`;
}
