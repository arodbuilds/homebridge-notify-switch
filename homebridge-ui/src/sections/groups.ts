import { addressList } from '../addressList.js';
import type { App } from '../app.js';
import { helpToggle, idField } from '../card.js';
import { GROUPS_SECTION, ID_FIELD, TELEGRAM_HELP } from '../copy.js';
import { addButton, cardFooter, dangerLinkButton, disclosure, el, helpText, paragraph, textField } from '../dom.js';
import { createGroup, slugify, uniqueSlug } from '../model.js';
import type { UiGroup } from '../model.js';

export function groupTitle(g: UiGroup): string {
  return g.name.trim() || g.id.trim() || 'New group';
}

/** True when a switch action sends to this group, in which case the id must not follow the name any more. */
function groupReferenced(app: App, id: string): boolean {
  return id.length > 0 && app.config.switches.some((s) => s.actions.some((a) => a.groups.includes(id)));
}

function groupCard(app: App, g: UiGroup, index: number): HTMLElement {
  const path = `groups[${index}]`;
  const others = (): string[] => app.config.groups.filter((other) => other !== g).map((other) => other.id);
  const title = el('span', { class: 'fw-semibold' }, groupTitle(g));
  const card = el('div', { class: 'card mb-3', 'data-path': path });
  const header = el('div', { class: 'card-header d-flex justify-content-between align-items-center gap-2' }, title, helpToggle(card, g));
  const body = el('div', { class: 'card-body' });

  // The id is generated from the name (SPEC section 11.2, item 14) and keeps following it until it is
  // edited by hand under Advanced or a switch refers to it, so renaming never breaks a switch.
  let idFollowsName = !groupReferenced(app, g.id.trim()) && (slugify(g.name) === '' || g.id.trim() === uniqueSlug(g.name, others(), 'group'));
  const id = idField({
    path: `${path}.id`, value: g.id, help: ID_FIELD.groupHelp, onChange: (value) => {
      g.id = value;
      idFollowsName = false;
      app.changed(true);
    },
  });
  const idInput = id.querySelector('input') as HTMLInputElement;

  body.appendChild(textField('Name', g.name, (value) => {
    g.name = value;
    title.textContent = groupTitle(g);
    if (idFollowsName) {
      g.id = uniqueSlug(value, others(), 'group');
      idInput.value = g.id;
    }
    app.changed(true);
  }, { path: `${path}.name`, required: true, placeholder: 'Family' }));

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
    helpText(TELEGRAM_HELP.chatIds),
  ));
  body.appendChild(disclosure('Advanced', [id], { attrs: { 'data-advanced': path } }));

  // Footer (SPEC section 11.2, item 11): Remove group on the left, nothing on the right.
  const remove = dangerLinkButton('Remove group', () => {
    app.config.groups.splice(index, 1);
    app.rerender('groups', true);
  });
  card.appendChild(header);
  card.appendChild(body);
  card.appendChild(cardFooter(remove, null));
  app.watchCard(card, g);
  return card;
}

export function renderGroups(app: App, container: HTMLElement): void {
  container.appendChild(paragraph(GROUPS_SECTION));
  app.config.groups.forEach((g, i) => container.appendChild(groupCard(app, g, i)));
  if (app.config.groups.length === 0) {
    container.appendChild(el('div', { class: 'form-text mb-2' }, 'No groups yet.'));
  }
  // Disabled with the "Add a provider first." hint while there is no provider (SPEC section 11.2, item 19).
  container.appendChild(addButton('Add group', () => {
    const g = createGroup(app.config.groups);
    app.config.groups.push(g);
    app.addFresh(g);
    app.rerender('groups', true);
  }, app.config.providers.length > 0));
}
