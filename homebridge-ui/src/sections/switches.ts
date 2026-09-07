import { addActionLabel, uncoveredChannels, uncoveredChannelWarning } from '../../../src/coverage.js';
import type { Channel, NtfyPriority, RecipientResult } from '../../../src/types.js';
import { CHANNELS, PROVIDER_CHANNELS } from '../../../src/types.js';
import { addressList } from '../addressList.js';
import { callServer } from '../api.js';
import type { App, ValidationListener } from '../app.js';
import { helpToggle, variablesToggle } from '../card.js';
import { NTFY_HELP, PROVIDER_TYPE_LABEL, REMOVE, SWITCHES_SECTION, SWITCH_HELP, TEST_SEND } from '../copy.js';
import {
  addButton, button, cardFooter, checkboxField, clear, dangerLinkButton, el, inlineConfirm, linkButton, numberField, outlineButton, paragraph,
  selectField, statusBox, textField, textareaField,
} from '../dom.js';
import { exportConfig, newAction, newSwitch } from '../model.js';
import type { UiAction, UiProvider, UiSwitch } from '../model.js';
import { smsCounter } from '../sms.js';
import type { UiIssue } from '../validate.js';
import { groupTitle } from './groups.js';
import { providerTitle } from './providers.js';

const CHANNEL_LABELS: Record<Channel, string> = { sms: 'SMS', email: 'Email', telegram: 'Telegram', ntfy: 'ntfy' };

/** The Tags field holds a comma separated list; the model keeps the tags as an array. */
function parseTags(text: string): string[] {
  return text.split(/[,\s]+/).map((tag) => tag.trim()).filter((tag) => tag.length > 0);
}

function switchTitle(s: UiSwitch): string {
  return s.name.trim() || 'New switch';
}

function providerFor(app: App, a: UiAction): UiProvider | undefined {
  return app.config.providers.find((p) => p.id.trim() === a.providerId && a.providerId);
}

/**
 * Uncovered channel warnings for one switch (SPEC section 11.2, item 8, and section 11.3): one line
 * per channel that a targeted group has addresses for but no action sends on, each with a button that
 * appends the missing action. A warning, not a validation error: it never touches the Save button.
 * `refresh()` recomputes it after the groups or actions change without re-rendering the card.
 */
function coverageWarnings(app: App, s: UiSwitch, rerenderSwitch: () => void): { el: HTMLElement; refresh(): void } {
  const box = el('div', { class: 'coverage-warnings', role: 'status' });
  const refresh = (): void => {
    clear(box);
    for (const uncovered of uncoveredChannels(s.actions, app.config.groups)) {
      const add = button(addActionLabel(uncovered.channel), () => {
        // The first provider that serves the channel, and the targeted groups that hold addresses on it.
        const provider = app.config.providers.find((p) => p.id.trim() && PROVIDER_CHANNELS[p.type].includes(uncovered.channel));
        const action = newAction(provider?.id.trim() ?? '', uncovered.channel);
        action.groups = [...uncovered.groups];
        s.actions.push(action);
        app.changed();
        rerenderSwitch();
      }, 'btn btn-outline-primary btn-sm');
      box.appendChild(el('div', { class: 'coverage-warning alert alert-warning py-2 px-3 mb-2', 'data-channel': uncovered.channel },
        el('span', { class: 'coverage-warning-text' }, uncoveredChannelWarning(uncovered.channel)),
        add,
      ));
    }
  };
  refresh();
  return { el: box, refresh };
}

/** A subject or message field with the Variables toggle on its label row and the variable list under the control. */
function withVariables(field: HTMLElement, box: HTMLElement): HTMLElement {
  field.querySelector('.form-control')?.insertAdjacentElement('afterend', box);
  return field;
}

function actionCard(
  app: App, s: UiSwitch, a: UiAction, switchIndex: number, index: number, rerenderSwitch: () => void, onGroupsChange: () => void,
): HTMLElement {
  const path = `switches[${switchIndex}].actions[${index}]`;
  const provider = providerFor(app, a);
  const header = el('div', { class: 'action-header d-flex justify-content-between align-items-center' },
    el('span', { class: 'fw-semibold' }, `Action ${index + 1}`),
    // List-entry Remove buttons stay single-click (SPEC section 11.2, item 11).
    button('Remove action', () => {
      s.actions.splice(index, 1);
      app.entryRemoved(`switches[${switchIndex}].actions`, index);
      app.changed();
      rerenderSwitch();
    }, 'btn btn-outline-danger btn-sm'),
  );
  const body = el('div', { class: 'action-body' });

  const providerOptions = [
    { value: '', label: app.config.providers.length === 0 ? 'No providers configured' : 'Choose a provider…', disabled: true },
    ...app.config.providers.filter((p) => p.id.trim()).map((p) => ({ value: p.id.trim(), label: `${providerTitle(p)} (${PROVIDER_TYPE_LABEL[p.type]})` })),
  ];
  if (a.providerId && !provider) {
    providerOptions.push({ value: a.providerId, label: `${a.providerId} (missing)` });
  }
  // Only the channels the selected provider serves (SPEC section 11.2, item 17); a stored channel it cannot serve stays selectable so it can be fixed.
  const channels = provider ? PROVIDER_CHANNELS[provider.type] : CHANNELS;
  const channelOptions = channels.map((c) => ({ value: c, label: CHANNEL_LABELS[c] }));
  if (!channels.includes(a.channel)) {
    channelOptions.push({ value: a.channel, label: `${CHANNEL_LABELS[a.channel]} (not served by this provider)` });
  }

  body.appendChild(el('div', { class: 'ns-grid' },
    el('div', { class: 'ns-span-6' }, selectField('Provider', a.providerId, providerOptions, (value) => {
      a.providerId = value;
      const next = providerFor(app, a);
      if (next && !PROVIDER_CHANNELS[next.type].includes(a.channel)) {
        a.channel = PROVIDER_CHANNELS[next.type][0];
      }
      a.sender = '';
      app.changed();
      rerenderSwitch();
    }, { path: `${path}.providerId`, required: true })),
    el('div', { class: 'ns-span-6' }, selectField('Channel', a.channel, channelOptions, (value) => {
      a.channel = value as Channel;
      a.sender = '';
      a.recipients = [];
      app.changed();
      rerenderSwitch();
    }, { path: `${path}.channel`, required: true })),
  ));

  if (provider?.type === 'twilio' && a.channel === 'sms') {
    const senders = provider.smsSenders.map((v) => v.trim()).filter((v) => v.length > 0);
    const service = provider.messagingServiceSid.trim();
    const auto = senders.length === 1 ? `Automatic (${senders[0]})` : service ? 'Automatic (Messaging Service)' : 'Automatic';
    const senderOptions = [{ value: '', label: auto }, ...senders.map((v) => ({ value: v, label: v }))];
    if (a.sender && !senders.includes(a.sender)) {
      senderOptions.push({ value: a.sender, label: `${a.sender} (not in provider)` });
    }
    body.appendChild(selectField('Sender', a.sender, senderOptions, (value) => {
      a.sender = value;
      app.changed();
    }, { path: `${path}.sender`, help: SWITCH_HELP.sender }));
  }

  // Groups: a checkbox per configured group, showing how many entries it has for this channel.
  const groupBox = el('div', { class: 'mb-3', 'data-path': `${path}.groups` }, el('label', { class: 'form-label' }, 'Groups'));
  const groups = app.config.groups.filter((g) => g.id.trim());
  if (groups.length === 0) {
    groupBox.appendChild(el('div', { class: 'form-text' }, 'No groups yet. Add one under Recipient Groups, or list extra recipients below.'));
  }
  for (const g of groups) {
    const id = g.id.trim();
    const count = g[a.channel].filter((v) => v.trim()).length;
    const input = el('input', { class: 'form-check-input', type: 'checkbox', id: `${path}.groups.${id}` });
    input.checked = a.groups.includes(id);
    input.addEventListener('change', () => {
      if (input.checked) {
        if (!a.groups.includes(id)) {
          a.groups.push(id);
        }
      } else {
        a.groups = a.groups.filter((v) => v !== id);
      }
      app.changed();
      onGroupsChange();
    });
    groupBox.appendChild(el('div', { class: 'form-check' },
      input,
      el('label', { class: 'form-check-label', for: `${path}.groups.${id}` },
        groupTitle(g), el('span', { class: 'ns-secondary small ms-1' }, `(${count} ${CHANNEL_LABELS[a.channel]} ${count === 1 ? 'entry' : 'entries'})`)),
    ));
  }
  for (const missing of a.groups.filter((id) => !groups.some((g) => g.id.trim() === id))) {
    const input = el('input', { class: 'form-check-input', type: 'checkbox', id: `${path}.groups.${missing}` });
    input.checked = true;
    input.addEventListener('change', () => {
      a.groups = a.groups.filter((v) => v !== missing);
      app.changed();
      onGroupsChange();
    });
    groupBox.appendChild(el('div', { class: 'form-check' }, input,
      el('label', { class: 'form-check-label text-danger', for: `${path}.groups.${missing}` }, `${missing} (missing group)`)));
  }
  groupBox.appendChild(el('div', { class: 'invalid-feedback' }));
  body.appendChild(groupBox);

  body.appendChild(el('div', { class: 'mb-3' },
    el('label', { class: 'form-label' }, `Extra recipients (${CHANNEL_LABELS[a.channel]})`),
    addressList({
      channel: a.channel, values: a.recipients, defaultCountry: app.config.defaultCountry, path: `${path}.recipients`,
      onChange: () => app.changed(), onRemove: (i) => app.entryRemoved(`${path}.recipients`, i),
      emptyText: 'None. Groups above cover everyone unless you add someone here.',
    }).el,
  ));

  if (a.channel === 'email' || a.channel === 'ntfy') {
    // The email subject, or the ntfy notification title (SPEC section 5.5, item 7); both default to the switch name.
    const variables = variablesToggle();
    const name = s.name.trim();
    body.appendChild(withVariables(textField(a.channel === 'ntfy' ? 'Title' : 'Subject', a.subject, (value) => {
      a.subject = value;
      app.changed();
    }, {
      path: `${path}.subject`, placeholder: name ? `Defaults to the switch name: ${name}` : 'Defaults to the switch name',
      help: a.channel === 'ntfy' ? NTFY_HELP.title : SWITCH_HELP.subject, labelExtra: variables.extra,
    }), variables.box));
  }
  if (a.channel === 'email') {
    // Recipients see each other in To unless this is checked (SPEC section 6.2 and 6.3).
    body.appendChild(checkboxField(SWITCH_HELP.bcc, a.bcc, (value) => {
      a.bcc = value;
      app.changed();
    }, { path: `${path}.bcc`, help: SWITCH_HELP.bccHelp }));
  }
  if (a.channel === 'ntfy') {
    // Priority and tags (SPEC section 5.5, items 10 and 11) side by side.
    body.appendChild(el('div', { class: 'ns-grid' },
      el('div', { class: 'ns-span-4' }, selectField(NTFY_HELP.priorityLabel, a.priority, NTFY_HELP.priorityOptions, (value) => {
        a.priority = value as NtfyPriority;
        app.changed();
      }, { path: `${path}.priority`, help: NTFY_HELP.priority })),
      el('div', { class: 'ns-span-8' }, textField(NTFY_HELP.tagsLabel, a.tags.join(', '), (value) => {
        a.tags = parseTags(value);
        app.changed();
      }, { path: `${path}.tags`, placeholder: NTFY_HELP.tagsPlaceholder, help: NTFY_HELP.tags })),
    ));
  }

  const counter = a.channel === 'sms' ? smsCounter() : undefined;
  const variables = variablesToggle();
  const bodyField = textareaField('Message', a.body, (value) => {
    a.body = value;
    counter?.update(value);
    app.changed();
  }, {
    path: `${path}.body`, required: true, rows: a.channel === 'sms' ? 3 : 5, help: a.channel === 'sms' ? SWITCH_HELP.bodySms : SWITCH_HELP.bodyOther,
    labelExtra: variables.extra,
    placeholder: a.channel === 'sms' ? 'e.g. Water detected under the kitchen sink at {{time}}.' : 'e.g. Water detected at {{time}} on {{date}}.',
  });
  withVariables(bodyField, variables.box);
  if (counter) {
    counter.update(a.body);
    bodyField.querySelector('textarea')?.insertAdjacentElement('afterend', counter.el);
  }
  body.appendChild(bodyField);

  return el('div', { class: 'action-card', 'data-path': path }, header, body);
}

interface TestSendResult {
  ok: boolean;
  message: string;
  errors?: string[];
  actions?: Array<{ index: number; providerId: string; channel: Channel; results: RecipientResult[] }>;
}

function recipientCount(app: App, s: UiSwitch): number {
  const seen = new Set<string>();
  for (const a of s.actions) {
    for (const groupId of a.groups) {
      const g = app.config.groups.find((entry) => entry.id.trim() === groupId);
      for (const v of g?.[a.channel] ?? []) {
        if (v.trim()) {
          seen.add(`${a.channel}:${v.trim()}`);
        }
      }
    }
    for (const v of a.recipients) {
      if (v.trim()) {
        seen.add(`${a.channel}:${v.trim()}`);
      }
    }
  }
  return seen.size;
}

/** The paths whose issues block a Test send of this switch: the switch itself and the providers and groups it uses. */
function testSendScope(app: App, s: UiSwitch, index: number): string[] {
  const scope = [`switches[${index}]`];
  for (const a of s.actions) {
    const p = app.config.providers.findIndex((entry) => entry.id.trim() === a.providerId && a.providerId);
    if (p >= 0) {
      scope.push(`providers[${p}]`);
    }
    for (const groupId of a.groups) {
      const g = app.config.groups.findIndex((entry) => entry.id.trim() === groupId);
      if (g >= 0) {
        scope.push(`groups[${g}]`);
      }
    }
  }
  return scope;
}

interface TestSendPanel {
  /** The footer control: the Test send button with its hint, replaced in place by the confirmation while it is open. */
  control: HTMLElement;
  /** Per-recipient results, rendered below the footer with a Dismiss link. */
  results: HTMLElement;
}

/**
 * Test send (SPEC section 11.2, item 4, and section 11.3): the outlined Test send button is replaced in
 * place by "Send to {n} recipients now?" with a primary Send button and a text Cancel button. Escape or
 * Cancel restores the button. Results appear below the card footer with a Dismiss link. The button is
 * disabled, with a short hint beside it, while the switch has validation errors or no recipients, so the
 * confirmation can never read "Send to 0 recipients".
 */
function testSendPanel(app: App, s: UiSwitch, index: number): TestSendPanel {
  const status = statusBox();
  const results = el('div', { class: 'ns-card-results test-results' });
  const start = el('button', { type: 'button', class: 'btn btn-outline-primary btn-sm' }, 'Test send');
  const hint = el('span', { class: 'form-text ns-test-send-hint', hidden: true });
  const showResults = (result: TestSendResult): void => {
    clear(results);
    status.set(result.ok ? 'success' : 'danger', result.message);
    results.appendChild(status.el);
    for (const error of result.errors ?? []) {
      results.appendChild(el('div', { class: 'small text-danger font-monospace' }, error));
    }
    for (const action of result.actions ?? []) {
      const table = el('table', { class: 'table table-sm mb-2' },
        el('caption', { class: 'small ns-secondary caption-top py-1' },
          `Action ${action.index + 1}: ${CHANNEL_LABELS[action.channel]} via ${action.providerId}`),
        el('thead', {}, el('tr', {}, el('th', {}, 'Recipient'), el('th', {}, 'Result'))),
      );
      const tbody = el('tbody');
      for (const r of action.results) {
        tbody.appendChild(el('tr', {},
          el('td', { class: 'font-monospace' }, r.recipient),
          el('td', { class: r.ok ? 'text-success' : 'text-danger' }, r.ok ? `Sent${r.id ? ` (${r.id})` : ''}` : `Failed: ${r.error ?? 'unknown error'}`),
        ));
      }
      table.appendChild(tbody);
      results.appendChild(table);
    }
    results.appendChild(linkButton(TEST_SEND.dismiss, () => clear(results)));
  };
  const confirm = inlineConfirm({
    start,
    question: () => TEST_SEND.confirm(recipientCount(app, s)),
    confirmLabel: TEST_SEND.send,
    confirmClass: 'btn btn-primary btn-sm',
    cancelLabel: TEST_SEND.cancel,
    cls: 'test-send',
    onConfirm: async () => {
      clear(results);
      status.set('info', 'Sending…');
      results.appendChild(status.el);
      showResults(await callServer<TestSendResult>('/test-send', { config: exportConfig(app.config), switchId: s.id }));
    },
  });
  const control: ValidationListener = el('span', { class: 'd-inline-flex flex-wrap align-items-center gap-2 ns-on-validate ns-test-send' }, confirm, hint);
  control.nsOnValidate = (issues: UiIssue[]): void => {
    const scope = testSendScope(app, s, index);
    const blocked = issues.some((issue) => scope.some((prefix) => issue.path === prefix || issue.path.startsWith(`${prefix}.`)));
    const reason = blocked ? TEST_SEND.fixErrors : recipientCount(app, s) === 0 ? TEST_SEND.noRecipients : '';
    start.disabled = reason.length > 0;
    start.title = reason;
    hint.textContent = reason;
    hint.hidden = reason.length === 0;
  };
  return { control, results };
}

function switchCard(app: App, s: UiSwitch, index: number, host: HTMLElement): HTMLElement {
  const path = `switches[${index}]`;
  const card = el('div', { class: 'card mb-3', 'data-path': path });
  const rerenderSwitch = (): void => {
    host.replaceChild(switchCard(app, s, index, host), card);
  };
  const title = el('span', { class: 'fw-semibold' }, switchTitle(s));
  const header = el('div', { class: 'card-header d-flex justify-content-between align-items-center gap-2' }, title, helpToggle(card, s));
  const body = el('div', { class: 'card-body' });

  body.appendChild(textField('Name', s.name, (value) => {
    s.name = value;
    title.textContent = switchTitle(s);
    app.changed();
  }, { path: `${path}.name`, required: true, placeholder: 'e.g. Water Leak Alert', help: SWITCH_HELP.name }));
  body.appendChild(el('div', { class: 'form-text ns-help mb-3 switch-id', 'data-path': `${path}.id` },
    'ID ', el('code', {}, s.id), ' (generated; HomeKit tracks the switch by this id, so you can rename it freely)', el('div', { class: 'invalid-feedback' })));

  body.appendChild(el('div', { class: 'ns-grid' },
    el('div', { class: 'ns-span-4' }, checkboxField('Enabled', s.enabled, (value) => {
      s.enabled = value;
      app.changed();
    }, { path: `${path}.enabled`, help: 'A disabled switch still appears in the Home app but does nothing when turned on.' })),
    el('div', { class: 'ns-span-4' }, numberField('Cooldown (seconds)', s.cooldownSeconds, (value) => {
      s.cooldownSeconds = value;
      app.changed();
    }, { path: `${path}.cooldownSeconds`, min: 0, max: 86400, help: SWITCH_HELP.cooldownSeconds })),
    el('div', { class: 'ns-span-4' }, selectField('Failure Mode', s.failureMode, [
      { value: 'any', label: 'Any' }, { value: 'all', label: 'All' }, { value: 'off', label: 'Off' },
    ], (value) => {
      s.failureMode = value as UiSwitch['failureMode'];
      app.changed();
    }, { path: `${path}.failureMode`, help: SWITCH_HELP.failureMode })),
  ));

  const resetField = numberField('Failure Sensor Reset (seconds)', s.failureSensorResetSeconds, (value) => {
    s.failureSensorResetSeconds = value;
    app.changed();
  }, { path: `${path}.failureSensorResetSeconds`, min: 0, max: 86400, help: SWITCH_HELP.failureSensorReset });
  resetField.hidden = !s.failureSensor;
  body.appendChild(el('div', { class: 'ns-grid' },
    el('div', { class: 'ns-span-6' }, checkboxField('Failure Sensor', s.failureSensor, (value) => {
      s.failureSensor = value;
      resetField.hidden = !value;
      app.changed();
    }, { path: `${path}.failureSensor`, help: SWITCH_HELP.failureSensor })),
    el('div', { class: 'ns-span-6' }, resetField),
  ));

  const coverage = coverageWarnings(app, s, rerenderSwitch);
  const actions = el('div', { class: 'actions mb-2', 'data-path': `${path}.actions` }, el('label', { class: 'form-label' }, 'Actions'));
  s.actions.forEach((a, i) => actions.appendChild(actionCard(app, s, a, index, i, rerenderSwitch, coverage.refresh)));
  if (s.actions.length === 0) {
    actions.appendChild(el('div', { class: 'form-text mb-2' }, 'No actions yet. Add one action per channel you want to use.'));
  }
  actions.appendChild(el('div', { class: 'invalid-feedback' }));
  body.appendChild(actions);
  // Add action: an outlined secondary button directly under the actions list, like Add phone number (SPEC section 11.2, item 11).
  body.appendChild(el('div', { class: 'ns-add-action' }, outlineButton('Add action', () => {
    const first = app.config.providers.find((p) => p.id.trim());
    s.actions.push(newAction(first?.id.trim() ?? '', first ? PROVIDER_CHANNELS[first.type][0] : 'sms'));
    app.changed();
    rerenderSwitch();
  })));
  body.appendChild(coverage.el);

  // Footer: Remove switch (with its in-place confirmation) on the left, Test send on the right; results below the footer.
  const testSend = testSendPanel(app, s, index);
  const remove = inlineConfirm({
    start: dangerLinkButton('Remove switch', () => undefined),
    question: () => REMOVE.question('switch'),
    confirmLabel: REMOVE.confirm,
    confirmClass: 'btn btn-danger btn-sm',
    cancelLabel: REMOVE.cancel,
    cls: 'ns-remove-confirm',
    onConfirm: () => {
      app.config.switches.splice(index, 1);
      app.entryRemoved('switches', index);
      app.rerender('switches');
    },
  });

  card.appendChild(header);
  card.appendChild(body);
  card.appendChild(cardFooter(remove, testSend.control));
  card.appendChild(testSend.results);
  app.watchCard(card, s);
  return card;
}

export function renderSwitches(app: App, container: HTMLElement): void {
  container.appendChild(paragraph(SWITCHES_SECTION));
  const host = el('div');
  app.config.switches.forEach((s, i) => host.appendChild(switchCard(app, s, i, host)));
  if (app.config.switches.length === 0) {
    host.appendChild(el('div', { class: 'form-text mb-2' }, 'No switches yet.'));
  }
  container.appendChild(host);
  container.appendChild(el('div', { class: 'list-feedback', 'data-path': 'switches' }, el('div', { class: 'invalid-feedback' })));
  // Disabled with the "Add a provider first." hint while there is no provider (SPEC section 11.2, item 19).
  container.appendChild(addButton('Add switch', () => {
    const s = newSwitch();
    app.config.switches.push(s);
    app.addFresh(s);
    app.rerender('switches');
  }, app.config.providers.length > 0));
}
