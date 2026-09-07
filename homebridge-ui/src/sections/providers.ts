import type { BotIdentity, ChatSummary, ProviderType, TwilioLookupResult } from '../../../src/types.js';
import { CREDENTIAL_KEYS } from '../../../src/types.js';
import { BOT_TOKEN_PATTERN } from '../../../src/patterns.js';
import { addressList } from '../addressList.js';
import { callServer } from '../api.js';
import type { App } from '../app.js';
import { PROVIDERS_SECTION, SMTP_HELP, TELEGRAM_HELP, TELEGRAM_ONBOARDING, TWILIO_HELP, TWILIO_LOOKUP } from '../copy.js';
import {
  button, cardFooter, clear, copyButton, dangerLinkButton, el, numberField, openModal, paragraph, passwordField, selectField, statusBox, textField,
} from '../dom.js';
import { exportProvider, newProvider, slugify } from '../model.js';
import type { UiProvider } from '../model.js';
import { qrElement } from '../qr.js';
import { groupTitle } from './groups.js';

const TYPE_LABELS: Record<ProviderType, string> = { twilio: 'Twilio (SMS and email)', smtp: 'SMTP (email)', telegram: 'Telegram' };

export function providerTitle(p: UiProvider): string {
  return p.name.trim() || p.id.trim() || 'New provider';
}

function credentialsNote(type: ProviderType): string {
  return 'Optional. Path, relative to the Homebridge storage directory, of a JSON file whose keys override this provider\'s secret fields '
    + `(${CREDENTIAL_KEYS[type].join(', ')}). Keeps secrets out of config.json and backups. Read once when Homebridge starts.`;
}

/** An outlined link that opens in a new tab, styled as a button. */
function linkOut(label: string, href: string, cls = 'btn btn-outline-primary btn-sm'): HTMLAnchorElement {
  return el('a', { class: cls, href, target: '_blank', rel: 'noopener noreferrer', role: 'button' }, label);
}

interface FindChatsResult {
  ok: boolean;
  message: string;
  chats: ChatSummary[];
}

/** The "Advanced" disclosure: any extra fields for the type first, then the credentials file. Open when something in it is set. */
function advancedDisclosure(app: App, p: UiProvider, path: string, extra: HTMLElement[], open: boolean): HTMLDetailsElement {
  const details = el('details', { class: 'mb-3 ns-advanced' },
    el('summary', { class: 'text-muted small' }, 'Advanced'),
    el('div', { class: 'mt-2' }, ...extra, textField('Credentials File', p.credentialsFile, (v) => {
      p.credentialsFile = v;
      app.changed();
    }, { path: `${path}.credentialsFile`, monospace: true, placeholder: 'notify-switch-twilio.json', help: credentialsNote(p.type) })),
  );
  if (open || p.credentialsFile.trim()) {
    details.open = true;
  }
  return details;
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
    lookupButton, el('span', { class: 'form-text mt-0' }, TWILIO_LOOKUP.help)));
  panel.el.appendChild(status.el);
  panel.el.appendChild(selects);
  return panel;
}

// ---- Twilio ---------------------------------------------------------------------------------------------

function twilioFields(app: App, p: UiProvider, path: string, body: HTMLElement): void {
  const lookup = twilioLookup(p, path);
  const credentialsReady = (): boolean => p.accountSid.trim().length > 0 && p.apiKeySid.trim().length > 0 && p.apiKeySecret.length > 0;
  const refreshLookup = (): void => lookup.setEnabled(credentialsReady());

  body.appendChild(textField('Account SID', p.accountSid, (v) => {
    p.accountSid = v;
    refreshLookup();
    app.changed();
  }, { path: `${path}.accountSid`, required: true, monospace: true, placeholder: 'AC…', help: TWILIO_HELP.accountSid }));
  body.appendChild(textField('API Key SID', p.apiKeySid, (v) => {
    p.apiKeySid = v;
    refreshLookup();
    app.changed();
  }, { path: `${path}.apiKeySid`, required: true, monospace: true, placeholder: 'SK…', help: TWILIO_HELP.apiKey }));
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
    el('div', { class: 'form-text' }, TWILIO_HELP.smsSenders),
    lookup.el,
  ));
  refreshLookup();

  body.appendChild(el('div', { class: 'ns-grid' },
    el('div', { class: 'ns-span-7' }, textField('Email From address', p.emailFrom.address, (v) => {
      p.emailFrom.address = v;
      app.changed(true);
    }, { path: `${path}.emailFrom.address`, type: 'email', placeholder: 'alerts@example.com', help: TWILIO_HELP.emailFrom })),
    el('div', { class: 'ns-span-5' }, textField('Email From name', p.emailFrom.name, (v) => {
      p.emailFrom.name = v;
      app.changed();
    }, { path: `${path}.emailFrom.name`, placeholder: 'Home' })),
  ));

  // Advanced: Messaging Service SID and credentials file (SPEC section 11.2, item 9).
  const serviceField = textField('Messaging Service SID', p.messagingServiceSid, (v) => {
    p.messagingServiceSid = v;
    app.changed(true);
  }, { path: `${path}.messagingServiceSid`, monospace: true, placeholder: 'MG…', help: TWILIO_HELP.messagingServiceSid });
  const serviceInput = serviceField.querySelector('input') as HTMLInputElement;
  const advanced = advancedDisclosure(app, p, path, [serviceField], p.messagingServiceSid.trim().length > 0);
  lookup.onService = (sid) => {
    p.messagingServiceSid = sid;
    serviceInput.value = sid;
    advanced.open = true;
    app.changed(true);
  };
  body.appendChild(advanced);
}

// ---- SMTP -----------------------------------------------------------------------------------------------

function smtpFields(app: App, p: UiProvider, path: string, body: HTMLElement): void {
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
  body.appendChild(el('div', { class: 'form-text mb-3' }, SMTP_HELP.server));
  body.appendChild(textField('Username', p.username, (v) => {
    p.username = v;
    app.changed();
  }, { path: `${path}.username`, required: true, autocomplete: 'off', placeholder: 'you@example.com', help: SMTP_HELP.username }));
  body.appendChild(passwordField('Password', p.password, (v) => {
    p.password = v;
    app.changed();
  }, { path: `${path}.password`, required: true, help: SMTP_HELP.password }));
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
  body.appendChild(advancedDisclosure(app, p, path, [], false));
}

// ---- Telegram onboarding (SPEC section 11.2, item 10) ---------------------------------------------------

function stepTitle(number: number, title: string): HTMLElement {
  return el('div', { class: 'ns-step-title' }, el('span', { class: 'ns-step-number', 'aria-hidden': 'true' }, String(number)), title);
}

function botLink(username: string, query: string): string {
  return `https://t.me/${username}${query}`;
}

/** getMe results by token, so re-rendering the section does not ask Telegram again. Lives in memory for the page only. */
const botCache = new Map<string, BotIdentity>();

/** Find people and groups: getUpdates results with an Add button that appends the id to the chosen recipient group. */
function findChatsPanel(app: App, p: UiProvider): HTMLElement {
  const copy = TELEGRAM_ONBOARDING;
  const panel = el('div', { class: 'ns-step find-chats', 'data-step': '4' },
    stepTitle(4, copy.findTitle), el('div', { class: 'form-text mb-2' }, copy.findHelp));
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
  const controls = el('div', { class: 'd-flex flex-wrap align-items-center gap-2 mb-2' });
  controls.appendChild(groupSelect);
  controls.appendChild(button(copy.findTitle, async () => {
    clear(results);
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
        el('span', { class: 'flex-grow-1' }, chat.title, el('span', { class: 'text-muted small ms-1' }, `(${chat.type})`)),
        add,
      ));
    }
  }, 'btn btn-outline-secondary btn-sm'));
  panel.appendChild(controls);
  panel.appendChild(status.el);
  panel.appendChild(results);
  return panel;
}

function telegramFields(app: App, p: UiProvider, path: string, body: HTMLElement): void {
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
        el('div', { class: 'mb-2' }, linkOut(copy.openBotFather, copy.botFatherUrl)),
        el('ol', {}, ...copy.step1Instructions.map((line) => el('li', {}, line))),
      ),
      qrElement(copy.botFatherUrl, 'QR code for BotFather'),
    ),
    passwordField('Bot Token', p.botToken, (v) => {
      p.botToken = v;
      app.changed();
      scheduleLookup();
    }, { path: `${path}.botToken`, required: true, help: TELEGRAM_HELP.botToken }),
    connection.el,
  );
  body.appendChild(step1);

  // Step 2: group chat or individual chats.
  let mode: 'group' | 'individual' = 'group';
  const modeCards = el('div', { class: 'ns-mode-cards', role: 'radiogroup', 'aria-label': copy.step2Title });
  const groupLinks = el('div', { class: 'ns-step-row mt-2' });
  const makeCard = (key: 'group' | 'individual', title: string, text: string, extra: HTMLElement | null): HTMLElement => {
    const radio = el('input', { class: 'form-check-input', type: 'radio', name: `${path}.telegram-mode`, id: `${path}.telegram-mode.${key}` });
    const card = el('div', { class: 'ns-mode-card', role: 'radio', 'data-mode': key, tabindex: '0' },
      el('label', { class: 'fw-semibold d-block', for: `${path}.telegram-mode.${key}` }, radio, title),
      el('div', { class: 'small' }, text),
      extra,
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
  modeCards.appendChild(makeCard('group', copy.groupTitle, copy.groupText, groupLinks));
  modeCards.appendChild(makeCard('individual', copy.individualTitle, copy.individualText, null));
  dependants.push((name) => {
    clear(groupLinks);
    if (!name) {
      groupLinks.appendChild(el('div', { class: 'form-text' }, copy.connectFirst));
      return;
    }
    const url = botLink(name, '?startgroup=true');
    groupLinks.appendChild(el('div', { class: 'ns-step-text' }, linkOut(copy.addToGroup, url)));
    groupLinks.appendChild(qrElement(url, 'QR code to add the bot to a group'));
  });
  body.appendChild(el('div', { class: 'ns-step', 'data-step': '2' }, stepTitle(2, copy.step2Title), modeCards));
  // Preselect the recommended option.
  modeCards.querySelector<HTMLElement>('[data-mode="group"]')?.click();

  // Step 3: invite people.
  const invite = el('div', { class: 'ns-step-row' });
  dependants.push((name) => {
    clear(invite);
    if (!name) {
      invite.appendChild(el('div', { class: 'form-text' }, copy.connectFirst));
      return;
    }
    const url = botLink(name, '?start=join');
    const enlarge = button(copy.enlarge, () => {
      openModal({
        title: copy.step3Title,
        body: el('div', {}, qrElement(url, 'QR code to invite people', true), el('div', { class: 'text-center small mt-2 font-monospace' }, url)),
        wide: true,
      });
    }, 'btn btn-outline-secondary btn-sm');
    invite.appendChild(qrElement(url, 'QR code to invite people'));
    invite.appendChild(el('div', { class: 'ns-step-text' },
      el('div', { class: 'small font-monospace mb-2', 'data-invite-link': url }, url),
      el('div', { class: 'ns-invite-actions' },
        enlarge,
        copyButton(copy.copyLink, () => url),
        copyButton(copy.copyInvite, () => copy.inviteMessage(name)),
      ),
    ));
  });
  body.appendChild(el('div', { class: 'ns-step', 'data-step': '3' }, stepTitle(3, copy.step3Title), invite));

  // Find people and groups (SPEC section 11.2, item 5).
  body.appendChild(findChatsPanel(app, p));

  body.appendChild(selectField('Parse Mode', p.parseMode, [
    { value: 'none', label: 'None (plain text)' }, { value: 'markdown', label: 'Markdown' }, { value: 'html', label: 'HTML' },
  ], (v) => {
    p.parseMode = v as UiProvider['parseMode'];
    app.changed();
  }, { path: `${path}.parseMode`, help: 'How Telegram should interpret the message body. Plain text is the safest choice.' }));
  body.appendChild(advancedDisclosure(app, p, path, [], false));

  setUsername(undefined);
  if (BOT_TOKEN_PATTERN.test(p.botToken.trim())) {
    lookupBot();
  }
}

// ---- Shared ---------------------------------------------------------------------------------------------

function providerCard(app: App, p: UiProvider, index: number): HTMLElement {
  const path = `providers[${index}]`;
  const header = el('div', { class: 'card-header d-flex justify-content-between align-items-center' });
  const title = el('span', { class: 'fw-semibold' }, providerTitle(p));
  const badge = el('span', { class: 'badge text-bg-secondary ms-2' }, p.type);
  header.appendChild(el('span', {}, title, badge));

  const body = el('div', { class: 'card-body' });
  let idTouched = p.id.trim().length > 0 && p.id !== slugify(p.name);

  const idField = textField('ID', p.id, (value) => {
    p.id = value;
    idTouched = true;
    app.changed(true);
  }, {
    path: `${path}.id`, required: true, monospace: true, placeholder: 'twilio-main',
    help: 'Short unique identifier switches use to reference this provider. Lowercase letters, numbers, dashes, and underscores.',
  });
  const idInput = idField.querySelector('input') as HTMLInputElement;

  body.appendChild(textField('Name', p.name, (value) => {
    p.name = value;
    title.textContent = providerTitle(p);
    if (!idTouched) {
      p.id = slugify(value);
      idInput.value = p.id;
    }
    app.changed(true);
  }, { path: `${path}.name`, required: true, placeholder: 'Twilio', help: 'Display name for this provider.' }));
  body.appendChild(idField);

  body.appendChild(selectField('Type', p.type, (Object.keys(TYPE_LABELS) as ProviderType[]).map((t) => ({ value: t, label: TYPE_LABELS[t] })), (value) => {
    // Switching type keeps the identity and drops the other type's fields.
    const fresh = newProvider(value as ProviderType);
    fresh.id = p.id;
    fresh.name = p.name;
    fresh.credentialsFile = p.credentialsFile;
    app.config.providers[index] = fresh;
    app.rerender('providers', true);
  }, { path: `${path}.type`, help: 'The messaging service this provider connects to.' }));

  switch (p.type) {
  case 'twilio':
    twilioFields(app, p, path, body);
    break;
  case 'smtp':
    smtpFields(app, p, path, body);
    break;
  case 'telegram':
    telegramFields(app, p, path, body);
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

  return el('div', { class: 'card mb-3', 'data-path': path }, header, body, cardFooter(remove, test), results);
}

export function renderProviders(app: App, container: HTMLElement): void {
  container.appendChild(paragraph(PROVIDERS_SECTION));
  app.config.providers.forEach((p, i) => container.appendChild(providerCard(app, p, i)));
  if (app.config.providers.length === 0) {
    container.appendChild(el('div', { class: 'form-text mb-2' }, 'No providers yet. Add one to get started.'));
  }
  container.appendChild(el('div', { class: 'list-feedback', 'data-path': 'providers' }, el('div', { class: 'invalid-feedback' })));
  container.appendChild(button('Add provider', () => {
    app.config.providers.push(newProvider());
    app.rerender('providers', true);
  }, 'btn btn-primary btn-sm'));
}
