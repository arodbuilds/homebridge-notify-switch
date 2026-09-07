import type { SmtpSecurity } from '../../src/types.js';
import type { HelpLink } from './copy.js';

/**
 * Mail provider presets for the SMTP card (SPEC section 11.2, item 22). Choosing one fills host, port
 * and security and points the password help at that provider's app-password page. The chosen key is
 * stored as `smtpPreset` for redisplay only; the runtime reads host, port and security.
 */
export interface SmtpPreset {
  /** Stored in config as `smtpPreset`. */
  key: string;
  /** Text label; there are no provider logos. */
  label: string;
  host: string;
  port: number;
  security: SmtpSecurity;
  /** The password help sentence for this provider. */
  passwordHelp: string;
  /** Direct link to the provider's app-password page. */
  passwordLink: HelpLink;
}

export const OTHER_PRESET_KEY = 'other';
export const OTHER_PRESET_LABEL = 'Other';

export const SMTP_PRESETS: readonly SmtpPreset[] = [
  {
    key: 'fastmail', label: 'Fastmail', host: 'smtp.fastmail.com', port: 465, security: 'ssl',
    passwordHelp: 'Use a Fastmail app password with SMTP access, not your login password.',
    passwordLink: { text: 'Create one at Fastmail', href: 'https://app.fastmail.com/settings/security/devices' },
  },
  {
    key: 'gmail', label: 'Gmail', host: 'smtp.gmail.com', port: 465, security: 'ssl',
    passwordHelp: 'Use a Google app password, not your login password. 2-Step Verification must be on first; Google only offers app passwords after that.',
    passwordLink: { text: 'Create one at Google', href: 'https://myaccount.google.com/apppasswords' },
  },
  {
    key: 'icloud', label: 'iCloud', host: 'smtp.mail.me.com', port: 587, security: 'starttls',
    passwordHelp: 'Use an iCloud app-specific password, not your Apple Account password.',
    passwordLink: { text: 'Create one at Apple', href: 'https://account.apple.com/account/manage' },
  },
  {
    key: 'outlook', label: 'Outlook.com', host: 'smtp-mail.outlook.com', port: 587, security: 'starttls',
    passwordHelp: 'Use a Microsoft app password, not your login password. Two-step verification must be on first.',
    passwordLink: { text: 'Create one at Microsoft', href: 'https://account.live.com/proofs/AppPassword' },
  },
  {
    key: 'yahoo', label: 'Yahoo', host: 'smtp.mail.yahoo.com', port: 465, security: 'ssl',
    passwordHelp: 'Use a Yahoo app password, not your login password.',
    passwordLink: { text: 'Create one at Yahoo', href: 'https://help.yahoo.com/kb/SLN15241.html' },
  },
  {
    key: 'zoho', label: 'Zoho', host: 'smtp.zoho.com', port: 465, security: 'ssl',
    passwordHelp: 'Use a Zoho app password, not your login password.',
    passwordLink: { text: 'Create one at Zoho', href: 'https://accounts.zoho.com/home#security/app_passwords' },
  },
];

/** The preset for a stored `smtpPreset` key; undefined for Other, an empty value or an unknown key. */
export function smtpPreset(key: string): SmtpPreset | undefined {
  return SMTP_PRESETS.find((preset) => preset.key === key);
}
