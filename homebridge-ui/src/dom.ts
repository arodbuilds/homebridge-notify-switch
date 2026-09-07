/**
 * Tiny DOM helpers. The UI is plain HTML built with these; Bootstrap 5 classes come from the
 * Homebridge UI, which injects its stylesheet and theme into the settings iframe.
 */

type Child = Node | string | null | undefined | false;

export function append(parent: Node, ...children: Child[]): void {
  for (const child of children) {
    if (child === null || child === undefined || child === false) {
      continue;
    }
    parent.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
  }
}

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K, attrs: Record<string, string | boolean | undefined> = {}, ...children: Child[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === false) {
      continue;
    }
    if (key === 'class') {
      node.className = String(value);
    } else if (key === 'text') {
      node.textContent = String(value);
    } else if (value === true) {
      node.setAttribute(key, '');
    } else {
      node.setAttribute(key, value);
    }
  }
  append(node, ...children);
  return node;
}

export function clear(node: Node): void {
  while (node.firstChild) {
    node.removeChild(node.firstChild);
  }
}

let idCounter = 0;
export function uniqueId(prefix = 'f'): string {
  idCounter += 1;
  return `${prefix}-${idCounter}`;
}

export interface FieldOptions {
  /** Validation path this control edits, for example `providers[0].apiKeySid`; used to show inline errors. */
  path?: string;
  help?: string;
  placeholder?: string;
  type?: string;
  required?: boolean;
  autocomplete?: string;
  inputmode?: string;
  min?: number;
  max?: number;
  monospace?: boolean;
}

function wrapField(id: string, label: string, control: HTMLElement, opts: FieldOptions, invalidTarget?: HTMLElement): HTMLElement {
  return el('div', { class: 'mb-3', 'data-path': opts.path, 'data-invalid-target': invalidTarget ? 'group' : undefined },
    el('label', { class: 'form-label', for: id }, label, opts.required ? el('span', { class: 'text-danger ms-1', 'aria-hidden': 'true' }, '*') : null),
    control,
    opts.help ? el('div', { class: 'form-text' }, opts.help) : null,
    el('div', { class: 'invalid-feedback' }),
  );
}

/** A labelled input with optional help text, calling `onChange` with the new string on every input event. */
export function textField(label: string, value: string, onChange: (value: string) => void, opts: FieldOptions = {}): HTMLElement {
  const id = uniqueId();
  const input = el('input', {
    id,
    class: `form-control${opts.monospace ? ' font-monospace' : ''}`,
    type: opts.type ?? 'text',
    value,
    placeholder: opts.placeholder,
    autocomplete: opts.autocomplete ?? 'off',
    inputmode: opts.inputmode,
    spellcheck: 'false',
  });
  input.addEventListener('input', () => onChange(input.value));
  return wrapField(id, label, input, opts);
}

/** A number input; `onChange` receives the parsed integer or NaN. */
export function numberField(label: string, value: number, onChange: (value: number) => void, opts: FieldOptions = {}): HTMLElement {
  const id = uniqueId();
  const input = el('input', {
    id, class: 'form-control', type: 'number', value: String(value), inputmode: 'numeric',
    min: opts.min !== undefined ? String(opts.min) : undefined, max: opts.max !== undefined ? String(opts.max) : undefined, step: '1',
  });
  input.addEventListener('input', () => onChange(input.value.trim() === '' ? Number.NaN : Number(input.value)));
  return wrapField(id, label, input, opts);
}

/**
 * A password input with a Show/Hide toggle. The value is never echoed anywhere but the input itself.
 * `autocomplete` is `new-password` because browsers ignore `off` on password inputs and would offer the
 * saved Homebridge login, silently replacing a pasted secret. The toggle only flips `type`; the value is untouched.
 */
export function passwordField(label: string, value: string, onChange: (value: string) => void, opts: FieldOptions = {}): HTMLElement {
  const id = uniqueId();
  const input = el('input', { id, class: 'form-control font-monospace', type: 'password', value, autocomplete: 'new-password', spellcheck: 'false' });
  input.addEventListener('input', () => onChange(input.value));
  const toggle = el('button', { class: 'btn btn-outline-secondary', type: 'button', 'aria-label': `Show ${label}` }, 'Show');
  toggle.addEventListener('click', () => {
    const reveal = input.type === 'password';
    input.type = reveal ? 'text' : 'password';
    toggle.textContent = reveal ? 'Hide' : 'Show';
    toggle.setAttribute('aria-label', `${reveal ? 'Hide' : 'Show'} ${label}`);
  });
  const group = el('div', { class: 'input-group' }, input, toggle);
  return wrapField(id, label, group, opts, input);
}

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export function selectField(label: string, value: string, options: SelectOption[], onChange: (value: string) => void, opts: FieldOptions = {}): HTMLElement {
  const id = uniqueId();
  const select = el('select', { id, class: 'form-select' });
  for (const option of options) {
    const node = el('option', { value: option.value, disabled: option.disabled }, option.label);
    if (option.value === value) {
      node.selected = true;
    }
    select.appendChild(node);
  }
  select.addEventListener('change', () => onChange(select.value));
  return wrapField(id, label, select, opts);
}

export function checkboxField(label: string, checked: boolean, onChange: (checked: boolean) => void, opts: FieldOptions = {}): HTMLElement {
  const id = uniqueId();
  const input = el('input', { id, class: 'form-check-input', type: 'checkbox' });
  input.checked = checked;
  input.addEventListener('change', () => onChange(input.checked));
  const wrapper = el('div', { class: 'form-check mb-3', 'data-path': opts.path },
    input,
    el('label', { class: 'form-check-label', for: id }, label),
    opts.help ? el('div', { class: 'form-text' }, opts.help) : null,
    el('div', { class: 'invalid-feedback' }),
  );
  return wrapper;
}

export function textareaField(label: string, value: string, onChange: (value: string) => void, opts: FieldOptions & { rows?: number } = {}): HTMLElement {
  const id = uniqueId();
  const input = el('textarea', { id, class: 'form-control', rows: String(opts.rows ?? 3), placeholder: opts.placeholder });
  input.value = value;
  input.addEventListener('input', () => onChange(input.value));
  return wrapField(id, label, input, opts);
}

export function button(label: string, onClick: () => void, cls = 'btn btn-outline-primary btn-sm'): HTMLButtonElement {
  const node = el('button', { type: 'button', class: cls }, label);
  node.addEventListener('click', onClick);
  return node;
}

export function paragraph(text: string, cls = 'section-copy'): HTMLElement {
  return el('p', { class: cls }, text);
}

/** Inline status line under a button: `kind` picks the Bootstrap alert colour. */
export function statusBox(): { el: HTMLElement; set(kind: 'success' | 'danger' | 'warning' | 'info' | 'none', message: string, detail?: Node): void } {
  const box = el('div', { class: 'status-box', role: 'status' });
  return {
    el: box,
    set(kind, message, detail) {
      clear(box);
      box.className = 'status-box';
      if (kind === 'none') {
        return;
      }
      box.className = `status-box alert alert-${kind} py-2 px-3 mb-0`;
      append(box, el('div', {}, message), detail ?? null);
    },
  };
}

/** A link-style (text) button: no border or background, used for secondary actions such as Add action and Cancel. */
export function linkButton(label: string, onClick: () => void, extra = ''): HTMLButtonElement {
  return button(label, onClick, `btn btn-link btn-sm p-0 ns-link-button${extra ? ` ${extra}` : ''}`);
}

/** A red text button: Remove and Reset only (SPEC section 11.3). */
export function dangerLinkButton(label: string, onClick: () => void): HTMLButtonElement {
  return linkButton(label, onClick, 'text-danger');
}

/**
 * Card footer row (SPEC section 11.2, item 11): the red text button on the left, at most one outlined
 * primary button on the right. `right` may be empty.
 */
export function cardFooter(left: HTMLElement | null, right: HTMLElement | null): HTMLElement {
  return el('div', { class: 'card-footer ns-card-footer' },
    el('div', { class: 'ns-footer-left' }, left),
    el('div', { class: 'ns-footer-right' }, right),
  );
}

export interface ModalHandle {
  el: HTMLElement;
  close(): void;
}

/**
 * A full-page modal over the settings page, closed by its Close button, the backdrop, or Escape.
 * `body` is the content; `actions` go in the footer row. The Homebridge UI's own modal does not
 * reach into the iframe, so the page draws its own.
 */
export function openModal(opts: { title: string; body: Node; actions?: Node[]; wide?: boolean }): ModalHandle {
  const backdrop = el('div', { class: 'ns-modal-backdrop', role: 'presentation' });
  const dialog = el('div', { class: `ns-modal${opts.wide ? ' ns-modal-wide' : ''}`, role: 'dialog', 'aria-modal': 'true', 'aria-label': opts.title });
  let onKey: (event: KeyboardEvent) => void = () => undefined;
  const close = (): void => {
    document.removeEventListener('keydown', onKey);
    backdrop.remove();
  };
  onKey = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
    }
  };
  document.addEventListener('keydown', onKey);
  backdrop.addEventListener('click', (event) => {
    if (event.target === backdrop) {
      close();
    }
  });
  const closeButton = el('button', { type: 'button', class: 'btn-close', 'aria-label': 'Close' });
  closeButton.addEventListener('click', close);
  dialog.appendChild(el('div', { class: 'ns-modal-header' }, el('div', { class: 'fw-semibold' }, opts.title), closeButton));
  dialog.appendChild(el('div', { class: 'ns-modal-body' }, opts.body));
  if (opts.actions && opts.actions.length > 0) {
    dialog.appendChild(el('div', { class: 'ns-modal-actions' }, ...opts.actions));
  }
  backdrop.appendChild(dialog);
  document.body.appendChild(backdrop);
  return { el: dialog, close };
}

/**
 * Copies text to the clipboard. The Homebridge UI usually runs over plain http on the LAN, where the
 * async clipboard API is unavailable, so a hidden textarea and `execCommand` are the fallback.
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // fall through to the legacy path
  }
  try {
    const area = el('textarea', { class: 'ns-clipboard', 'aria-hidden': 'true' });
    area.value = text;
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand('copy');
    area.remove();
    return ok;
  } catch {
    return false;
  }
}

/** A button that copies `text` and briefly reads "Copied" afterwards. */
export function copyButton(label: string, text: () => string, cls = 'btn btn-outline-secondary btn-sm'): HTMLButtonElement {
  const node = button(label, () => {
    copyText(text()).then((ok) => {
      node.textContent = ok ? 'Copied' : 'Could not copy';
      window.setTimeout(() => {
        node.textContent = label;
      }, 1500);
    }).catch(() => undefined);
  }, cls);
  return node;
}
