import type { BotIdentity, ChatSummary, NtfyAuth, ProviderType, TwilioLookupResult } from '../../../src/types.js';
import { PROVIDER_TYPES } from '../../../src/types.js';
import { BOT_TOKEN_PATTERN } from '../../../src/patterns.js';
import { addressList } from '../addressList.js';
import { callServer } from '../api.js';
import type { App } from '../app.js';
import { compactLinkActions, helpToggle, idField, qrBlock } from '../card.js';
import {
  CHOOSER, CREDENTIALS_FILE_HELP, CREDENTIALS_FILE_LINK, GET_STARTED, ID_FIELD, NTFY_HELP, PROVIDER_CHOOSER, PROVIDER_NAME_HELP,
  PROVIDER_TYPE_LABEL, PROVIDERS_SECTION, REMOVE, SMTP_HELP, TELEGRAM_HELP, TELEGRAM_ONBOARDING, TWILIO_HELP, TWILIO_LOOKUP,
} from '../copy.js';
import {
  button, cardFooter, clear, copyButton, dangerLinkButton, disclosure, el, helpLink, helpText, inlineConfirm, linkButton, linkOut, numberField,
  openModal, outlineButton, paragraph, passwordField, selectField, setHelp, statusBox, textField, uniqueId,
} from '../dom.js';
import { createProvider, exportProvider, slugify, uniqueSlug } from '../model.js';
import type { UiProvider } from '../model.js';
import { qrElement } from '../qr.js';
import { OTHER_PRESET_KEY, OTHER_PRESET_LABEL, SMTP_PRESETS, smtpPreset } from '../smtpPresets.js';
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
    path: `${path}.credentialsFile`, monospace: true, placeholder: `e.g. notify-switch-${p.type}.json`, help: CREDENTIALS_FILE_HELP,
    helpLink: CREDENTIALS_FILE_LINK,
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
    onChange: () => app.changed(true), onRemove: (i) => app.entryRemoved(`${path}.smsSenders`, i), addLabel: 'Add sender number',
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
      path: `${path}.emailFrom.address`, type: 'email', placeholder: 'e.g. alerts@example.com', help: TWILIO_HELP.emailFrom,
      helpLink: TWILIO_HELP.emailFromLink,
    })),
    el('div', { class: 'ns-span-5' }, textField('Email From name', p.emailFrom.name, (v) => {
      p.emailFrom.name = v;
      app.changed();
    }, { path: `${path}.emailFrom.name`, placeholder: 'e.g. Home' })),
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

interface ServerFields {
  host: HTMLInputElement;
  port: HTMLInputElement;
  security: HTMLSelectElement;
  /** Locks or unlocks the three server controls; the Edit link shows while they are locked. */
  setLocked(locked: boolean): void;
}

/**
 * The "Mail provider" selector at the top of the SMTP card (SPEC section 11.2, item 22): a segmented
 * control on wide screens and a dropdown below 600px, both bound to the same value. Choosing a preset
 * fills and locks host, port and security; Other leaves them editable. Text labels only.
 */
function presetPicker(p: UiProvider, path: string, onChoose: (key: string) => void): HTMLElement {
  const current = (): string => smtpPreset(p.smtpPreset)?.key ?? OTHER_PRESET_KEY;
  const options = [...SMTP_PRESETS.map((preset) => ({ key: preset.key, label: preset.label })), { key: OTHER_PRESET_KEY, label: OTHER_PRESET_LABEL }];
  const group = uniqueId('preset');
  const segments = el('div', { class: 'btn-group ns-preset-segments', role: 'group', 'aria-label': SMTP_HELP.presetLabel, 'data-preset-segments': path });
  const select = el('select', { class: 'form-select ns-preset-select', 'aria-label': SMTP_HELP.presetLabel, 'data-preset-select': path });
  const radios: HTMLInputElement[] = [];
  const sync = (): void => {
    const key = current();
    for (const radio of radios) {
      radio.checked = radio.value === key;
    }
    select.value = key;
  };
  for (const option of options) {
    const id = `${group}-${option.key}`;
    const radio = el('input', { type: 'radio', class: 'btn-check', name: group, id, value: option.key, autocomplete: 'off' });
    radio.addEventListener('change', () => {
      if (radio.checked) {
        onChoose(option.key);
        sync();
      }
    });
    radios.push(radio);
    segments.appendChild(radio);
    segments.appendChild(el('label', { class: 'btn btn-outline-secondary btn-sm', for: id }, option.label));
    select.appendChild(el('option', { value: option.key }, option.label));
  }
  select.addEventListener('change', () => {
    onChoose(select.value);
    sync();
  });
  sync();
  return el('div', { class: 'mb-3 ns-preset-picker' },
    el('label', { class: 'form-label' }, SMTP_HELP.presetLabel),
    segments,
    select,
    helpText(SMTP_HELP.preset),
  );
}

function smtpFields(app: App, p: UiProvider, path: string, body: HTMLElement, id: HTMLElement): void {
  // Server settings, locked while a preset is chosen; Edit on the Host label row unlocks them.
  let unlock: () => void = () => undefined;
  const edit = linkButton(SMTP_HELP.edit, () => unlock(), 'ns-server-edit');
  edit.setAttribute('aria-label', `${SMTP_HELP.edit} server settings`);
  const hostField = textField('Host', p.host, (v) => {
    p.host = v;
    app.changed();
  }, { path: `${path}.host`, required: true, placeholder: 'e.g. smtp.fastmail.com', labelExtra: edit });
  const portField = numberField('Port', p.port, (v) => {
    p.port = v;
    app.changed();
  }, { path: `${path}.port`, required: true, min: 1, max: 65535 });
  const securityField = selectField('Security', p.security, [
    { value: 'ssl', label: 'SSL' }, { value: 'starttls', label: 'STARTTLS' }, { value: 'none', label: 'None' },
  ], (v) => {
    p.security = v as UiProvider['security'];
    app.changed();
  }, { path: `${path}.security` });
  const serverHelp = helpText(SMTP_HELP.server, undefined, 'mb-2 ns-server-help');
  const server: ServerFields = {
    host: hostField.querySelector('input') as HTMLInputElement,
    port: portField.querySelector('input') as HTMLInputElement,
    security: securityField.querySelector('select') as HTMLSelectElement,
    setLocked: (locked) => {
      server.host.readOnly = locked;
      server.port.readOnly = locked;
      server.security.disabled = locked;
      edit.hidden = !locked;
      serverHelp.textContent = locked ? SMTP_HELP.serverLocked : SMTP_HELP.server;
      body.classList.toggle('ns-server-locked', locked);
    },
  };
  unlock = (): void => server.setLocked(false);

  const passwordField_ = passwordField('Password', p.password, (v) => {
    p.password = v;
    app.changed();
  }, { path: `${path}.password`, required: true, help: SMTP_HELP.password, helpLink: SMTP_HELP.passwordLink });
  // The password help names the chosen provider and links to its app-password page.
  const applyPreset = (key: string): void => {
    const preset = smtpPreset(key);
    if (preset) {
      setHelp(passwordField_, preset.passwordHelp, preset.passwordLink);
    } else {
      setHelp(passwordField_, SMTP_HELP.password, SMTP_HELP.passwordLink);
    }
    server.setLocked(preset !== undefined);
  };

  body.appendChild(presetPicker(p, path, (key) => {
    const preset = smtpPreset(key);
    p.smtpPreset = preset ? preset.key : '';
    if (preset) {
      // Choosing a preset fills the server settings; Other leaves whatever is there editable.
      p.host = preset.host;
      p.port = preset.port;
      p.security = preset.security;
      server.host.value = preset.host;
      server.port.value = String(preset.port);
      server.security.value = preset.security;
    }
    applyPreset(key);
    app.changed();
  }));
  body.appendChild(el('div', { class: 'ns-grid' },
    el('div', { class: 'ns-span-6' }, hostField),
    el('div', { class: 'ns-span-3' }, portField),
    el('div', { class: 'ns-span-3' }, securityField),
  ));
  body.appendChild(serverHelp);
  body.appendChild(textField('Username', p.username, (v) => {
    p.username = v;
    app.changed();
  }, { path: `${path}.username`, required: true, autocomplete: 'off', placeholder: 'e.g. you@example.com', help: SMTP_HELP.username }));
  body.appendChild(passwordField_);
  body.appendChild(el('div', { class: 'ns-grid' },
    el('div', { class: 'ns-span-7' }, textField('From address', p.from.address, (v) => {
      p.from.address = v;
      app.changed();
    }, { path: `${path}.from.address`, required: true, type: 'email', placeholder: 'e.g. you@example.com', help: SMTP_HELP.fromAddress })),
    el('div', { class: 'ns-span-5' }, textField('From name', p.from.name, (v) => {
      p.from.name = v;
      app.changed();
    }, { path: `${path}.from.name`, placeholder: 'e.g. Home', help: SMTP_HELP.fromName })),
  ));
  body.appendChild(advancedDisclosure(app, p, path, id, [], false));
  // A stored preset locks the stored values; nothing is overwritten on load (the runtime reads host, port and security).
  applyPreset(p.smtpPreset);
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

/**
 * The UI server already limits the username to this shape; the page checks again before it builds a link or a QR
 * code from it, so nothing but a bot username can ever be embedded (SPEC section 11.2, item 10).
 */
const BOT_USERNAME_PATTERN = /^[A-Za-z0-9_]{5,32}$/;

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
      setUsername(result.ok && typeof result.username === 'string' && BOT_USERNAME_PATTERN.test(result.username) ? result.username : undefined);
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

// ---- ntfy (SPEC section 11.2, item 24) ------------------------------------------------------------------

function ntfyFields(app: App, p: UiProvider, path: string, body: HTMLElement, id: HTMLElement): void {
  body.appendChild(el('p', { class: 'ns-card-intro ns-help mb-3' }, NTFY_HELP.intro, ' ', helpLink(NTFY_HELP.introLink)));
  body.appendChild(textField('Server', p.server, (v) => {
    p.server = v;
    app.changed();
  }, { path: `${path}.server`, required: true, monospace: true, placeholder: 'e.g. https://ntfy.sh', help: NTFY_HELP.server }));

  // The credential fields for the chosen auth mode; the others stay in the model but out of the form.
  const token = passwordField('Access token', p.token, (v) => {
    p.token = v;
    app.changed();
  }, { path: `${path}.token`, required: true, help: NTFY_HELP.token, helpLink: NTFY_HELP.authLink });
  const username = textField('Username', p.username, (v) => {
    p.username = v;
    app.changed();
  }, { path: `${path}.username`, required: true, autocomplete: 'off', help: NTFY_HELP.username });
  const password = passwordField('Password', p.password, (v) => {
    p.password = v;
    app.changed();
  }, { path: `${path}.password`, required: true, help: NTFY_HELP.password });
  let applyAuth: () => void = () => undefined;
  const authField = selectField(NTFY_HELP.authLabel, p.auth, NTFY_HELP.authOptions, (v) => {
    p.auth = v as NtfyAuth;
    applyAuth();
    app.changed();
  }, { path: `${path}.auth`, help: NTFY_HELP.auth[p.auth], helpLink: NTFY_HELP.authLink });
  applyAuth = (): void => {
    setHelp(authField, NTFY_HELP.auth[p.auth], NTFY_HELP.authLink);
    token.hidden = p.auth !== 'token';
    username.hidden = p.auth !== 'basic';
    password.hidden = p.auth !== 'basic';
    body.setAttribute('data-auth', p.auth);
  };
  body.appendChild(authField);
  body.appendChild(token);
  body.appendChild(el('div', { class: 'ns-grid ns-basic-auth' },
    el('div', { class: 'ns-span-6' }, username),
    el('div', { class: 'ns-span-6' }, password),
  ));
  applyAuth();
  body.appendChild(advancedDisclosure(app, p, path, id, [], false));
}

// ---- Shared ---------------------------------------------------------------------------------------------

function providerCard(app: App, p: UiProvider, index: number): HTMLElement {
  const path = `providers[${index}]`;
  const others = (): string[] => app.config.providers.filter((other) => other !== p).map((other) => other.id);
  const card = el('div', { class: 'card mb-3', 'data-path': path, 'data-type': p.type });
  const title = el('span', { class: 'fw-semibold' }, providerTitle(p));
  const badge = el('span', { class: 'badge text-bg-secondary ms-2' }, PROVIDER_TYPE_LABEL[p.type]);
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
  }, { path: `${path}.name`, required: true, placeholder: `e.g. ${PROVIDER_CHOOSER[p.type].name}`, help: PROVIDER_NAME_HELP }));

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
  case 'ntfy':
    ntfyFields(app, p, path, body, id);
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
  const remove = inlineConfirm({
    start: dangerLinkButton('Remove provider', () => undefined),
    question: () => REMOVE.question('provider'),
    confirmLabel: REMOVE.confirm,
    confirmClass: 'btn btn-danger btn-sm',
    cancelLabel: REMOVE.cancel,
    cls: 'ns-remove-confirm',
    onConfirm: () => {
      app.config.providers.splice(index, 1);
      app.entryRemoved('providers', index);
      app.rerender('providers', true);
    },
  });

  card.appendChild(header);
  card.appendChild(body);
  card.appendChild(cardFooter(remove, test));
  card.appendChild(results);
  app.watchCard(card, p);
  return card;
}

/** The chooser tiles, one per provider type (SPEC section 11.2, item 13). Picking one creates the provider with its type fixed. */
function chooserTiles(app: App): HTMLElement {
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
  return el('div', { class: 'ns-chooser-tiles' }, ...tiles);
}

/**
 * The provider chooser (SPEC section 11.2, item 13): Add provider is replaced by the tiles; picking one
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
    const tiles = chooserTiles(app);
    slot.appendChild(el('div', { class: 'ns-chooser', role: 'group', 'aria-label': CHOOSER.prompt },
      el('div', { class: 'fw-semibold mb-2' }, CHOOSER.prompt),
      tiles,
      el('div', { class: 'mt-2' }, outlineButton(CHOOSER.cancel, showButton, 'ns-chooser-cancel')),
    ));
    tiles.querySelector<HTMLElement>('.ns-chooser-tile')?.focus();
  };
  showButton();
  return slot;
}

/**
 * Guided empty state (SPEC section 11.2, item 19): with no providers, the section body is a single
 * "Get started" card holding the chooser tiles inline. Once one provider exists the section renders
 * as usual, with the Add provider button and its chooser.
 */
function getStartedCard(app: App): HTMLElement {
  return el('div', { class: 'card mb-3 ns-get-started', role: 'group', 'aria-label': GET_STARTED.title },
    el('div', { class: 'card-header fw-semibold' }, GET_STARTED.title),
    el('div', { class: 'card-body' },
      el('p', { class: 'mb-0 ns-get-started-intro' }, GET_STARTED.intro),
      chooserTiles(app),
    ),
  );
}

export function renderProviders(app: App, container: HTMLElement): void {
  if (app.config.providers.length === 0) {
    container.appendChild(getStartedCard(app));
    container.appendChild(el('div', { class: 'list-feedback', 'data-path': 'providers' }, el('div', { class: 'invalid-feedback' })));
    return;
  }
  container.appendChild(paragraph(PROVIDERS_SECTION));
  app.config.providers.forEach((p, i) => container.appendChild(providerCard(app, p, i)));
  container.appendChild(el('div', { class: 'list-feedback', 'data-path': 'providers' }, el('div', { class: 'invalid-feedback' })));
  container.appendChild(addProviderControl(app));
}
