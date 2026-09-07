import type { BotIdentity, ChatSummary, ProviderType, TwilioLookupResult } from '../../../src/types.js';
import { PROVIDER_TYPES } from '../../../src/types.js';
import { BOT_TOKEN_PATTERN } from '../../../src/patterns.js';
import { addressList } from '../addressList.js';
import { callServer } from '../api.js';
import type { App } from '../app.js';
import { compactLinkActions, helpToggle, idField, qrBlock } from '../card.js';
import {
  CHOOSER, CREDENTIALS_FILE_HELP, CREDENTIALS_FILE_LINK, ID_FIELD, PROVIDER_CHOOSER, PROVIDERS_SECTION, SMTP_HELP, TELEGRAM_HELP, TELEGRAM_ONBOARDING,
  TWILIO_HELP, TWILIO_LOOKUP,
} from '../copy.js';
import {
  button, cardFooter, clear, copyButton, dangerLinkButton, disclosure, el, helpText, linkButton, linkOut, numberField, openModal, paragraph,
  passwordField, selectField, statusBox, textField,
} from '../dom.js';
import { createProvider, exportProvider, slugify, uniqueSlug } from '../model.js';
import type { UiProvider } from '../model.js';
import { qrElement } from '../qr.js';
import { groupTitle } from './groups.js';

export function providerTitle(p: UiProvider): string {
  return p.name.trim() || p.id.trim() || 'New provider';
}

interface FindChatsResult {
  ok: boolean;
  message: string;
  chats: ChatSummary[];
}

/** True when a switch action sends through this provider, in which case the id must not follow the name any more. */
function providerReferenced(app: App, id: string): boolean {
  return id.length > 0 && app.config.switches.some((s) => s.actions.some((a) => a.providerId === id));
}

/**
 * The "Advanced" disclosure (SPEC section 11.2, item 14): the ID first, then any extra fields for the
 * type, then the credentials file. Open when something optional in it is set.
 */
function advancedDisclosure(app: App, p: UiProvider, path: string, id: HTMLElement, extra: HTMLElement[], open: boolean): HTMLDetailsElement {
  const credentials = textField('Credentials File', p.credentialsFile, (v) => {
    p.credentialsFile = v;
    app.changed();
  }, {
    path: `${path}.credentialsFile`, monospace: true, placeholder: `notify-switch-${p.type}.json`, help: CREDENTIALS_FILE_HELP, helpLink: CREDENTIALS_FILE_LINK,
  });
  const isOpen = open || p.credentialsFile.trim().length > 0;
  return disclosure('Advanced', [id, ...extra, credentials], { cls: 'mb-3', open: isOpen, attrs: { 'data-advanced': path } });
}

interface LookupPanel {
  el: HTMLElement;
  setEnabled(enabled: boolean): void;
  onNumber?: (phoneNumber: string) => void;
  onService?: (sid: string) => void;
}

/** "Look up numbers" (SPEC section 11.2, item 9): one page of the account's numbers and Messaging Services as dropdowns. */
function twilioLookup(p: UiProvider, path: string): LookupPanel {
  const status = statusBox();
  const selects = el('div', { class: 'ns-lookup-selects mt-2', hidden: true });
  const panel: LookupPanel = { el: el('div', { class: 'ns-lookup mt-2', 'data-lookup': path }), setEnabled: () => undefined };
  const lookupButton = button(TWILIO_LOOKUP.button, async () => {
    clear(selects);
    selects.hidden = true;
    status.set('info', 'Asking Twilio for your numbers…');
    const result = await callServer<TwilioLookupResult>('/twilio-lookup', { provider: exportProvider(p) });
    const numbers = Array.isArray(result.numbers) ? result.numbers : [];
    const services = Array.isArray(result.services) ? result.services : [];
    status.set(result.ok ? (numbers.length + services.length > 0 ? 'success' : 'warning') : 'danger', result.message);
    if (numbers.length > 0) {
      const field = selectField(TWILIO_LOOKUP.numbersLabel, '', [
        { value: '', label: TWILIO_LOOKUP.numbersPlaceholder },
        ...numbers.map((n) => ({
          value: n.phoneNumber, label: n.friendlyName && n.friendlyName !== n.phoneNumber ? `${n.phoneNumber} (${n.friendlyName})` : n.phoneNumber,
        })),
      ], (value) => {
        if (value) {
          panel.onNumber?.(value);
          const select = field.querySelector<HTMLSelectElement>('select');
          if (select) {
            select.value = '';
          }
        }
      });
      field.querySelector('select')?.setAttribute('data-lookup', 'numbers');
      selects.appendChild(field);
    }
    if (services.length > 0) {
      const field = selectField(TWILIO_LOOKUP.servicesLabel, '', [
        { value: '', label: TWILIO_LOOKUP.servicesPlaceholder },
        ...services.map((s) => ({ value: s.sid, label: s.friendlyName ? `${s.friendlyName} (${s.sid})` : s.sid })),
      ], (value) => {
        if (value) {
          panel.onService?.(value);
        }
      });
      field.querySelector('select')?.setAttribute('data-lookup', 'services');
      selects.appendChild(field);
    }
    selects.hidden = selects.childElementCount === 0;
  }, 'btn btn-outline-secondary btn-sm');
  panel.setEnabled = (enabled: boolean): void => {
    lookupButton.disabled = !enabled;
    lookupButton.title = enabled ? '' : 'Enter the Account SID, API Key SID and API Key Secret first.';
  };
  panel.el.appendChild(el('div', { class: 'd-flex flex-wrap align-items-center gap-2' },
    lookupButton, el('span', { class: 'form-text ns-help mt-0' }, TWILIO_LOOKUP.help)));
  panel.el.appendChild(status.el);
  panel.el.appendChild(selects);
  return panel;
}

// ---- Twilio ---------------------------------------------------------------------------------------------

function twilioFields(app: App, p: UiProvider, path: string, body: HTMLElement, id: HTMLElement): void {
  const lookup = twilioLookup(p, path);
  const credentialsReady = (): boolean => p.accountSid.trim().length > 0 && p.apiKeySid.trim().length > 0 && p.apiKeySecret.length > 0;
  const refreshLookup = (): void => lookup.setEnabled(credentialsReady());

  body.appendChild(textField('Account SID', p.accountSid, (v) => {
    p.accountSid = v;
    refreshLookup();
    app.changed();
  }, {
    path: `${path}.accountSid`, required: true, monospace: true, placeholder: 'AC…', help: TWILIO_HELP.accountSid, helpLink: TWILIO_HELP.accountSidLink,
  }));
  body.appendChild(textField('API Key SID', p.apiKeySid, (v) => {
    p.apiKeySid = v;
    refreshLookup();
    app.changed();
  }, { path: `${path}.apiKeySid`, required: true, monospace: true, placeholder: 'SK…', help: TWILIO_HELP.apiKey, helpLink: TWILIO_HELP.apiKeyLink }));
  body.appendChild(passwordField('API Key Secret', p.apiKeySecret, (v) => {
    p.apiKeySecret = v;
    refreshLookup();
    app.changed();
  }, { path: `${path}.apiKeySecret`, required: true, help: TWILIO_HELP.apiKey }));

  const senders = addressList({
    channel: 'sms', values: p.smsSenders, defaultCountry: app.config.defaultCountry, path: `${path}.smsSenders`,
    onChange: () => app.changed(true), addLabel: 'Add sender number',
    emptyText: 'No sender numbers yet. Add one, look them up from your account, or set a Messaging Service SID under Advanced.',
  });
  lookup.onNumber = (phoneNumber) => {
    if (!p.smsSenders.map((v) => v.trim()).includes(phoneNumber)) {
      p.smsSenders.push(phoneNumber);
      senders.refresh();
      app.changed(true);
    }
  };
  body.appendChild(el('div', { class: 'mb-3' },
    el('label', { class: 'form-label' }, 'SMS Senders'),
    senders.el,
    helpText(TWILIO_HELP.smsSenders),
    helpText(TWILIO_HELP.smsSendersNote, TWILIO_HELP.smsSendersNoteLink, 'ns-senders-note'),
    lookup.el,
  ));
  refreshLookup();

  body.appendChild(el('div', { class: 'ns-grid' },
    el('div', { class: 'ns-span-7' }, textField('Email From address', p.emailFrom.address, (v) => {
      p.emailFrom.address = v;
      app.changed(true);
    }, {
      path: `${path}.emailFrom.address`, type: 'email', placeholder: 'alerts@example.com', help: TWILIO_HELP.emailFrom, helpLink: TWILIO_HELP.emailFromLink,
    })),
    el('div', { class: 'ns-span-5' }, textField('Email From name', p.emailFrom.name, (v) => {
      p.emailFrom.name = v;
      app.changed();
    }, { path: `${path}.emailFrom.name`, placeholder: 'Home' })),
  ));

  // Advanced: ID, Messaging Service SID and credentials file (SPEC section 11.2, items 9 and 14).
  const serviceField = textField('Messaging Service SID', p.messagingServiceSid, (v) => {
    p.messagingServiceSid = v;
    app.changed(true);
  }, { path: `${path}.messagingServiceSid`, monospace: true, placeholder: 'MG…', help: TWILIO_HELP.messagingServiceSid });
  const serviceInput = serviceField.querySelector('input') as HTMLInputElement;
  const advanced = advancedDisclosure(app, p, path, id, [serviceField], p.messagingServiceSid.trim().length > 0);
  lookup.onService = (sid) => {
    p.messagingServiceSid = sid;
    serviceInput.value = sid;
    advanced.open = true;
    app.changed(true);
  };
  body.appendChild(advanced);
}

// ---- SMTP -----------------------------------------------------------------------------------------------

/** The Fastmail, Gmail, iCloud and Outlook settings, collapsed under "Common settings" (SPEC section 11.3). */
function commonSettings(): HTMLElement {
  const table = el('table', { class: 'table table-sm mb-0 ns-settings-table' },
    el('thead', {}, el('tr', {}, el('th', {}, 'Provider'), el('th', {}, 'Host'), el('th', {}, 'Port'), el('th', {}, 'Security'))),
    el('tbody', {}, ...SMTP_HELP.commonSettingsRows.map(([name, host, port, security]) => el('tr', {},
      el('td', { 'data-label': 'Provider' }, name), el('td', { class: 'font-monospace', 'data-label': 'Host' }, host),
      el('td', { 'data-label': 'Port' }, port), el('td', { 'data-label': 'Security' }, security)))),
  );
  return disclosure(SMTP_HELP.commonSettings, [table], { cls: 'mb-3 ns-common-settings' });
}

function smtpFields(app: App, p: UiProvider, path: string, body: HTMLElement, id: HTMLElement): void {
  body.appendChild(el('div', { class: 'ns-grid' },
    el('div', { class: 'ns-span-6' }, textField('Host', p.host, (v) => {
      p.host = v;
      app.changed();
    }, { path: `${path}.host`, required: true, placeholder: 'smtp.fastmail.com' })),
    el('div', { class: 'ns-span-3' }, numberField('Port', p.port, (v) => {
      p.port = v;
      app.changed();
    }, { path: `${path}.port`, required: true, min: 1, max: 65535 })),
    el('div', { class: 'ns-span-3' }, selectField('Security', p.security, [
      { value: 'ssl', label: 'SSL' }, { value: 'starttls', label: 'STARTTLS' }, { value: 'none', label: 'None' },
    ], (v) => {
      p.security = v as UiProvider['security'];
      app.changed();
    }, { path: `${path}.security` })),
  ));
  body.appendChild(helpText(SMTP_HELP.server, undefined, 'mb-2 ns-server-help'));
  body.appendChild(commonSettings());
  body.appendChild(textField('Username', p.username, (v) => {
    p.username = v;
    app.changed();
  }, { path: `${path}.username`, required: true, autocomplete: 'off', placeholder: 'you@example.com', help: SMTP_HELP.username }));
  body.appendChild(passwordField('Password', p.password, (v) => {
    p.password = v;
    app.changed();
  }, { path: `${path}.password`, required: true, help: SMTP_HELP.password, helpLink: SMTP_HELP.passwordLink }));
  body.appendChild(el('div', { class: 'ns-grid' },
    el('div', { class: 'ns-span-7' }, textField('From address', p.from.address, (v) => {
      p.from.address = v;
      app.changed();
    }, { path: `${path}.from.address`, required: true, type: 'email', placeholder: 'you@example.com', help: SMTP_HELP.fromAddress })),
    el('div', { class: 'ns-span-5' }, textField('From name', p.from.name, (v) => {
      p.from.name = v;
      app.changed();
    }, { path: `${path}.from.name`, placeholder: 'Home' })),
  ));
  body.appendChild(advancedDisclosure(app, p, path, id, [], false));
}

// ---- Telegram onboarding (SPEC section 11.2, item 10) ---------------------------------------------------

function stepTitle(number: number, title: string): HTMLElement {
  return el('div', { class: 'ns-step-title' }, el('span', { class: 'ns-step-number', 'aria-hidden': 'true' }, String(number)), title);
}

function botLink(username: string, query: string): string {
  return `https://t.me/${username}${query}`;
}

/** The t.me link shown as text under a step's QR code, clickable for people reading on the device that has Telegram. */
function stepLink(url: string): HTMLAnchorElement {
  return el('a', {
    class: 'small font-monospace d-block mb-2 ns-step-link', href: url, target: '_blank', rel: 'noopener noreferrer', 'data-invite-link': url,
  }, url);
}

/** getMe results by token, so re-rendering the section does not ask Telegram again. Lives in memory for the page only. */
const botCache = new Map<string, BotIdentity>();

/** Find people and groups: getUpdates results with an Add button that appends the id to the chosen recipient group. */
function findChatsPanel(app: App, p: UiProvider): HTMLElement {
  const copy = TELEGRAM_ONBOARDING;
  const panel = el('div', { class: 'ns-step find-chats', 'data-step': '4' },
    stepTitle(4, copy.findTitle), helpText(copy.findHelp, undefined, 'mb-2'));
  const groups = app.config.groups.filter((g) => g.id.trim());
  const groupSelect = el('select', { class: 'form-select form-select-sm w-auto', 'aria-label': 'Recipient group to add people to' });
  groupSelect.appendChild(el('option', { value: '' }, 'Choose a recipient group…'));
  for (const g of groups) {
    groupSelect.appendChild(el('option', { value: g.id.trim() }, groupTitle(g)));
  }
  if (groups.length === 1) {
    groupSelect.value = groups[0].id.trim();
  }
  const status = statusBox();
  const results = el('div', { class: 'chat-results' });
  const afterFind = el('div', { class: 'form-text ns-after-find', hidden: true }, copy.afterFind);
  const controls = el('div', { class: 'd-flex flex-wrap align-items-center gap-2 mb-2' });
  controls.appendChild(groupSelect);
  controls.appendChild(button(copy.findTitle, async () => {
    clear(results);
    afterFind.hidden = true;
    status.set('info', 'Asking Telegram for recent updates…');
    const result = await callServer<FindChatsResult>('/find-chats', { provider: exportProvider(p) });
    const chats = Array.isArray(result.chats) ? result.chats : [];
    status.set(result.ok ? (chats.length > 0 ? 'success' : 'warning') : 'danger', result.message);
    for (const chat of chats) {
      const add = button('Add', () => {
        const groupId = groupSelect.value;
        const group = app.config.groups.find((g) => g.id.trim() === groupId && groupId);
        if (!group) {
          status.set('warning', groups.length === 0 ? copy.noGroups : copy.chooseGroup);
          groupSelect.focus();
          return;
        }
        if (!group.telegram.map((v) => v.trim()).includes(chat.id)) {
          group.telegram.push(chat.id);
          app.rerender('groups', true);
        }
        add.textContent = `Added to ${groupTitle(group)}`;
        add.disabled = true;
      }, 'btn btn-outline-success btn-sm');
      results.appendChild(el('div', { class: 'chat-result d-flex align-items-center gap-2', 'data-chat-id': chat.id },
        el('span', { class: 'font-monospace' }, chat.id),
        el('span', { class: 'flex-grow-1' }, chat.title, el('span', { class: 'ns-secondary small ms-1' }, `(${chat.type})`)),
        add,
      ));
    }
    afterFind.hidden = chats.length === 0;
  }, 'btn btn-outline-secondary btn-sm'));
  panel.appendChild(controls);
  panel.appendChild(status.el);
  panel.appendChild(results);
  panel.appendChild(afterFind);
  return panel;
}

function telegramFields(app: App, p: UiProvider, path: string, body: HTMLElement, id: HTMLElement): void {
  const copy = TELEGRAM_ONBOARDING;
  let username: string | undefined;
  const dependants: Array<(username: string | undefined) => void> = [];
  const setUsername = (next: string | undefined): void => {
    username = next;
    for (const update of dependants) {
      update(username);
    }
  };

  // Step 1: create the bot.
  const connection = statusBox();
  let lookupTimer: number | undefined;
  let lookupSeq = 0;
  const lookupBot = (): void => {
    const token = p.botToken.trim();
    if (!BOT_TOKEN_PATTERN.test(token)) {
      connection.set('none', '');
      setUsername(undefined);
      return;
    }
    const seq = (lookupSeq += 1);
    const apply = (result: BotIdentity): void => {
      connection.set(result.ok ? 'success' : 'danger', result.message);
      setUsername(result.ok && typeof result.username === 'string' ? result.username : undefined);
    };
    const cached = botCache.get(token);
    if (cached) {
      apply(cached);
      return;
    }
    connection.set('info', 'Checking the token with Telegram…');
    callServer<BotIdentity>('/telegram-bot', { provider: exportProvider(p) }).then((result) => {
      if (seq !== lookupSeq) {
        return;
      }
      if (result.ok) {
        botCache.set(token, result);
      }
      apply(result);
    }).catch(() => undefined);
  };
  const scheduleLookup = (): void => {
    if (lookupTimer !== undefined) {
      window.clearTimeout(lookupTimer);
    }
    lookupTimer = window.setTimeout(() => {
      lookupTimer = undefined;
      lookupBot();
    }, 500);
  };

  const step1 = el('div', { class: 'ns-step', 'data-step': '1' },
    stepTitle(1, copy.step1Title),
    el('div', { class: 'ns-step-row' },
      el('div', { class: 'ns-step-text' },
        el('p', { class: 'mb-2 ns-step-intro' }, copy.step1Intro),
        el('div', { class: 'mb-2' }, linkOut(copy.openBotFather, copy.botFatherUrl)),
        el('ol', {}, ...copy.step1Instructions.map((line) => el('li', {}, line))),
      ),
      qrBlock(copy.botFatherUrl, 'QR code for BotFather', copy.botFatherCaption),
    ),
    passwordField('Bot Token', p.botToken, (v) => {
      p.botToken = v;
      app.changed();
      scheduleLookup();
    }, { path: `${path}.botToken`, required: true, help: TELEGRAM_HELP.botToken, helpLink: TELEGRAM_HELP.botTokenLink }),
    connection.el,
  );
  body.appendChild(step1);

  // Step 2: group chat or individual chats. The choice decides what step 3 shows.
  let mode: 'group' | 'individual' = 'group';
  const modeCards = el('div', { class: 'ns-mode-cards', role: 'radiogroup', 'aria-label': copy.step2Title });
  const step3 = el('div', { class: 'ns-step', 'data-step': '3' });
  const renderStep3 = (): void => {
    clear(step3);
    const name = username;
    if (mode === 'group') {
      step3.setAttribute('data-mode', 'group');
      step3.appendChild(stepTitle(3, copy.step3GroupTitle));
      if (!name) {
        step3.appendChild(el('div', { class: 'form-text' }, copy.connectFirst));
        return;
      }
      const url = botLink(name, '?startgroup=true');
      step3.appendChild(el('div', { class: 'ns-step-row' },
        qrBlock(url, 'QR code to add the bot to a group', copy.groupCaption),
        el('div', { class: 'ns-step-text' },
          stepLink(url),
          el('div', { class: 'ns-invite-actions ns-qr-only' }, linkOut(copy.addToGroup, url), copyButton(copy.copyLink, () => url)),
          compactLinkActions(url, copy.groupSentence),
          el('p', { class: 'mt-2 mb-0' }, copy.groupSentence),
        ),
      ));
      return;
    }
    step3.setAttribute('data-mode', 'individual');
    step3.appendChild(stepTitle(3, copy.step3Title));
    if (!name) {
      step3.appendChild(el('div', { class: 'form-text' }, copy.connectFirst));
      return;
    }
    const url = botLink(name, '?start=join');
    const enlarge = button(copy.enlarge, () => {
      openModal({
        title: copy.step3Title,
        body: el('div', {}, qrElement(url, 'QR code to invite people', true), el('div', { class: 'text-center small mt-2 font-monospace' }, url)),
        wide: true,
      });
    }, 'btn btn-outline-secondary btn-sm ns-enlarge');
    const compact = compactLinkActions(url, copy.inviteMessage(name));
    compact.appendChild(copyButton(copy.copyInvite, () => copy.inviteMessage(name)));
    step3.appendChild(el('div', { class: 'ns-step-row' },
      qrBlock(url, 'QR code to invite people', copy.inviteCaption),
      el('div', { class: 'ns-step-text' },
        stepLink(url),
        el('div', { class: 'ns-invite-actions ns-qr-only' },
          enlarge,
          copyButton(copy.copyLink, () => url),
          copyButton(copy.copyInvite, () => copy.inviteMessage(name)),
        ),
        compact,
      ),
    ));
  };
  const makeCard = (key: 'group' | 'individual', title: string, text: string): HTMLElement => {
    const radio = el('input', { class: 'form-check-input', type: 'radio', name: `${path}.telegram-mode`, id: `${path}.telegram-mode.${key}` });
    const card = el('div', { class: 'ns-mode-card', role: 'radio', 'data-mode': key, tabindex: '0' },
      el('label', { class: 'fw-semibold d-block', for: `${path}.telegram-mode.${key}` }, radio, title),
      el('div', { class: 'small' }, text),
    );
    const select = (): void => {
      mode = key;
      for (const node of modeCards.querySelectorAll<HTMLElement>('.ns-mode-card')) {
        const active = node.getAttribute('data-mode') === mode;
        node.setAttribute('aria-checked', active ? 'true' : 'false');
        const input = node.querySelector<HTMLInputElement>('input[type="radio"]');
        if (input) {
          input.checked = active;
        }
      }
      renderStep3();
    };
    card.addEventListener('click', select);
    card.addEventListener('keydown', (event) => {
      if (event.key === ' ' || event.key === 'Enter') {
        event.preventDefault();
        select();
      }
    });
    return card;
  };
  modeCards.appendChild(makeCard('group', copy.groupTitle, copy.groupText));
  modeCards.appendChild(makeCard('individual', copy.individualTitle, copy.individualText));
  body.appendChild(el('div', { class: 'ns-step', 'data-step': '2' }, stepTitle(2, copy.step2Title), modeCards));
  dependants.push(() => renderStep3());
  body.appendChild(step3);
  // Preselect the recommended option; this also draws step 3 for the first time.
  modeCards.querySelector<HTMLElement>('[data-mode="group"]')?.click();

  // Find people and groups (SPEC section 11.2, item 5).
  body.appendChild(findChatsPanel(app, p));

  // Advanced: ID, Parse Mode (plain text by default) and credentials file.
  const parseMode = selectField('Parse Mode', p.parseMode, [
    { value: 'none', label: 'None (plain text)' }, { value: 'markdown', label: 'Markdown' }, { value: 'html', label: 'HTML' },
  ], (v) => {
    p.parseMode = v as UiProvider['parseMode'];
    app.changed();
  }, { path: `${path}.parseMode`, help: TELEGRAM_HELP.parseMode });
  body.appendChild(advancedDisclosure(app, p, path, id, [parseMode], p.parseMode !== 'none'));

  setUsername(undefined);
  if (BOT_TOKEN_PATTERN.test(p.botToken.trim())) {
    lookupBot();
  }
}

// ---- Shared ---------------------------------------------------------------------------------------------

function providerCard(app: App, p: UiProvider, index: number): HTMLElement {
  const path = `providers[${index}]`;
  const others = (): string[] => app.config.providers.filter((other) => other !== p).map((other) => other.id);
  const card = el('div', { class: 'card mb-3', 'data-path': path, 'data-type': p.type });
  const title = el('span', { class: 'fw-semibold' }, providerTitle(p));
  const badge = el('span', { class: 'badge text-bg-secondary ms-2' }, p.type);
  const header = el('div', { class: 'card-header d-flex justify-content-between align-items-center gap-2' },
    el('span', {}, title, badge), helpToggle(card, p));

  const body = el('div', { class: 'card-body' });
  // The id is generated from the name (SPEC section 11.2, item 14) and keeps following it until it is
  // edited by hand under Advanced or a switch refers to it, so renaming never breaks a switch.
  let idFollowsName = !providerReferenced(app, p.id.trim()) && (slugify(p.name) === '' || p.id.trim() === uniqueSlug(p.name, others(), p.type));
  const id = idField({
    path: `${path}.id`, value: p.id, help: ID_FIELD.providerHelp, onChange: (value) => {
      p.id = value;
      idFollowsName = false;
      app.changed(true);
    },
  });
  const idInput = id.querySelector('input') as HTMLInputElement;

  body.appendChild(textField('Name', p.name, (value) => {
    p.name = value;
    title.textContent = providerTitle(p);
    if (idFollowsName) {
      p.id = uniqueSlug(value, others(), p.type);
      idInput.value = p.id;
    }
    app.changed(true);
  }, { path: `${path}.name`, required: true, placeholder: PROVIDER_CHOOSER[p.type].name }));

  switch (p.type) {
  case 'twilio':
    twilioFields(app, p, path, body, id);
    break;
  case 'smtp':
    smtpFields(app, p, path, body, id);
    break;
  case 'telegram':
    telegramFields(app, p, path, body, id);
    break;
  }

  // Footer (SPEC section 11.2, item 11): Remove provider on the left, Test connection on the right; the result below.
  const status = statusBox();
  const results = el('div', { class: 'ns-card-results' });
  const test = button('Test connection', async () => {
    clear(results);
    status.set('info', 'Testing…');
    results.appendChild(status.el);
    const result = await callServer<{ ok: boolean; message: string }>('/test-provider', { provider: exportProvider(p) });
    status.set(result.ok ? 'success' : 'danger', result.message);
  }, 'btn btn-outline-primary btn-sm');
  const remove = dangerLinkButton('Remove provider', () => {
    app.config.providers.splice(index, 1);
    app.rerender('providers', true);
  });

  card.appendChild(header);
  card.appendChild(body);
  card.appendChild(cardFooter(remove, test));
  card.appendChild(results);
  app.watchCard(card, p);
  return card;
}

/**
 * The provider chooser (SPEC section 11.2, item 13): Add provider is replaced by three tiles; picking one
 * creates the card with its type fixed, the name prefilled and the id generated from the name.
 */
function addProviderControl(app: App): HTMLElement {
  const slot = el('div', { class: 'ns-add-provider' });
  let showChooser: () => void = () => undefined;
  const showButton = (): void => {
    clear(slot);
    slot.appendChild(button(CHOOSER.add, () => showChooser(), 'btn btn-primary btn-sm'));
  };
  showChooser = (): void => {
    clear(slot);
    const tiles = PROVIDER_TYPES.map((type) => {
      const tile = el('button', { type: 'button', class: 'ns-chooser-tile', 'data-type': type },
        el('span', { class: 'fw-semibold d-block' }, PROVIDER_CHOOSER[type].title),
        el('span', { class: 'ns-secondary small d-block' }, PROVIDER_CHOOSER[type].help),
      );
      tile.addEventListener('click', () => {
        const p = createProvider(type as ProviderType, PROVIDER_CHOOSER[type].name, app.config.providers);
        app.config.providers.push(p);
        app.addFresh(p);
        app.rerender('providers', true);
      });
      return tile;
    });
    slot.appendChild(el('div', { class: 'ns-chooser', role: 'group', 'aria-label': CHOOSER.prompt },
      el('div', { class: 'fw-semibold mb-2' }, CHOOSER.prompt),
      el('div', { class: 'ns-chooser-tiles' }, ...tiles),
      el('div', { class: 'mt-2' }, linkButton(CHOOSER.cancel, showButton)),
    ));
    tiles[0]?.focus();
  };
  showButton();
  return slot;
}

export function renderProviders(app: App, container: HTMLElement): void {
  container.appendChild(paragraph(PROVIDERS_SECTION));
  app.config.providers.forEach((p, i) => container.appendChild(providerCard(app, p, i)));
  if (app.config.providers.length === 0) {
    container.appendChild(el('div', { class: 'form-text mb-2' }, 'No providers yet. Add one to get started.'));
  }
  container.appendChild(el('div', { class: 'list-feedback', 'data-path': 'providers' }, el('div', { class: 'invalid-feedback' })));
  container.appendChild(addProviderControl(app));
}
