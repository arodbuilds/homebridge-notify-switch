import type { Channel } from '../../src/types.js';
import { button, clear, el, outlineButton, uniqueId } from './dom.js';
import { phoneInput } from './phone.js';

/**
 * An editable list of addresses for one channel: phone rows for sms, email inputs for email,
 * chat id inputs for telegram. Mutates `values` in place and reports every change.
 *
 * Layout (SPEC section 11.2, item 15): each row is a block holding a flex line with the control and
 * its Remove button, and the validation message below that line on its own. An error never sits in
 * the flex line, so the input keeps its width when a message appears or disappears.
 */

export interface AddressListOptions {
  channel: Channel;
  values: string[];
  defaultCountry: string;
  /** Validation path of the list, for example `groups[0].sms`; rows get `[i]` appended. */
  path: string;
  onChange(): void;
  /** Called with the index of a removed entry so the page can shift the touched state of the rows after it. */
  onRemove?(index: number): void;
  addLabel?: string;
  emptyText?: string;
}

const CHANNEL_LABEL: Record<Channel, string> = { sms: 'phone number', email: 'email address', telegram: 'chat ID' };

/** Placeholders read as examples, never as values (SPEC section 11.2, item 15). */
const PLACEHOLDER: Record<Exclude<Channel, 'sms'>, string> = { email: 'e.g. name@example.com', telegram: 'e.g. 123456789 or -1001234567890' };

export interface AddressListHandle {
  el: HTMLElement;
  /** Re-renders the rows, for example after a number was added from Look up numbers. */
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
      // List-entry Remove buttons stay single-click (SPEC section 11.2, item 11).
      const remove = button('Remove', () => {
        opts.values.splice(i, 1);
        opts.onRemove?.(i);
        opts.onChange();
        render();
      }, 'btn btn-outline-danger btn-sm');
      remove.setAttribute('aria-label', `Remove ${CHANNEL_LABEL[opts.channel]} ${i + 1}`);
      let control: HTMLElement;
      if (opts.channel === 'sms') {
        // The Remove button sits inside the phone row, beside the number field, so a stacked phone row keeps it on the number's line.
        control = phoneInput({
          value,
          defaultCountry: opts.defaultCountry,
          onChange: (next) => {
            opts.values[i] = next;
            opts.onChange();
          },
          trailing: remove,
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
          placeholder: PLACEHOLDER[opts.channel],
          'aria-label': `${CHANNEL_LABEL[opts.channel]} ${i + 1}`,
          value,
        });
        input.addEventListener('input', () => {
          opts.values[i] = input.value;
          opts.onChange();
        });
        control = input;
      }
      rows.appendChild(el('div', { class: `address-row address-row-${opts.channel}`, 'data-path': `${opts.path}[${i}]` },
        el('div', { class: 'address-row-controls' },
          el('div', { class: 'address-control' }, control),
          opts.channel === 'sms' ? null : remove,
        ),
        el('div', { class: 'invalid-feedback' }),
      ));
    });
  };

  const add = outlineButton(opts.addLabel ?? `Add ${CHANNEL_LABEL[opts.channel]}`, () => {
    opts.values.push('');
    opts.onChange();
    render();
    const inputs = rows.querySelectorAll<HTMLInputElement>('input');
    inputs[inputs.length - 1]?.focus();
  });

  render();
  wrapper.appendChild(rows);
  wrapper.appendChild(add);
  wrapper.appendChild(el('div', { class: 'invalid-feedback' }));
  return { el: wrapper, refresh: render };
}
