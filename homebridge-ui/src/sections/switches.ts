import type { Channel, NtfyPriority, RecipientResult } from '../../../src/types.js';
import { CHANNELS, SUBJECT_CHANNELS } from '../../../src/types.js';
import { providersForChannel, resolveDefaultProvider } from '../../../src/defaults.js';
import { addressList } from '../addressList.js';
import { callServer } from '../api.js';
import type { App, ValidationListener } from '../app.js';
import { helpToggle, variablesToggle, variableValues } from '../card.js';
import type { VariablesToggle, VariableValue } from '../card.js';
import { CHANNEL_TITLE, DUPLICATE, LEGACY, NTFY_HELP, PROVIDER_TYPE_LABEL, REMOVE, SWITCH_EDITOR, SWITCHES_SECTION, SWITCH_HELP, TEST_SEND } from '../copy.js';
import {
  addButton, cardFooter, checkboxField, clear, dangerLinkButton, disclosure, el, helpText, inlineConfirm, linkButton, numberField, paragraph, selectField,
  statusBox, textField, textareaField,
} from '../dom.js';
import {
  channelRecipients, channelUnserved, duplicateSwitch, enabledChannels, exportConfig, newSwitch, presentChannels, switchProviderId, unservedChannels,
} from '../model.js';
import type { UiProvider, UiSwitch } from '../model.js';
import { smsCounter } from '../sms.js';
import type { UiIssue } from '../validate.js';
import { groupTitle } from './groups.js';
import { providerTitle } from './providers.js';

/** The Tags field holds a comma separated list; the model keeps the tags as an array. */
function parseTags(text: string): string[] {
  return text.split(/[,\s]+/).map((tag) => tag.trim()).filter((tag) => tag.length > 0);
}

function switchTitle(s: UiSwitch): string {
  return s.name.trim() || 'New switch';
}

function providerById(app: App, id: string): UiProvider | undefined {
  return app.config.providers.find((p) => p.id.trim() === id && id);
}

/** How the provider a channel resolves to is named in the preview line and the override dropdown: its name, else its id. */
function providerName(app: App, id: string): string {
  const provider = providerById(app, id);
  return provider ? providerTitle(provider) : id;
}

/** A subject or message field with the Variables toggle on its label row and the variable list under the control, bound to it. */
function withVariables(field: HTMLElement, variables: VariablesToggle): HTMLElement {
  const control = field.querySelector<HTMLInputElement | HTMLTextAreaElement>('.form-control');
  if (control) {
    control.insertAdjacentElement('afterend', variables.box);
    variables.bind(control);
  }
  return field;
}

/** A message textarea for one channel, or the shared one, with the SMS counter under it when it carries SMS. */
function bodyField(
  label: string, value: string, sms: boolean, path: string, values: () => VariableValue[], onChange: (value: string) => void,
): { el: HTMLElement; setSms(sms: boolean): void } {
  const counter = smsCounter();
  const variables = variablesToggle(values);
  const field = textareaField(label, value, (next) => {
    counter.update(next);
    onChange(next);
  }, {
    path, required: true, rows: 3, help: sms ? SWITCH_HELP.bodySms : SWITCH_HELP.bodyOther, labelExtra: variables.extra,
    placeholder: sms ? SWITCH_HELP.bodySmsPlaceholder : SWITCH_HELP.bodyOtherPlaceholder,
  });
  withVariables(field, variables);
  counter.update(value);
  field.querySelector('textarea')?.insertAdjacentElement('afterend', counter.el);
  const help = field.querySelector<HTMLElement>(':scope > .ns-help');
  const textarea = field.querySelector('textarea');
  const setSms = (next: boolean): void => {
    counter.el.hidden = !next;
    if (help) {
      help.textContent = next ? SWITCH_HELP.bodySms : SWITCH_HELP.bodyOther;
    }
    textarea?.setAttribute('placeholder', next ? SWITCH_HELP.bodySmsPlaceholder : SWITCH_HELP.bodyOtherPlaceholder);
  };
  setSms(sms);
  return { el: field, setSms };
}

interface TestSendResult {
  ok: boolean;
  message: string;
  errors?: string[];
  actions?: Array<{ index: number; providerId: string; channel: Channel; results: RecipientResult[] }>;
}

/** Distinct recipients across every enabled channel (SPEC section 11.2, item 11). */
function recipientCount(app: App, s: UiSwitch): number {
  let count = 0;
  for (const channel of enabledChannels(s, app.config)) {
    count += channelRecipients(app.config, s, channel).size;
  }
  return count;
}

/** The paths whose issues block a Test send of this switch: the switch itself and the providers and groups it uses. */
function testSendScope(app: App, s: UiSwitch, index: number): string[] {
  const scope = [`switches[${index}]`];
  for (const channel of enabledChannels(s, app.config)) {
    const id = switchProviderId(s, channel, app.config);
    const p = app.config.providers.findIndex((entry) => entry.id.trim() === id && id);
    if (p >= 0) {
      scope.push(`providers[${p}]`);
    }
  }
  for (const groupId of s.groups) {
    const g = app.config.groups.findIndex((entry) => entry.id.trim() === groupId);
    if (g >= 0) {
      scope.push(`groups[${g}]`);
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
        el('caption', { class: 'small ns-secondary caption-top py-1' }, `${CHANNEL_TITLE[action.channel]} via ${action.providerId}`),
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

/**
 * The switch editor (SPEC section 11.2, item 8): Recipients (groups with per-channel counts, extra addresses
 * by channel), Send by (one checkbox per channel anyone can be reached on), Message (one body, one subject),
 * the live preview line, and Advanced (per-channel messages, provider overrides, BCC, ntfy priority and tags).
 * The stored `actions` array is derived from it on every change (`switchActions` in the model).
 */
function editor(app: App, s: UiSwitch, index: number, rerenderSwitch: () => void): HTMLElement {
  const path = `switches[${index}]`;
  const root = el('div', { class: 'ns-switch-editor' });
  let refresh: () => void = () => undefined;

  // ---- Recipients ------------------------------------------------------------------------------------------
  const groupBox = el('div', { class: 'ns-recipient-groups', 'data-path': `${path}.groups` });
  const groups = app.config.groups.filter((g) => g.id.trim());
  if (groups.length === 0) {
    groupBox.appendChild(el('div', { class: 'form-text' }, SWITCH_EDITOR.noGroups));
  }
  // A channel that becomes present is ticked by the page, not here, so the rule holds whichever card was edited
  // (SPEC section 11.2, item 8): `app.changed()` compares before and after, and `refresh()` then redraws Send by.
  const toggleGroup = (id: string, checked: boolean): void => {
    if (checked) {
      if (!s.groups.includes(id)) {
        s.groups.push(id);
      }
    } else {
      s.groups = s.groups.filter((v) => v !== id);
    }
    app.changed();
    refresh();
  };
  for (const g of groups) {
    const id = g.id.trim();
    const input = el('input', { class: 'form-check-input', type: 'checkbox', id: `${path}.groups.${id}` });
    input.checked = s.groups.includes(id);
    input.addEventListener('change', () => toggleGroup(id, input.checked));
    const counts = CHANNELS.map((channel): [Channel, number] => [channel, g[channel].filter((v) => v.trim()).length]);
    groupBox.appendChild(el('div', { class: 'form-check' }, input,
      el('label', { class: 'form-check-label', for: `${path}.groups.${id}` }, SWITCH_EDITOR.groupCounts(groupTitle(g), counts))));
  }
  for (const missing of s.groups.filter((id) => !groups.some((g) => g.id.trim() === id))) {
    const input = el('input', { class: 'form-check-input', type: 'checkbox', id: `${path}.groups.${missing}` });
    input.checked = true;
    input.addEventListener('change', () => toggleGroup(missing, false));
    groupBox.appendChild(el('div', { class: 'form-check' }, input,
      el('label', { class: 'form-check-label text-danger', for: `${path}.groups.${missing}` }, SWITCH_EDITOR.missingGroup(missing))));
  }
  groupBox.appendChild(el('div', { class: 'invalid-feedback' }));

  // Extra addresses, one list per channel somebody could send on.
  const extras = el('div', { class: 'ns-grid ns-extra-recipients' });
  for (const channel of CHANNELS) {
    if (providersForChannel(app.config.providers, channel).length === 0 && s.recipients[channel].length === 0) {
      continue;
    }
    const list = addressList({
      channel, values: s.recipients[channel], defaultCountry: app.config.defaultCountry, path: `${path}.recipients.${channel}`,
      onChange: () => {
        app.changed();
        refresh();
      },
      onRemove: (i) => app.entryRemoved(`${path}.recipients.${channel}`, i),
      emptyText: SWITCH_EDITOR.extraEmpty,
    });
    extras.appendChild(el('div', { class: 'ns-span-6 ns-extra-channel', 'data-channel': channel },
      el('div', { class: 'small fw-semibold mb-1' }, SWITCH_EDITOR.extraChannelLabel[channel]), list.el));
  }
  root.appendChild(el('div', { class: 'mb-3 ns-recipients' },
    el('label', { class: 'form-label' }, SWITCH_EDITOR.recipientsLabel),
    groupBox,
    helpText(SWITCH_EDITOR.recipientsHelp),
    el('div', { class: 'mt-2' },
      el('div', { class: 'form-label mb-1' }, SWITCH_EDITOR.extraLabel),
      extras,
      helpText(SWITCH_EDITOR.extraHelp),
    ),
  ));

  // ---- Send by ---------------------------------------------------------------------------------------------
  const channelBox = el('div', { class: 'ns-send-by', 'data-path': `${path}.channels` });
  const channelRows = el('div', { class: 'ns-send-by-rows' });
  const sendByEmpty = el('div', { class: 'form-text ns-send-by-empty' }, SWITCH_EDITOR.sendByEmpty);
  const renderChannels = (): void => {
    clear(channelRows);
    const present = presentChannels(app.config, s);
    sendByEmpty.hidden = present.length > 0;
    for (const channel of present) {
      const input = el('input', { class: 'form-check-input', type: 'checkbox', id: `${path}.channels.${channel}` });
      input.checked = s.channels[channel];
      input.addEventListener('change', () => {
        s.channels[channel] = input.checked;
        if (input.checked && s.customize && !s.bodies[channel]) {
          s.bodies[channel] = s.body;
        }
        app.changed();
        refresh();
      });
      const count = channelRecipients(app.config, s, channel).size;
      const row = el('div', { class: 'form-check', 'data-path': `${path}.channels.${channel}`, 'data-channel': channel },
        input,
        el('label', { class: 'form-check-label', for: `${path}.channels.${channel}` }, SWITCH_EDITOR.channelOption(channel, count)));
      if (channelUnserved(app.config, channel)) {
        // A stored action whose channel no provider serves any more (SPEC section 11.2, item 8): shown disabled with the
        // note, which doubles as its validation message, so it is not repeated in a feedback line. The box stays
        // usable so the action can be dropped by unticking it.
        const noteId = `${path}.channels.${channel}.note`;
        row.classList.add('ns-send-by-unserved');
        row.appendChild(el('div', { class: 'form-text ns-send-by-note', id: noteId }, SWITCH_EDITOR.noProviderNote(channel)));
        input.setAttribute('aria-describedby', noteId);
      } else {
        row.appendChild(el('div', { class: 'invalid-feedback' }));
      }
      channelRows.appendChild(row);
    }
  };
  channelBox.appendChild(el('label', { class: 'form-label' }, SWITCH_EDITOR.sendByLabel));
  channelBox.appendChild(channelRows);
  channelBox.appendChild(sendByEmpty);
  channelBox.appendChild(helpText(SWITCH_EDITOR.sendByHelp));
  channelBox.appendChild(el('div', { class: 'invalid-feedback' }));
  root.appendChild(el('div', { class: 'mb-3' }, channelBox));

  // ---- Message ---------------------------------------------------------------------------------------------
  const name = s.name.trim();
  // The Variables lists show what each variable renders right now (SPEC section 11.2, item 17), read when a list opens.
  const values = (): VariableValue[] => variableValues(app.config, s);
  const subjectVariables = variablesToggle(values);
  const subjectField = withVariables(textField(SWITCH_EDITOR.subjectLabel, s.subject, (value) => {
    s.subject = value;
    if (!s.customize) {
      for (const channel of CHANNELS) {
        s.subjects[channel] = value;
      }
    }
    app.changed();
  }, {
    path: `${path}.subject`, placeholder: name ? `Defaults to the switch name: ${name}` : 'Defaults to the switch name',
    help: SWITCH_EDITOR.subjectHelp, labelExtra: subjectVariables.extra,
  }), subjectVariables);
  const sharedBody = bodyField(SWITCH_EDITOR.messageLabel, s.body, s.channels.sms, `${path}.body`, values, (value) => {
    s.body = value;
    if (!s.customize) {
      for (const channel of CHANNELS) {
        s.bodies[channel] = value;
      }
    }
    app.changed();
  });
  const customizedNote = el('div', { class: 'form-text mb-3 ns-customized-note', hidden: true }, SWITCH_EDITOR.customizedNote);
  const preview = el('div', { class: 'ns-send-preview small mb-3', role: 'status', 'aria-live': 'polite' });
  root.appendChild(el('div', { class: 'ns-message' }, sharedBody.el, subjectField, customizedNote, preview));

  // ---- Advanced --------------------------------------------------------------------------------------------
  const perChannel = el('div', { class: 'ns-per-channel' });
  const channelBodies: Partial<Record<Channel, HTMLElement>> = {};
  for (const channel of CHANNELS) {
    const block = el('div', { class: 'ns-channel-message', 'data-channel': channel });
    const subjectLabel = SWITCH_EDITOR.channelSubject[channel];
    if (subjectLabel) {
      const variables = variablesToggle(values);
      block.appendChild(withVariables(textField(subjectLabel, s.subjects[channel], (value) => {
        s.subjects[channel] = value;
        app.changed();
      }, {
        path: `${path}.subjects.${channel}`, placeholder: name ? `Defaults to the switch name: ${name}` : 'Defaults to the switch name',
        help: channel === 'ntfy' ? NTFY_HELP.title : SWITCH_HELP.subject, labelExtra: variables.extra,
      }), variables));
    }
    block.appendChild(bodyField(SWITCH_EDITOR.channelBody[channel], s.bodies[channel], channel === 'sms', `${path}.bodies.${channel}`, values, (value) => {
      s.bodies[channel] = value;
      app.changed();
    }).el);
    channelBodies[channel] = block;
    perChannel.appendChild(block);
  }
  const customize = checkboxField(SWITCH_EDITOR.customize, s.customize, (value) => {
    s.customize = value;
    if (value) {
      // Each channel starts as a copy of the shared message (SPEC section 11.2, item 8).
      for (const channel of CHANNELS) {
        s.bodies[channel] = s.body;
        s.subjects[channel] = s.subject;
      }
      rerenderSwitch();
      return;
    }
    app.changed();
    refresh();
  }, { path: `${path}.customize`, help: SWITCH_EDITOR.customizeHelp });

  const overrides: Partial<Record<Channel, HTMLElement>> = {};
  for (const channel of CHANNELS) {
    const candidates = providersForChannel(app.config.providers, channel);
    const resolved = resolveDefaultProvider(channel, app.config.providers, app.config.defaultProviders);
    const options = [
      { value: '', label: resolved.id ? SWITCH_EDITOR.platformDefault(providerName(app, resolved.id)) : 'Platform default' },
      ...candidates.map((p) => ({ value: p.id.trim(), label: `${providerTitle(p)} (${PROVIDER_TYPE_LABEL[p.type]})` })),
    ];
    if (s.providers[channel] && !candidates.some((p) => p.id.trim() === s.providers[channel])) {
      options.push({ value: s.providers[channel], label: SWITCH_EDITOR.missingProvider(s.providers[channel]) });
    }
    const field = selectField(SWITCH_EDITOR.providerLabel(channel), s.providers[channel], options, (value) => {
      s.providers[channel] = value;
      if (channel === 'sms') {
        s.sender = '';
      }
      app.changed();
      rerenderSwitch();
    }, { path: `${path}.providers.${channel}`, help: SWITCH_EDITOR.providerHelp });
    field.setAttribute('data-channel', channel);
    overrides[channel] = field;
  }

  // SMS sender, only when the resolved Twilio provider offers a choice (SPEC section 5.5, item 3).
  let senderField: HTMLElement | undefined;
  const smsProvider = providerById(app, switchProviderId(s, 'sms', app.config));
  if (smsProvider?.type === 'twilio') {
    const senders = smsProvider.smsSenders.map((v) => v.trim()).filter((v) => v.length > 0);
    const service = smsProvider.messagingServiceSid.trim();
    if (senders.length > 1 || s.sender) {
      const auto = senders.length === 1 ? `Automatic (${senders[0]})` : service ? 'Automatic (Messaging Service)' : 'Automatic';
      const senderOptions = [{ value: '', label: auto }, ...senders.map((v) => ({ value: v, label: v }))];
      if (s.sender && !senders.includes(s.sender)) {
        senderOptions.push({ value: s.sender, label: `${s.sender} (not in provider)` });
      }
      senderField = selectField('Sender', s.sender, senderOptions, (value) => {
        s.sender = value;
        app.changed();
      }, { path: `${path}.sender`, help: SWITCH_HELP.sender });
    }
  }

  const bcc = checkboxField(SWITCH_HELP.bcc, s.bcc, (value) => {
    s.bcc = value;
    app.changed();
  }, { path: `${path}.bcc`, help: SWITCH_HELP.bccHelp });
  const ntfy = el('div', { class: 'ns-grid ns-ntfy-options' },
    el('div', { class: 'ns-span-4' }, selectField(NTFY_HELP.priorityLabel, s.priority, NTFY_HELP.priorityOptions, (value) => {
      s.priority = value as NtfyPriority;
      app.changed();
    }, { path: `${path}.priority`, help: NTFY_HELP.priority })),
    el('div', { class: 'ns-span-8' }, textField(NTFY_HELP.tagsLabel, s.tags.join(', '), (value) => {
      s.tags = parseTags(value);
      app.changed();
    }, { path: `${path}.tags`, placeholder: NTFY_HELP.tagsPlaceholder, help: NTFY_HELP.tags })),
  );
  // An override that names a provider nobody can resolve on a channel no provider serves is the stored action's
  // provider (SPEC section 5.7, item 7); it is kept, not shown, so it does not open Advanced on its own.
  const overrideShown = (channel: Channel): boolean => s.providers[channel] !== '' && !channelUnserved(app.config, channel);
  const advancedOpen = s.customize || CHANNELS.some(overrideShown) || s.sender !== '' || s.bcc || s.priority !== 'default' || s.tags.length > 0;
  const advanced = disclosure(SWITCH_EDITOR.advanced, [
    customize, perChannel, ...CHANNELS.map((channel) => overrides[channel] as HTMLElement), senderField ?? el('span'), bcc, ntfy,
  ], { open: advancedOpen, attrs: { 'data-advanced': path } });
  root.appendChild(advanced);

  // ---- Live state ------------------------------------------------------------------------------------------
  refresh = (): void => {
    renderChannels();
    const enabled = enabledChannels(s, app.config);
    // A ticked channel no provider serves keeps its stored action but takes no part in the preview or in Advanced.
    const unserved = unservedChannels(app.config, s);
    const served = enabled.filter((channel) => !unserved.includes(channel));
    const hasSubject = enabled.some((channel) => SUBJECT_CHANNELS.includes(channel));
    sharedBody.setSms(enabled.includes('sms'));
    sharedBody.el.hidden = s.customize;
    subjectField.hidden = s.customize || !hasSubject;
    customizedNote.hidden = !s.customize;
    perChannel.hidden = !s.customize;
    for (const channel of CHANNELS) {
      const block = channelBodies[channel];
      if (block) {
        block.hidden = !enabled.includes(channel);
      }
      const override = overrides[channel];
      if (override) {
        const candidates = providersForChannel(app.config.providers, channel).length;
        override.hidden = !served.includes(channel) || (candidates < 2 && s.providers[channel] === '');
      }
    }
    if (senderField) {
      senderField.hidden = !served.includes('sms');
    }
    bcc.hidden = !served.includes('email');
    ntfy.hidden = !served.includes('ntfy');
    const parts = served.map((channel) => ({
      channel, provider: providerName(app, switchProviderId(s, channel, app.config)), count: channelRecipients(app.config, s, channel).size,
    })).filter((part) => part.count > 0);
    preview.textContent = parts.length > 0 ? SWITCH_EDITOR.preview(parts) : SWITCH_EDITOR.previewNone;
  };
  refresh();
  return root;
}

function switchCard(app: App, s: UiSwitch, index: number, host: HTMLElement): HTMLElement {
  const path = `switches[${index}]`;
  const card = el('div', { class: 'card mb-3', 'data-path': path });
  const rerenderSwitch = (): void => {
    host.replaceChild(switchCard(app, s, index, host), card);
    app.changed();
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

  body.appendChild(editor(app, s, index, rerenderSwitch));

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

  // Duplicate switch (SPEC section 11.2, item 11): a copy directly below this card, treated like a switch added with Add
  // switch (fresh, so it shows no errors until touched); its Name field takes focus and the card scrolls into view.
  const duplicate = linkButton(DUPLICATE.switch, () => {
    const copy = duplicateSwitch(s, app.config.switches);
    app.config.switches.splice(index + 1, 0, copy);
    app.addFresh(copy);
    app.rerender('switches');
    // The section was redrawn, so the copy's card is looked up in the document, not in this card's (replaced) host.
    const nameInput = document.querySelector<HTMLInputElement>(`[data-path="switches[${index + 1}].name"] input`);
    nameInput?.closest('.card')?.scrollIntoView({ block: 'start', behavior: 'smooth' });
    nameInput?.focus({ preventScroll: true });
  }, 'ns-duplicate');

  card.appendChild(header);
  card.appendChild(body);
  card.appendChild(cardFooter([remove, duplicate], testSend.control));
  card.appendChild(testSend.results);
  app.watchCard(card, s);
  return card;
}

export function renderSwitches(app: App, container: HTMLElement): void {
  container.appendChild(paragraph(SWITCHES_SECTION));
  if (app.legacy) {
    // A configuration the editor cannot represent is not shown at all (SPEC section 11.2, item 26).
    container.appendChild(el('div', { class: 'form-text mb-2 ns-legacy-switches' }, LEGACY.switches(app.legacy.switches)));
    return;
  }
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
