import { addressList } from '../addressList.js';
import type { App } from '../app.js';
import { cardHeader, idField } from '../card.js';
import { DUPLICATE, GROUP_NAME_HELP, GROUPS_SECTION, ID_FIELD, NTFY_HELP, REMOVE, TELEGRAM_HELP } from '../copy.js';
import {
  addButton, cardFooter, dangerLinkButton, disclosure, el, grid, gridCell, helpText, inlineConfirm, linkButton, paragraph, textField,
} from '../dom.js';
import { createGroup, duplicateGroup, slugify, uniqueSlug } from '../model.js';
import type { UiGroup } from '../model.js';

export function groupTitle(g: UiGroup): string {
  return g.name.trim() || g.id.trim() || 'New group';
}

/** True when a switch sends to this group, in which case the id must not follow the name any more. */
function groupReferenced(app: App, id: string): boolean {
  return id.length > 0 && app.config.switches.some((s) => s.groups.includes(id));
}

function groupCard(app: App, g: UiGroup, index: number): HTMLElement {
  const path = `groups[${index}]`;
  const others = (): string[] => app.config.groups.filter((other) => other !== g).map((other) => other.id);
  const title = el('span', { class: 'fw-semibold' }, groupTitle(g));
  const card = el('div', { class: 'card mb-3', 'data-path': path });
  // The shared header strip (SPEC section 11.2, item 28): a group card has no type badge and no header links.
  const header = cardHeader(card, g, title, [], []);
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
  }, { path: `${path}.name`, required: true, placeholder: 'e.g. Family', help: GROUP_NAME_HELP }));

  const onChange = (): void => app.changed(true);
  const list = (channel: 'sms' | 'email' | 'telegram' | 'ntfy'): HTMLElement => addressList({
    channel, values: g[channel], defaultCountry: app.config.defaultCountry, path: `${path}.${channel}`, onChange,
    onRemove: (i) => app.entryRemoved(`${path}.${channel}`, i),
  }).el;
  body.appendChild(el('div', { class: 'mb-3' }, el('label', { class: 'form-label' }, 'Phone numbers (SMS)'), list('sms')));
  body.appendChild(el('div', { class: 'mb-3' }, el('label', { class: 'form-label' }, 'Email addresses'), list('email')));
  body.appendChild(el('div', { class: 'mb-3' },
    el('label', { class: 'form-label' }, 'Telegram chat IDs'),
    list('telegram'),
    helpText(TELEGRAM_HELP.chatIds),
  ));
  body.appendChild(el('div', { class: 'mb-3' },
    el('label', { class: 'form-label' }, 'ntfy topics'),
    list('ntfy'),
    helpText(NTFY_HELP.topics),
  ));
  // Advanced opens a second 12-column grid (SPEC section 11.2, item 28) holding the ID.
  body.appendChild(disclosure('Advanced', [grid(gridCell(12, id))], { cls: 'mb-3', attrs: { 'data-advanced': path } }));

  // Footer (SPEC section 11.2, items 11 and 28): Remove group on the left with its in-place confirmation ("Remove {name}?"),
  // nothing on the right.
  const remove = inlineConfirm({
    start: dangerLinkButton('Remove group', () => undefined),
    question: () => REMOVE.question('group', g.name.trim()),
    confirmLabel: REMOVE.confirm,
    confirmClass: 'btn btn-danger btn-sm',
    cancelLabel: REMOVE.cancel,
    cls: 'ns-remove-confirm',
    onConfirm: () => {
      app.config.groups.splice(index, 1);
      app.entryRemoved('groups', index);
      app.rerender('groups', true);
    },
  });
  // Duplicate group (SPEC section 11.2, item 11): a copy directly below this card with every address list, treated like a
  // group added with Add group; its Name field takes focus and the card scrolls into view. No switch is changed.
  const duplicate = linkButton(DUPLICATE.group, () => {
    const copy = duplicateGroup(g, app.config.groups);
    app.config.groups.splice(index + 1, 0, copy);
    app.addFresh(copy);
    app.rerender('groups', true);
    const nameInput = document.querySelector<HTMLInputElement>(`[data-path="groups[${index + 1}].name"] input`);
    nameInput?.closest('.card')?.scrollIntoView({ block: 'start', behavior: 'smooth' });
    nameInput?.focus({ preventScroll: true });
  }, 'ns-duplicate');
  card.appendChild(header);
  card.appendChild(body);
  card.appendChild(cardFooter([remove, duplicate], null));
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
