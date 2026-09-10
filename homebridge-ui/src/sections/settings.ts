import { CHANNELS } from '../../../src/types.js';
import { providersForChannel, resolveDefaultProvider } from '../../../src/defaults.js';
import { toastSuccess } from '../api.js';
import type { App } from '../app.js';
import type { DateFormat, TimeFormat } from '../../../src/types.js';
import { BACKUP, DEFAULTS, FORMAT_SETTINGS, PROVIDER_TYPE_LABEL } from '../copy.js';
import { button, checkboxField, clear, dangerLinkButton, el, helpText, openModal, selectField, textField } from '../dom.js';
import {
  backupBlock, blockWithoutCredentials, emptyConfig, emptySecretPaths, exportConfig, exportConfigWithoutCredentials, legacySwitches, MAX_BACKUP_BYTES,
  readConfig,
} from '../model.js';
import type { UiConfig } from '../model.js';
import { countryOptions } from '../phone.js';
import { validate } from '../validate.js';
import { providerTitle } from './providers.js';

/** `notify-switch-backup-YYYY-MM-DD.json` for today, in local time; `-without-credentials` before the date for the shareable version. */
export function backupFileName(now = new Date(), withoutCredentials = false): string {
  const pad = (n: number): string => String(n).padStart(2, '0');
  const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  return `notify-switch-backup${withoutCredentials ? '-without-credentials' : ''}-${date}.json`;
}

/**
 * The platform block a backup holds: the editor's, or, while the loaded configuration cannot be represented
 * (SPEC section 11.2, item 26), the block exactly as it was loaded, so nothing the editor cannot show is lost.
 */
function backupContents(app: App, withoutCredentials: boolean): Record<string, unknown> {
  if (app.legacy) {
    return withoutCredentials ? blockWithoutCredentials(app.legacy.block) : app.legacy.block;
  }
  return withoutCredentials ? exportConfigWithoutCredentials(app.config) : exportConfig(app.config);
}

/**
 * Downloads the current platform block as a JSON file: the full block, or the version with every secret
 * field emptied and `credentialsRemoved: true` (SPEC section 11.2, item 12).
 */
function downloadBackup(app: App, withoutCredentials = false): void {
  const block = backupContents(app, withoutCredentials);
  const text = JSON.stringify(block, null, 2);
  const blob = new Blob([text], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = el('a', { href: url, download: backupFileName(new Date(), withoutCredentials), hidden: true });
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Checks a backup's text before anything changes: JSON, then the platform block shape, then the same
 * rules the form applies (which mirror config.schema.json and startup validation). Returns the config
 * to load, or the list of problems. A backup without credentials (`credentialsRemoved: true`) is accepted
 * with its secret fields empty; `emptied` lists their paths so the form can show their errors. A file over
 * `MAX_BACKUP_BYTES` is refused before it is parsed, and so is one holding a `__proto__`, `constructor` or
 * `prototype` key at any level (SPEC section 12, item 12).
 */
export function checkBackup(text: string): { config?: UiConfig; errors: string[]; emptied: string[] } {
  if (text.length > MAX_BACKUP_BYTES) {
    return { errors: [BACKUP.restoreTooLarge], emptied: [] };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    return { errors: [`Not valid JSON: ${err instanceof Error ? err.message : String(err)}`], emptied: [] };
  }
  const { block, error, forbiddenKey } = backupBlock(parsed);
  if (forbiddenKey !== undefined) {
    return { errors: [BACKUP.restoreForbiddenKey(forbiddenKey)], emptied: [] };
  }
  if (!block) {
    return { errors: [error ?? 'The file is not a Notify Switch backup.'], emptied: [] };
  }
  // A switch with more than one action on the same channel cannot be shown, so the file is not loaded (SPEC section 11.2, item 26).
  const legacy = legacySwitches(block);
  if (legacy.length > 0) {
    return { errors: [BACKUP.restoreLegacy(legacy)], emptied: [] };
  }
  // The marker is not a platform field; it must not reach config.json.
  const withoutCredentials = block.credentialsRemoved === true;
  delete block.credentialsRemoved;
  const config = readConfig(block);
  const emptied = withoutCredentials ? emptySecretPaths(config) : [];
  const issues = validate(config).filter((issue) => !emptied.includes(issue.path));
  if (issues.length > 0) {
    return { errors: issues.map((issue) => `${issue.label}: ${issue.message}`), emptied: [] };
  }
  return { config, errors: [], emptied };
}

/** Settings > Advanced (SPEC section 11.2, item 12): backup, restore, and reset. Collapsed by default. */
function advancedPanel(app: App): HTMLElement {
  const restoreStatus = el('div', { class: 'restore-status', role: 'status' });
  const showErrors = (errors: string[]): void => {
    clear(restoreStatus);
    restoreStatus.appendChild(el('div', { class: 'alert alert-danger py-2 px-3 mt-2 mb-0' },
      el('div', { class: 'fw-semibold' }, BACKUP.restoreFailed),
      el('ul', { class: 'mb-0 ps-3' }, ...errors.map((line) => el('li', {}, line))),
    ));
  };

  const fileInput = el('input', { type: 'file', class: 'form-control form-control-sm', accept: 'application/json,.json', 'aria-label': BACKUP.restore });
  fileInput.addEventListener('change', () => {
    const file = fileInput.files?.[0];
    if (!file) {
      return;
    }
    // The size is checked before the file is read, so an oversized file never reaches the parser.
    if (file.size > MAX_BACKUP_BYTES) {
      fileInput.value = '';
      showErrors([BACKUP.restoreTooLarge]);
      return;
    }
    file.text().then((text) => {
      const result = checkBackup(text);
      fileInput.value = '';
      if (!result.config) {
        showErrors(result.errors);
        return;
      }
      clear(restoreStatus);
      app.replaceConfig(result.config, 'restore');
      if (result.emptied.length > 0) {
        // The secrets the backup left out: their errors show at once and the issue list names them.
        app.touchFields(result.emptied);
        toastSuccess(BACKUP.restoredWithoutCredentials);
      } else {
        toastSuccess(BACKUP.restored);
      }
    }).catch((err: unknown) => {
      showErrors([`Could not read the file: ${err instanceof Error ? err.message : String(err)}`]);
    });
  });

  const reset = dangerLinkButton(BACKUP.reset, () => {
    const confirmInput = el('input', { type: 'text', class: 'form-control', autocomplete: 'off', spellcheck: 'false', 'aria-label': BACKUP.resetPrompt });
    let closeModal: () => void = () => undefined;
    const confirm = button(BACKUP.resetConfirm, () => {
      closeModal();
      app.replaceConfig(emptyConfig(), 'reset');
      toastSuccess(BACKUP.resetDone);
    }, 'btn btn-danger btn-sm');
    confirm.disabled = true;
    confirmInput.addEventListener('input', () => {
      confirm.disabled = confirmInput.value.trim() !== 'RESET';
    });
    const modal = openModal({
      title: BACKUP.resetTitle,
      body: el('div', {},
        el('ul', { class: 'ps-3' }, ...BACKUP.resetList.map((line) => el('li', {}, line))),
        el('div', { class: 'mb-3' }, button(BACKUP.resetDownloadFirst, () => downloadBackup(app), 'btn btn-outline-secondary btn-sm')),
        el('label', { class: 'form-label', for: 'ns-reset-confirm' }, BACKUP.resetPrompt),
        confirmInput,
      ),
      actions: [confirm],
    });
    closeModal = modal.close;
    confirmInput.id = 'ns-reset-confirm';
    confirmInput.focus();
  });

  // The three controls that stay usable while the loaded configuration cannot be represented (SPEC section 11.2, item 26).
  reset.classList.add('ns-legacy-allowed');
  return el('details', { class: 'ns-advanced mt-3', 'data-advanced': 'settings', open: app.legacy !== undefined },
    el('summary', { class: 'ns-secondary small' }, BACKUP.summary),
    el('div', { class: 'mt-2' },
      el('div', { class: 'mb-3' },
        el('div', { class: 'ns-backup-actions' },
          button(BACKUP.download, () => downloadBackup(app), 'btn btn-outline-secondary btn-sm ns-legacy-allowed'),
          button(BACKUP.downloadWithoutCredentials, () => downloadBackup(app, true), 'btn btn-outline-secondary btn-sm ns-legacy-allowed'),
        ),
        el('div', { class: 'form-text backup-note' }, BACKUP.backupNote),
      ),
      el('div', { class: 'mb-3' },
        el('label', { class: 'form-label' }, BACKUP.restore),
        fileInput,
        el('div', { class: 'form-text' }, BACKUP.restoreHelp),
        restoreStatus,
      ),
      el('div', {}, reset),
    ),
  );
}

/** Platform-level settings (SPEC section 5.1). */
export function renderSettings(app: App, container: HTMLElement): void {
  const c = app.config;
  container.appendChild(el('p', { class: 'section-copy' },
    'Platform-wide options. The default country is used when a phone number is entered without a country code.'));
  container.appendChild(el('div', { class: 'ns-grid' },
    el('div', { class: 'ns-span-6' }, textField('Name', c.name, (value) => {
      c.name = value;
      app.changed();
    }, { path: 'name', required: true, help: 'Platform display name shown in the Homebridge logs.' })),
    el('div', { class: 'ns-span-6' }, selectField('Default Country', c.defaultCountry, countryOptions(), (value) => {
      c.defaultCountry = value;
      // Phone rows default to this country, so redraw the sections that contain them.
      app.rerender('providers');
      app.rerender('groups');
      app.rerender('switches');
      app.changed();
    }, { path: 'defaultCountry', help: 'Phone numbers entered without a country code are treated as numbers from this country.' })),
  ));
  // Time and date formats (SPEC section 5.1): two dropdowns directly below Default Country with one help line under the pair.
  container.appendChild(el('div', { class: 'ns-format-settings mb-3' },
    el('div', { class: 'ns-grid' },
      el('div', { class: 'ns-span-6' }, selectField(FORMAT_SETTINGS.timeLabel, c.timeFormat, FORMAT_SETTINGS.timeOptions, (value) => {
        c.timeFormat = value as TimeFormat;
        app.changed();
      }, { path: 'timeFormat' })),
      el('div', { class: 'ns-span-6' }, selectField(FORMAT_SETTINGS.dateLabel, c.dateFormat, FORMAT_SETTINGS.dateOptions, (value) => {
        c.dateFormat = value as DateFormat;
        app.changed();
      }, { path: 'dateFormat' })),
    ),
    helpText(FORMAT_SETTINGS.help, undefined, 'ns-format-help'),
  ));
  const nameField = textField('Master switch name', c.masterSwitch.name, (value) => {
    c.masterSwitch.name = value;
    app.changed();
  }, { path: 'masterSwitch.name', help: 'Letters, numbers, spaces, and apostrophes only. Must start and end with a letter or number.' });
  nameField.hidden = !c.masterSwitch.enabled;
  container.appendChild(el('div', { class: 'ns-grid' },
    el('div', { class: 'ns-span-6' }, checkboxField('Show master switch', c.masterSwitch.enabled, (value) => {
      c.masterSwitch.enabled = value;
      nameField.hidden = !value;
      app.changed();
    }, {
      path: 'masterSwitch.enabled',
      help: 'A single switch in the Home app that turns all notifications on or off. When it is off, no switch sends anything.',
    })),
    el('div', { class: 'ns-span-6' }, nameField),
  ));
  // Default providers (SPEC section 5.7 and section 11.2, item 25): one dropdown per channel with more than one provider.
  const defaults = el('div', { class: 'ns-default-providers' });
  for (const channel of CHANNELS) {
    const candidates = providersForChannel(c.providers, channel);
    if (candidates.length < 2) {
      continue;
    }
    const resolution = resolveDefaultProvider(channel, c.providers, c.defaultProviders);
    // The written value (SPEC section 11.2, item 25). The placeholder shows only while nothing is written yet (the
    // second provider is still being filled in) and cannot be chosen: the page writes the fallback once it validates.
    const stored = resolution.source === 'stored' ? resolution.id ?? '' : '';
    const field = selectField(DEFAULTS.settingsLabel(channel), stored, [
      ...(stored ? [] : [{ value: '', label: DEFAULTS.settingsPlaceholder, disabled: true }]),
      ...candidates.map((p) => ({ value: p.id.trim(), label: `${providerTitle(p)} (${PROVIDER_TYPE_LABEL[p.type]})` })),
    ], (value) => {
      if (value) {
        app.chooseDefault(channel, value);
      }
    }, { path: `defaultProviders.${channel}`, help: DEFAULTS.settingsHelp(channel) });
    field.setAttribute('data-channel', channel);
    defaults.appendChild(el('div', { class: 'ns-span-6' }, field));
  }
  if (defaults.childElementCount > 0) {
    defaults.classList.add('ns-grid');
    container.appendChild(defaults);
  }
  container.appendChild(checkboxField('Debug logging', c.debug, (value) => {
    c.debug = value;
    app.changed();
  }, { path: 'debug', help: 'Verbose logging, including message bodies and full recipient addresses. Credentials are never logged, even with this on.' }));
  container.appendChild(advancedPanel(app));
}
