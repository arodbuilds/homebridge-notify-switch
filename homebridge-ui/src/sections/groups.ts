import { addressList } from '../addressList.js';
import type { App } from '../app.js';
import { GROUPS_SECTION, TELEGRAM_HELP } from '../copy.js';
import { button, cardFooter, dangerLinkButton, el, paragraph, textField } from '../dom.js';
import { newGroup, slugify } from '../model.js';
import type { UiGroup } from '../model.js';

export function groupTitle(g: UiGroup): string {
  return g.name.trim() || g.id.trim() || 'New group';
}

function groupCard(app: App, g: UiGroup, index: number): HTMLElement {
  const path = `groups[${index}]`;
  const title = el('span', { class: 'fw-semibold' }, groupTitle(g));
  const header = el('div', { class: 'card-header d-flex justify-content-between align-items-center' }, title);
  const body = el('div', { class: 'card-body' });
  let idTouched = g.id.trim().length > 0 && g.id !== slugify(g.name);
  const idField = textField('ID', g.id, (value) => {
    g.id = value;
    idTouched = true;
    app.changed(true);
  }, {
    path: `${path}.id`, required: true, monospace: true, placeholder: 'family',
    help: 'Short unique identifier switches use to reference this group. Lowercase letters, numbers, dashes, and underscores.',
  });
  const idInput = idField.querySelector('input') as HTMLInputElement;
  body.appendChild(el('div', { class: 'ns-grid' },
    el('div', { class: 'ns-span-6' }, textField('Name', g.name, (value) => {
      g.name = value;
      title.textContent = groupTitle(g);
      if (!idTouched) {
        g.id = slugify(value);
        idInput.value = g.id;
      }
      app.changed(true);
    }, { path: `${path}.name`, required: true, placeholder: 'Family', help: 'Display name for this group.' })),
    el('div', { class: 'ns-span-6' }, idField),
  ));

  const onChange = (): void => app.changed(true);
  body.appendChild(el('div', { class: 'mb-3' },
    el('label', { class: 'form-label' }, 'Phone numbers (SMS)'),
    addressList({ channel: 'sms', values: g.sms, defaultCountry: app.config.defaultCountry, path: `${path}.sms`, onChange }).el,
  ));
  body.appendChild(el('div', { class: 'mb-3' },
    el('label', { class: 'form-label' }, 'Email addresses'),
    addressList({ channel: 'email', values: g.email, defaultCountry: app.config.defaultCountry, path: `${path}.email`, onChange }).el,
  ));
  const telegramList = addressList({ channel: 'telegram', values: g.telegram, defaultCountry: app.config.defaultCountry, path: `${path}.telegram`, onChange });
  body.appendChild(el('div', { class: 'mb-3' },
    el('label', { class: 'form-label' }, 'Telegram chat IDs'),
    telegramList.el,
    el('div', { class: 'form-text' }, TELEGRAM_HELP.chatIds),
  ));
  // Footer (SPEC section 11.2, item 11): Remove group on the left, nothing on the right.
  const remove = dangerLinkButton('Remove group', () => {
    app.config.groups.splice(index, 1);
    app.rerender('groups', true);
  });
  return el('div', { class: 'card mb-3', 'data-path': path }, header, body, cardFooter(remove, null));
}

export function renderGroups(app: App, container: HTMLElement): void {
  container.appendChild(paragraph(GROUPS_SECTION));
  app.config.groups.forEach((g, i) => container.appendChild(groupCard(app, g, i)));
  if (app.config.groups.length === 0) {
    container.appendChild(el('div', { class: 'form-text mb-2' }, 'No groups yet.'));
  }
  container.appendChild(button('Add group', () => {
    app.config.groups.push(newGroup());
    app.rerender('groups', true);
  }, 'btn btn-primary btn-sm'));
}
