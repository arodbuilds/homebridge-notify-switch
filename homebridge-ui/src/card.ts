import { HELP_TOGGLE, ID_FIELD, TELEGRAM_ONBOARDING, VARIABLES } from './copy.js';
import { copyButton, el, helpLink, helpText, linkButton, linkOut, uniqueId } from './dom.js';
import { qrElement } from './qr.js';

/**
 * Pieces shared by the provider, group and switch cards: the "Show help" toggle, the ID field under
 * Advanced, the Variables toggle next to message fields, and the QR block with its phone-friendly
 * alternative (SPEC section 11.2, items 14, 16 and 17).
 */

/** Remembered for the session only, per provider, group or switch object; nothing is written anywhere. */
const helpChoice = new WeakMap<object, boolean>();

/** Help text is expanded on wide screens and collapsed below 600px unless the user chose otherwise this session. */
export function helpExpanded(item: object): boolean {
  const remembered = helpChoice.get(item);
  if (remembered !== undefined) {
    return remembered;
  }
  return window.innerWidth >= 600;
}

/**
 * The per-card "Show help" / "Hide help" text button. It toggles `ns-help-hidden` on the card, which hides
 * every `.ns-help` line inside it (field help only; status lines, counters and errors stay visible).
 */
export function helpToggle(card: HTMLElement, item: object): HTMLButtonElement {
  const toggle = linkButton(HELP_TOGGLE.show, () => undefined, 'ns-help-toggle ns-secondary');
  const apply = (expanded: boolean): void => {
    card.classList.toggle('ns-help-hidden', !expanded);
    toggle.textContent = expanded ? HELP_TOGGLE.hide : HELP_TOGGLE.show;
    toggle.setAttribute('aria-pressed', expanded ? 'true' : 'false');
  };
  toggle.addEventListener('click', () => {
    const next = !helpExpanded(item);
    helpChoice.set(item, next);
    apply(next);
  });
  apply(helpExpanded(item));
  return toggle;
}

export interface IdFieldOptions {
  path: string;
  value: string;
  help: string;
  onChange(value: string): void;
}

/**
 * The ID, read-only with an Edit toggle, for people who hand-edit config.json (SPEC section 11.2, item 14).
 * Uniqueness and format are still validated; an issue opens the disclosure it sits in.
 */
export function idField(opts: IdFieldOptions): HTMLElement {
  const id = uniqueId('id');
  const input = el('input', {
    id, class: 'form-control font-monospace', type: 'text', value: opts.value, autocomplete: 'off', spellcheck: 'false', readonly: true,
    'data-id-input': 'true',
  });
  input.addEventListener('input', () => opts.onChange(input.value));
  const edit = linkButton(ID_FIELD.edit, () => {
    input.readOnly = false;
    input.focus();
    input.select();
    edit.hidden = true;
  }, 'ns-id-edit');
  edit.setAttribute('aria-label', `${ID_FIELD.edit} ${ID_FIELD.label}`);
  return el('div', { class: 'mb-3 ns-id-field', 'data-path': opts.path },
    el('div', { class: 'ns-label-row' }, el('label', { class: 'form-label', for: id }, ID_FIELD.label), edit),
    input,
    helpText(opts.help),
    el('div', { class: 'invalid-feedback' }),
  );
}

/**
 * The "Show variables" / "Hide variables" toggle placed on a message or subject field's label row (SPEC
 * section 11.2, item 17): a link-styled button with a chevron that turns when the list is open. `extra`
 * goes into the field's `labelExtra`; `box` is inserted after the control and lists the template variables.
 */
export function variablesToggle(): { extra: HTMLElement; box: HTMLElement } {
  const box = el('div', { class: 'ns-variables form-text', hidden: true },
    el('div', {}, VARIABLES.intro),
    el('ul', { class: 'mb-1 ps-3' }, ...VARIABLES.items.map(([token, meaning]) => el('li', {}, el('code', {}, token), ` ${meaning}`))),
    helpLink(VARIABLES.link),
  );
  const chevron = el('span', { class: 'ns-chevron', 'aria-hidden': 'true' });
  const label = el('span', {}, VARIABLES.show);
  const extra = linkButton('', () => {
    box.hidden = !box.hidden;
    const open = !box.hidden;
    extra.setAttribute('aria-expanded', open ? 'true' : 'false');
    extra.classList.toggle('ns-open', open);
    label.textContent = open ? VARIABLES.hide : VARIABLES.show;
  }, 'ns-variables-toggle');
  extra.appendChild(chevron);
  extra.appendChild(label);
  extra.setAttribute('aria-expanded', 'false');
  return { extra, box };
}

/**
 * A QR code with its caption. On narrow viewports and touch devices the stylesheet hides it (a phone
 * cannot scan its own screen) and shows `compactLinkActions` instead (SPEC section 11.2, item 16).
 */
export function qrBlock(url: string, label: string, caption: string): HTMLElement {
  return el('div', { class: 'ns-qr-block' }, qrElement(url, label), el('div', { class: 'ns-qr-caption ns-secondary small' }, caption));
}

/**
 * "Open in Telegram", "Copy link" and "Share" for a t.me link, shown only where the QR code is hidden.
 * Share uses the Web Share API and is hidden when the browser does not offer it.
 */
export function compactLinkActions(url: string, shareText: string): HTMLElement {
  const copy = TELEGRAM_ONBOARDING;
  const share = el('button', { type: 'button', class: 'btn btn-outline-secondary btn-sm ns-share' }, copy.share);
  const nav = navigator as Navigator & { share?: (data: { title?: string; text?: string; url?: string }) => Promise<void> };
  if (typeof nav.share !== 'function') {
    share.hidden = true;
  } else {
    share.addEventListener('click', () => {
      nav.share?.({ text: shareText, url }).catch(() => undefined);
    });
  }
  return el('div', { class: 'ns-compact-actions' },
    linkOut(copy.openInTelegram, url, 'btn btn-outline-primary btn-sm'),
    copyButton(copy.copyLink, () => url),
    share,
  );
}
