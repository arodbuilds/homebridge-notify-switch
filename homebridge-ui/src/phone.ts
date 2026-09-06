import { AsYouType, getCountries, getCountryCallingCode, getExampleNumber, parsePhoneNumberFromString } from 'libphonenumber-js/min';
import type { CountryCode } from 'libphonenumber-js/min';
import examples from 'libphonenumber-js/examples.mobile.json';

import { el, uniqueId } from './dom.js';

/**
 * Phone number entry (SPEC section 11.2, item 1): a country dropdown with flag, name and dial code,
 * a national number field with a local placeholder, live validation and formatting, storage as
 * E.164, and paste normalization that also sets the country.
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

export function countryOptions(): Array<{ value: string; label: string }> {
  return countries().map((c) => ({ value: c.code, label: `${c.flag} ${c.name} (+${c.dial})` }));
}

/** Parses free text to E.164, using `country` when there is no leading plus. Undefined when not valid. */
export function toE164(text: string, country: CountryCode): string | undefined {
  const raw = text.trim().replace(/^00/, '+');
  const parsed = raw.startsWith('+') ? parsePhoneNumberFromString(raw) : parsePhoneNumberFromString(raw, country);
  return parsed && parsed.isValid() ? parsed.number : undefined;
}

export function isE164(text: string): boolean {
  return /^\+[1-9]\d{6,14}$/.test(text);
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
}

/** A phone number row: country select plus national number input. Returns the row element. */
export function phoneInput(opts: PhoneInputOptions): HTMLElement {
  let country: CountryCode = isCountry(opts.defaultCountry) ? (opts.defaultCountry.toUpperCase() as CountryCode) : 'US';
  const initial = opts.value.trim() ? parsePhoneNumberFromString(opts.value.trim()) : undefined;
  if (initial?.country) {
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
  input.value = initial?.country ? initial.formatNational() : opts.value;

  const feedback = el('div', { class: 'form-text phone-feedback' });

  const report = (): void => {
    const text = input.value.trim();
    if (!text) {
      feedback.textContent = '';
      feedback.className = 'form-text phone-feedback';
      input.classList.remove('is-invalid');
      opts.onChange('');
      return;
    }
    const e164 = toE164(text, country);
    if (e164) {
      feedback.textContent = `Stored as ${e164}`;
      feedback.className = 'form-text phone-feedback text-success';
      input.classList.remove('is-invalid');
      opts.onChange(e164);
    } else {
      const name = countries().find((c) => c.code === country)?.name ?? country;
      feedback.textContent = `Not a valid number for ${name}. Include the area code, or paste the full number with its country code.`;
      feedback.className = 'form-text phone-feedback text-danger';
      input.classList.add('is-invalid');
      opts.onChange(text);
    }
  };

  select.addEventListener('change', () => {
    if (isCountry(select.value)) {
      country = select.value as CountryCode;
      input.placeholder = placeholderFor(country);
      // Re-read the digits the user typed against the new country.
      const digits = input.value.replace(/[^\d+]/g, '');
      if (!digits.startsWith('+')) {
        input.value = new AsYouType(country).input(digits);
      }
      report();
    }
  });

  input.addEventListener('input', () => {
    const raw = input.value;
    const normalized = raw.trim().replace(/^00/, '+');
    if (normalized.startsWith('+')) {
      // Pasted or typed with a country code: take the country from the number and show it nationally.
      const parsed = parsePhoneNumberFromString(normalized);
      if (parsed?.country) {
        country = parsed.country;
        select.value = country;
        input.placeholder = placeholderFor(country);
        input.value = parsed.formatNational();
      } else {
        input.value = new AsYouType().input(normalized);
      }
    } else if (input.selectionEnd === raw.length) {
      // Only reformat while the caret is at the end, so editing in the middle does not jump.
      input.value = new AsYouType(country).input(raw);
    }
    report();
  });

  if (input.value.trim() && !initial?.country) {
    // Stored value did not parse: show why without emitting a change.
    const name = countries().find((c) => c.code === country)?.name ?? country;
    feedback.textContent = `Not a valid number for ${name}.`;
    feedback.className = 'form-text phone-feedback text-danger';
    input.classList.add('is-invalid');
  } else if (initial?.country) {
    feedback.textContent = `Stored as ${initial.number}`;
    feedback.className = 'form-text phone-feedback text-success';
  }

  return el('div', { class: 'phone-row' },
    el('div', { class: 'phone-controls' }, select, input),
    feedback,
  );
}
