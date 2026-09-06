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

/** A password input with a Show/Hide toggle. The value is never echoed anywhere but the input itself. */
export function passwordField(label: string, value: string, onChange: (value: string) => void, opts: FieldOptions = {}): HTMLElement {
  const id = uniqueId();
  const input = el('input', { id, class: 'form-control font-monospace', type: 'password', value, autocomplete: 'off', spellcheck: 'false' });
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
