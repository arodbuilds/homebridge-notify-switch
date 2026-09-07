/**
 * Field patterns shared by startup validation and the providers. These mirror config.schema.json;
 * validation runs in code independently of the schema (SPEC section 10).
 */
export { E164_PATTERN } from './countries.js';

/** Provider and group ids: lowercase letters, digits, dashes and underscores; starts with a letter or digit. */
export const SLUG_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/;

/** Any RFC 4122 style UUID; the UI generates v4 but a typed id is accepted (SPEC section 4, item 3). */
export const UUID_PATTERN = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

/** HAP accessory naming (SPEC section 5.4, item 2). */
export const HAP_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9 ']*[A-Za-z0-9]$/;
export const HAP_NAME_MAX_LENGTH = 64;

/**
 * Provider and group display names (SPEC section 5.2 and 5.3): printable characters only, no control
 * characters, no line or paragraph separators, no angle brackets, 1 to 64 characters. Mirrored in
 * config.schema.json without the `u` flag, so the class is spelled out rather than using `\p{..}`.
 */
// eslint-disable-next-line no-control-regex
export const DISPLAY_NAME_PATTERN = /^[^\u0000-\u001f\u007f-\u009f\u2028\u2029<>]{1,64}$/;
export const DISPLAY_NAME_MAX_LENGTH = 64;

/** Email addresses: no whitespace, one @, a dot in the domain, and no control or format characters (which could shape a log line). */
export const EMAIL_PATTERN = /^[^\s@\p{Cc}\p{Cf}]+@[^\s@\p{Cc}\p{Cf}]+\.[^\s@\p{Cc}\p{Cf}]+$/u;
export const TELEGRAM_CHAT_ID_PATTERN = /^-?\d+$/;
export const COUNTRY_PATTERN = /^[A-Za-z]{2}$/;

export const ACCOUNT_SID_PATTERN = /^AC[0-9a-fA-F]{32}$/;
export const API_KEY_SID_PATTERN = /^SK[0-9a-fA-F]{32}$/;
export const MESSAGING_SERVICE_SID_PATTERN = /^MG[0-9a-fA-F]{32}$/;
export const BOT_TOKEN_PATTERN = /^\d+:[A-Za-z0-9_-]{30,}$/;

/** ntfy topic names (SPEC section 5.3, item 6). */
export const NTFY_TOPIC_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
/** ntfy tags (SPEC section 5.5, item 11): emoji short codes and plain words. */
export const NTFY_TAG_PATTERN = /^[A-Za-z0-9_+-]{1,32}$/;
export const NTFY_MAX_TAGS = 8;
/** An ntfy access token or Basic auth credential as it goes into the Authorization header: no whitespace or control characters. */
export const NTFY_CREDENTIAL_PATTERN = /^[^\s\p{Cc}]{1,256}$/u;
