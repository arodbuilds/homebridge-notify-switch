import { getCountries, getCountryCallingCode, getExampleNumber, parsePhoneNumberFromString } from 'libphonenumber-js/min';
import type { CountryCode } from 'libphonenumber-js/min';
import examples from 'libphonenumber-js/examples.mobile.json';

import { el, uniqueId } from './dom.js';

/**
 * Phone number entry (SPEC section 11.2, item 1): a country dropdown with flag, name and dial code,
 * and a national number field. Nothing is reformatted while the field has focus; on blur the text
 * is parsed with the selected country as the hint, stored as E.164, the country is re-derived from
 * the parsed number, and the field shows the national format.
 */

export interface Country {
  code: CountryCode;
  name: string;
  dial: string;
  flag: string;
}

function flagOf(code: string): string {
  return String.fromCodePoint(...Array.from(code.toUpperCase(), (ch) => 0x1f1e6 + ch.charCodeAt(0) - 65));
}

let cached: Country[] | undefined;

/** Every country libphonenumber-js knows, sorted by display name in the browser's language. */
export function countries(): Country[] {
  if (cached) {
    return cached;
  }
  let names: Intl.DisplayNames | undefined;
  try {
    names = new Intl.DisplayNames([navigator.language || 'en', 'en'], { type: 'region' });
  } catch {
    names = undefined;
  }
  const nameOf = (code: string): string => {
    try {
      return names?.of(code) ?? code;
    } catch {
      return code;
    }
  };
  cached = getCountries()
    .map((code) => ({ code, name: nameOf(code), dial: getCountryCallingCode(code), flag: flagOf(code) }))
    .sort((a, b) => a.name.localeCompare(b.name));
  return cached;
}

export function isCountry(code: string): code is CountryCode {
  return (getCountries() as string[]).includes(code.toUpperCase());
}

/**
 * The region of a BCP 47 language tag such as `en-GB`, `pt-BR` or `zh-Hant-TW`, when it is a country the
 * phone entry knows; undefined for a tag without a region (`de`) or an unknown one. Used to prefill the
 * default country on first load (SPEC section 11.2, item 21).
 */
export function localeCountry(language: string | undefined | null): CountryCode | undefined {
  if (typeof language !== 'string') {
    return undefined;
  }
  const match = /^[a-z]{2,3}(?:-[a-z]{4})?-([a-z]{2})(?:-|$)/i.exec(language.trim());
  const region = match?.[1]?.toUpperCase();
  return region && isCountry(region) ? (region as CountryCode) : undefined;
}

export function countryOptions(): Array<{ value: string; label: string }> {
  return countries().map((c) => ({ value: c.code, label: `${c.flag} ${c.name} (+${c.dial})` }));
}

export interface ParsedPhone {
  e164: string;
  country: CountryCode;
  national: string;
}

/**
 * Parses free text with `country` as the hint (a leading plus or `00` wins over the hint). The country
 * comes back from the parsed number, so a +1 305 number is United States even when Canada was selected.
 * Undefined when the text is not a valid number.
 */
export function parsePhone(text: string, country: CountryCode): ParsedPhone | undefined {
  const raw = text.trim().replace(/^00/, '+');
  if (!raw) {
    return undefined;
  }
  const parsed = parsePhoneNumberFromString(raw, country);
  if (!parsed || !parsed.isValid()) {
    return undefined;
  }
  return { e164: parsed.number, country: parsed.country ?? country, national: parsed.formatNational() };
}

/** Parses free text to E.164, using `country` when there is no leading plus. Undefined when not valid. */
export function toE164(text: string, country: CountryCode): string | undefined {
  return parsePhone(text, country)?.e164;
}

export function isE164(text: string): boolean {
  return /^\+[1-9]\d{6,14}$/.test(text);
}

/** Digits, spaces, dashes, dots, parentheses and one leading plus are the characters the field accepts. */
export function sanitizePhoneText(text: string): string {
  const kept = text.replace(/[^\d\s().+-]/g, '');
  return kept.replace(/(?!^)\+/g, '');
}

function placeholderFor(country: CountryCode): string {
  try {
    return getExampleNumber(country, examples)?.formatNational() ?? '';
  } catch {
    return '';
  }
}

export interface PhoneInputOptions {
  /** Current stored value: E.164, or whatever the user typed if it did not validate. */
  value: string;
  defaultCountry: string;
  /** Called with the E.164 value, or the raw text when it is not a valid number, or '' when cleared. */
  onChange(value: string): void;
  label?: string;
  /** A control (the row's Remove button) placed beside the number field so it stays on the number's line on phones. */
  trailing?: HTMLElement;
}

/** A phone number row: country select plus national number input. Returns the row element. */
export function phoneInput(opts: PhoneInputOptions): HTMLElement {
  let country: CountryCode = isCountry(opts.defaultCountry) ? (opts.defaultCountry.toUpperCase() as CountryCode) : 'US';
  const initial = parsePhone(opts.value, country);
  if (initial) {
    country = initial.country;
  }

  const select = el('select', { class: 'form-select phone-country', 'aria-label': 'Country' });
  for (const c of countries()) {
    const option = el('option', { value: c.code }, `${c.flag} ${c.name} (+${c.dial})`);
    if (c.code === country) {
      option.selected = true;
    }
    select.appendChild(option);
  }

  const id = uniqueId('phone');
  const input = el('input', {
    id,
    class: 'form-control phone-national',
    type: 'tel',
    autocomplete: 'off',
    inputmode: 'tel',
    'aria-label': opts.label ?? 'Phone number',
    placeholder: placeholderFor(country),
  });
  input.value = initial ? initial.national : opts.value;

  const feedback = el('div', { class: 'form-text phone-feedback' });

  const countryName = (): string => countries().find((c) => c.code === country)?.name ?? country;

  const showStored = (e164: string): void => {
    feedback.textContent = `Stored as ${e164}`;
    feedback.className = 'form-text phone-feedback text-success';
    input.classList.remove('is-invalid');
  };
  const showError = (): void => {
    feedback.textContent = `Not a valid number for ${countryName()}. Include the area code, or enter the full number with its country code.`;
    feedback.className = 'form-text phone-feedback text-danger';
    input.classList.add('is-invalid');
  };
  const showNothing = (): void => {
    feedback.textContent = '';
    feedback.className = 'form-text phone-feedback';
    input.classList.remove('is-invalid');
  };

  /** Blur (and country change): parse, store E.164, re-derive the country, show the national format. */
  const commit = (): void => {
    const text = input.value.trim();
    if (!text) {
      showNothing();
      opts.onChange('');
      return;
    }
    const parsed = parsePhone(text, country);
    if (!parsed) {
      // Keep the raw text so the user can see and fix what they typed.
      showError();
      opts.onChange(text);
      return;
    }
    if (parsed.country !== country && isCountry(parsed.country)) {
      country = parsed.country;
      select.value = country;
      input.placeholder = placeholderFor(country);
    }
    input.value = parsed.national;
    showStored(parsed.e164);
    opts.onChange(parsed.e164);
  };

  select.addEventListener('change', () => {
    if (isCountry(select.value)) {
      country = select.value as CountryCode;
      input.placeholder = placeholderFor(country);
      if (input.value.trim()) {
        commit();
      }
    }
  });

  input.addEventListener('input', () => {
    // No formatting while typing. Only characters outside the accepted set are dropped, with the caret kept in place.
    const raw = input.value;
    const clean = sanitizePhoneText(raw);
    if (clean !== raw) {
      const caret = input.selectionStart ?? raw.length;
      const removedBefore = raw.slice(0, caret).length - sanitizePhoneText(raw.slice(0, caret)).length;
      input.value = clean;
      const next = Math.max(0, caret - removedBefore);
      input.setSelectionRange(next, next);
    }
    // The model always holds what is in the field, so validation and Save track it; the parse waits for blur.
    opts.onChange(input.value.trim());
  });
  input.addEventListener('blur', commit);
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      commit();
    }
  });

  if (initial) {
    showStored(initial.e164);
  } else if (input.value.trim()) {
    // Stored value did not parse: show why without emitting a change.
    showError();
  }

  // Below 600px the stylesheet puts the country on its own line and keeps the number and the trailing
  // control (Remove) together on the next one (SPEC section 11.2, item 16).
  return el('div', { class: 'phone-row' },
    el('div', { class: 'phone-controls' }, select, el('div', { class: 'phone-number-line' }, input, opts.trailing ?? null)),
    feedback,
  );
}
