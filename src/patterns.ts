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

export const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const TELEGRAM_CHAT_ID_PATTERN = /^-?\d+$/;
export const COUNTRY_PATTERN = /^[A-Za-z]{2}$/;

export const ACCOUNT_SID_PATTERN = /^AC[0-9a-fA-F]{32}$/;
export const API_KEY_SID_PATTERN = /^SK[0-9a-fA-F]{32}$/;
export const MESSAGING_SERVICE_SID_PATTERN = /^MG[0-9a-fA-F]{32}$/;
export const BOT_TOKEN_PATTERN = /^\d+:[A-Za-z0-9_-]{30,}$/;
