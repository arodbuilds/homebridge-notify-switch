import type { ProviderType } from '../../../src/types.js';
import { CREDENTIAL_KEYS } from '../../../src/types.js';
import { addressList } from '../addressList.js';
import { callServer } from '../api.js';
import type { App } from '../app.js';
import { PROVIDERS_SECTION, SMTP_HELP, TELEGRAM_HELP, TWILIO_HELP } from '../copy.js';
import { button, el, numberField, paragraph, passwordField, selectField, statusBox, textField } from '../dom.js';
import { exportProvider, newProvider, slugify } from '../model.js';
import type { UiProvider } from '../model.js';

const TYPE_LABELS: Record<ProviderType, string> = { twilio: 'Twilio (SMS and email)', smtp: 'SMTP (email)', telegram: 'Telegram' };

export function providerTitle(p: UiProvider): string {
  return p.name.trim() || p.id.trim() || 'New provider';
}

function credentialsNote(type: ProviderType): string {
  return 'Optional. Path, relative to the Homebridge storage directory, of a JSON file whose keys override this provider\'s secret fields '
    + `(${CREDENTIAL_KEYS[type].join(', ')}). Keeps secrets out of config.json and backups. Read once when Homebridge starts.`;
}

function providerCard(app: App, p: UiProvider, index: number): HTMLElement {
  const path = `providers[${index}]`;
  const header = el('div', { class: 'card-header d-flex justify-content-between align-items-center' });
  const title = el('span', { class: 'fw-semibold' }, providerTitle(p));
  const badge = el('span', { class: 'badge text-bg-secondary ms-2' }, p.type);
  header.appendChild(el('span', {}, title, badge));
  header.appendChild(button('Remove', () => {
    app.config.providers.splice(index, 1);
    app.rerender('providers', true);
  }, 'btn btn-outline-danger btn-sm'));

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
    body.appendChild(textField('Account SID', p.accountSid, (v) => {
      p.accountSid = v;
      app.changed();
    }, { path: `${path}.accountSid`, required: true, monospace: true, placeholder: 'AC…', help: TWILIO_HELP.accountSid }));
    body.appendChild(textField('API Key SID', p.apiKeySid, (v) => {
      p.apiKeySid = v;
      app.changed();
    }, { path: `${path}.apiKeySid`, required: true, monospace: true, placeholder: 'SK…', help: TWILIO_HELP.apiKey }));
    body.appendChild(passwordField('API Key Secret', p.apiKeySecret, (v) => {
      p.apiKeySecret = v;
      app.changed();
    }, { path: `${path}.apiKeySecret`, required: true, help: TWILIO_HELP.apiKey }));
    body.appendChild(el('div', { class: 'mb-3' },
      el('label', { class: 'form-label' }, 'SMS Senders'),
      addressList({
        channel: 'sms', values: p.smsSenders, defaultCountry: app.config.defaultCountry, path: `${path}.smsSenders`,
        onChange: () => app.changed(true), addLabel: 'Add sender number', emptyText: 'No sender numbers yet. Add one, or set a Messaging Service SID below.',
      }).el,
      el('div', { class: 'form-text' }, TWILIO_HELP.smsSenders),
    ));
    body.appendChild(textField('Messaging Service SID', p.messagingServiceSid, (v) => {
      p.messagingServiceSid = v;
      app.changed(true);
    }, { path: `${path}.messagingServiceSid`, monospace: true, placeholder: 'MG…', help: TWILIO_HELP.messagingServiceSid }));
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
    break;
  case 'smtp':
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
    break;
  case 'telegram':
    body.appendChild(passwordField('Bot Token', p.botToken, (v) => {
      p.botToken = v;
      app.changed();
    }, { path: `${path}.botToken`, required: true, help: TELEGRAM_HELP.botToken }));
    body.appendChild(selectField('Parse Mode', p.parseMode, [
      { value: 'none', label: 'None (plain text)' }, { value: 'markdown', label: 'Markdown' }, { value: 'html', label: 'HTML' },
    ], (v) => {
      p.parseMode = v as UiProvider['parseMode'];
      app.changed();
    }, { path: `${path}.parseMode`, help: 'How Telegram should interpret the message body. Plain text is the safest choice.' }));
    break;
  }

  const advanced = el('details', { class: 'mb-3' },
    el('summary', { class: 'text-muted small' }, 'Advanced: credentials file'),
    el('div', { class: 'mt-2' }, textField('Credentials File', p.credentialsFile, (v) => {
      p.credentialsFile = v;
      app.changed();
    }, { path: `${path}.credentialsFile`, monospace: true, placeholder: 'notify-switch-twilio.json', help: credentialsNote(p.type) })),
  );
  if (p.credentialsFile.trim()) {
    advanced.open = true;
  }
  body.appendChild(advanced);

  const status = statusBox();
  const test = button('Test connection', async () => {
    status.set('info', 'Testing…');
    const result = await callServer<{ ok: boolean; message: string }>('/test-provider', { provider: exportProvider(p) });
    status.set(result.ok ? 'success' : 'danger', result.message);
  }, 'btn btn-outline-primary btn-sm');
  body.appendChild(el('div', { class: 'd-flex flex-wrap align-items-start gap-2' }, test, status.el));

  return el('div', { class: 'card mb-3', 'data-path': path }, header, body);
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
