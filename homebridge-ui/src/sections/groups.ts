import type { ChatSummary } from '../../../src/types.js';
import { addressList } from '../addressList.js';
import { callServer } from '../api.js';
import type { App } from '../app.js';
import { GROUPS_SECTION, TELEGRAM_HELP } from '../copy.js';
import { button, clear, el, paragraph, statusBox, textField } from '../dom.js';
import { exportProvider, newGroup, slugify } from '../model.js';
import type { UiGroup } from '../model.js';
import { providerTitle } from './providers.js';

export function groupTitle(g: UiGroup): string {
  return g.name.trim() || g.id.trim() || 'New group';
}

interface FindChatsResult {
  ok: boolean;
  message: string;
  chats: ChatSummary[];
}

function findChatsPanel(app: App, g: UiGroup, refreshList: () => void): HTMLElement {
  const telegramProviders = app.config.providers.filter((p) => p.type === 'telegram');
  const panel = el('div', { class: 'find-chats mb-2' });
  if (telegramProviders.length === 0) {
    panel.appendChild(el('div', { class: 'form-text' }, 'Add a Telegram provider above to look up chat IDs.'));
    return panel;
  }
  let selected = telegramProviders[0];
  const controls = el('div', { class: 'd-flex flex-wrap align-items-center gap-2 mb-2' });
  if (telegramProviders.length > 1) {
    const select = el('select', { class: 'form-select form-select-sm w-auto', 'aria-label': 'Telegram provider to search with' });
    telegramProviders.forEach((p, i) => select.appendChild(el('option', { value: String(i) }, providerTitle(p))));
    select.addEventListener('change', () => {
      selected = telegramProviders[Number(select.value)] ?? telegramProviders[0];
    });
    controls.appendChild(select);
  }
  const status = statusBox();
  const results = el('div', { class: 'chat-results' });
  controls.appendChild(button('Find chat IDs', async () => {
    clear(results);
    status.set('info', 'Asking Telegram for recent messages…');
    const result = await callServer<FindChatsResult>('/find-chats', { provider: exportProvider(selected) });
    const chats = Array.isArray(result.chats) ? result.chats : [];
    status.set(result.ok ? (chats.length > 0 ? 'success' : 'warning') : 'danger', result.message);
    for (const chat of chats) {
      const present = g.telegram.map((v) => v.trim()).includes(chat.id);
      const add = button(present ? 'Added' : 'Add', () => {
        if (!g.telegram.map((v) => v.trim()).includes(chat.id)) {
          g.telegram.push(chat.id);
          app.changed(true);
          refreshList();
        }
        add.textContent = 'Added';
        add.disabled = true;
      }, 'btn btn-outline-success btn-sm');
      add.disabled = present;
      results.appendChild(el('div', { class: 'chat-result d-flex align-items-center gap-2' },
        el('span', { class: 'font-monospace' }, chat.id),
        el('span', { class: 'flex-grow-1' }, chat.title, el('span', { class: 'text-muted small ms-1' }, `(${chat.type})`)),
        add,
      ));
    }
  }, 'btn btn-outline-primary btn-sm'));
  panel.appendChild(controls);
  panel.appendChild(status.el);
  panel.appendChild(results);
  return panel;
}

function groupCard(app: App, g: UiGroup, index: number): HTMLElement {
  const path = `groups[${index}]`;
  const title = el('span', { class: 'fw-semibold' }, groupTitle(g));
  const header = el('div', { class: 'card-header d-flex justify-content-between align-items-center' },
    title,
    button('Remove', () => {
      app.config.groups.splice(index, 1);
      app.rerender('groups', true);
    }, 'btn btn-outline-danger btn-sm'),
  );
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
    findChatsPanel(app, g, () => telegramList.refresh()),
    telegramList.el,
    el('div', { class: 'form-text' }, TELEGRAM_HELP.chatIds),
  ));
  return el('div', { class: 'card mb-3', 'data-path': path }, header, body);
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
