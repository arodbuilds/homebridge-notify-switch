import type { Channel } from '../../src/types.js';
import { button, clear, el, uniqueId } from './dom.js';
import { phoneInput } from './phone.js';

/**
 * An editable list of addresses for one channel: phone rows for sms, email inputs for email,
 * chat id inputs for telegram. Mutates `values` in place and reports every change.
 */

export interface AddressListOptions {
  channel: Channel;
  values: string[];
  defaultCountry: string;
  /** Validation path of the list, for example `groups[0].sms`; rows get `[i]` appended. */
  path: string;
  onChange(): void;
  addLabel?: string;
  emptyText?: string;
}

const CHANNEL_LABEL: Record<Channel, string> = { sms: 'phone number', email: 'email address', telegram: 'chat ID' };

export interface AddressListHandle {
  el: HTMLElement;
  /** Re-renders the rows, for example after a chat id was added from Find chat IDs. */
  refresh(): void;
}

export function addressList(opts: AddressListOptions): AddressListHandle {
  const rows = el('div', { class: 'address-rows' });
  const wrapper = el('div', { class: 'address-list', 'data-path': opts.path });

  const render = (): void => {
    clear(rows);
    if (opts.values.length === 0) {
      rows.appendChild(el('div', { class: 'form-text mb-2' }, opts.emptyText ?? `No ${CHANNEL_LABEL[opts.channel]}s yet.`));
    }
    opts.values.forEach((value, i) => {
      const remove = button('Remove', () => {
        opts.values.splice(i, 1);
        opts.onChange();
        render();
      }, 'btn btn-outline-danger btn-sm');
      remove.setAttribute('aria-label', `Remove ${CHANNEL_LABEL[opts.channel]} ${i + 1}`);
      let control: HTMLElement;
      if (opts.channel === 'sms') {
        control = phoneInput({
          value,
          defaultCountry: opts.defaultCountry,
          onChange: (next) => {
            opts.values[i] = next;
            opts.onChange();
          },
        });
      } else {
        const id = uniqueId('addr');
        const input = el('input', {
          id,
          class: 'form-control',
          type: opts.channel === 'email' ? 'email' : 'text',
          inputmode: opts.channel === 'telegram' ? 'numeric' : 'email',
          autocomplete: 'off',
          spellcheck: 'false',
          placeholder: opts.channel === 'email' ? 'name@example.com' : '123456789 or -1001234567890',
          'aria-label': `${CHANNEL_LABEL[opts.channel]} ${i + 1}`,
          value,
        });
        input.addEventListener('input', () => {
          opts.values[i] = input.value;
          opts.onChange();
        });
        control = input;
      }
      rows.appendChild(el('div', { class: 'address-row', 'data-path': `${opts.path}[${i}]` },
        el('div', { class: 'address-control' }, control),
        remove,
        el('div', { class: 'invalid-feedback' }),
      ));
    });
  };

  const add = button(opts.addLabel ?? `Add ${CHANNEL_LABEL[opts.channel]}`, () => {
    opts.values.push('');
    opts.onChange();
    render();
    const inputs = rows.querySelectorAll<HTMLInputElement>('input');
    inputs[inputs.length - 1]?.focus();
  }, 'btn btn-outline-secondary btn-sm');

  render();
  wrapper.appendChild(rows);
  wrapper.appendChild(add);
  wrapper.appendChild(el('div', { class: 'invalid-feedback' }));
  return { el: wrapper, refresh: render };
}
