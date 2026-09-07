import { toastSuccess } from '../api.js';
import type { App } from '../app.js';
import { BACKUP } from '../copy.js';
import { button, checkboxField, clear, dangerLinkButton, el, openModal, selectField, textField } from '../dom.js';
import { backupBlock, emptyConfig, emptySecretPaths, exportConfig, exportConfigWithoutCredentials, MAX_BACKUP_BYTES, readConfig } from '../model.js';
import type { UiConfig } from '../model.js';
import { countryOptions } from '../phone.js';
import { validate } from '../validate.js';

/** `notify-switch-backup-YYYY-MM-DD.json` for today, in local time; `-without-credentials` before the date for the shareable version. */
export function backupFileName(now = new Date(), withoutCredentials = false): string {
  const pad = (n: number): string => String(n).padStart(2, '0');
  const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  return `notify-switch-backup${withoutCredentials ? '-without-credentials' : ''}-${date}.json`;
}

/**
 * Downloads the current platform block as a JSON file: the full block, or the version with every secret
 * field emptied and `credentialsRemoved: true` (SPEC section 11.2, item 12).
 */
function downloadBackup(app: App, withoutCredentials = false): void {
  const block = withoutCredentials ? exportConfigWithoutCredentials(app.config) : exportConfig(app.config);
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

  return el('details', { class: 'ns-advanced mt-3', 'data-advanced': 'settings' },
    el('summary', { class: 'ns-secondary small' }, BACKUP.summary),
    el('div', { class: 'mt-2' },
      el('div', { class: 'mb-3' },
        el('div', { class: 'ns-backup-actions' },
          button(BACKUP.download, () => downloadBackup(app), 'btn btn-outline-secondary btn-sm'),
          button(BACKUP.downloadWithoutCredentials, () => downloadBackup(app, true), 'btn btn-outline-secondary btn-sm'),
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
  container.appendChild(checkboxField('Debug logging', c.debug, (value) => {
    c.debug = value;
    app.changed();
  }, { path: 'debug', help: 'Verbose logging, including message bodies and full recipient addresses. Credentials are never logged, even with this on.' }));
  container.appendChild(advancedPanel(app));
}
