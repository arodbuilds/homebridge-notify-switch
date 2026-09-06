import { setSaveEnabled, toastError } from './api.js';
import type { App, Section } from './app.js';
import { GETTING_STARTED, HOMEKIT_USAGE } from './copy.js';
import { clear, el } from './dom.js';
import { exportConfig, readConfig } from './model.js';
import type { UiConfig } from './model.js';
import { renderGroups } from './sections/groups.js';
import { renderProviders } from './sections/providers.js';
import { renderSettings } from './sections/settings.js';
import { renderSwitches } from './sections/switches.js';
import { validate } from './validate.js';
import type { UiIssue } from './validate.js';

/**
 * Custom settings UI (SPEC section 11.2). Reads the platform block with `getPluginConfig`, pushes
 * every change with `updatePluginConfig`, and leaves saving to the Homebridge UI's Save button,
 * which is disabled while validation finds errors.
 */

const SECTIONS: Array<{ key: Section; title: string; render(app: App, container: HTMLElement): void }> = [
  { key: 'providers', title: 'Providers', render: renderProviders },
  { key: 'groups', title: 'Recipient Groups', render: renderGroups },
  { key: 'switches', title: 'Switches', render: renderSwitches },
  { key: 'settings', title: 'Settings', render: renderSettings },
];

class Page implements App {
  private readonly containers = new Map<Section, HTMLElement>();
  private readonly issuesBox: HTMLElement;
  private readonly issuesList: HTMLElement;
  private pushTimer: number | undefined;
  private otherBlocks: Array<Record<string, unknown>> = [];

  constructor(public config: UiConfig, private readonly root: HTMLElement) {
    root.appendChild(el('p', { class: 'lead-copy' }, GETTING_STARTED));
    for (const section of SECTIONS) {
      const container = el('div', { class: 'section-body' });
      this.containers.set(section.key, container);
      root.appendChild(el('section', { class: 'ns-section', id: `section-${section.key}` }, el('h2', { class: 'h5' }, section.title), container));
    }
    this.issuesList = el('ul', { class: 'mb-0 ps-3' });
    this.issuesBox = el('div', { class: 'issues alert alert-warning', role: 'alert', hidden: true },
      el('div', { class: 'fw-semibold mb-1' }, 'Fix these before saving:'), this.issuesList);
    root.appendChild(this.issuesBox);
    root.appendChild(el('p', { class: 'lead-copy mt-3' }, HOMEKIT_USAGE));
  }

  setOtherBlocks(blocks: Array<Record<string, unknown>>): void {
    this.otherBlocks = blocks;
  }

  renderAll(): void {
    for (const section of SECTIONS) {
      this.rerender(section.key);
    }
    this.revalidate();
  }

  rerender(section: Section, refs = false): void {
    const container = this.containers.get(section);
    if (!container) {
      return;
    }
    clear(container);
    SECTIONS.find((s) => s.key === section)?.render(this, container);
    if (refs && section !== 'switches') {
      this.rerender('switches');
    }
    this.changed();
  }

  changed(refs = false): void {
    if (refs) {
      // Provider or group identity changed: the Switches dropdowns must reflect it. Debounced because this runs per keystroke.
      this.scheduleSwitchRefresh();
    }
    this.revalidate();
    this.push();
  }

  private switchRefreshTimer: number | undefined;

  private scheduleSwitchRefresh(): void {
    if (this.switchRefreshTimer !== undefined) {
      window.clearTimeout(this.switchRefreshTimer);
    }
    this.switchRefreshTimer = window.setTimeout(() => {
      this.switchRefreshTimer = undefined;
      const container = this.containers.get('switches');
      if (container) {
        clear(container);
        renderSwitches(this, container);
        this.markIssues(validate(this.config));
      }
    }, 400);
  }

  private push(): void {
    if (this.pushTimer !== undefined) {
      window.clearTimeout(this.pushTimer);
    }
    this.pushTimer = window.setTimeout(() => {
      this.pushTimer = undefined;
      const blocks = [exportConfig(this.config), ...this.otherBlocks];
      window.homebridge.updatePluginConfig(blocks).catch((err: unknown) => {
        toastError(`Could not update the configuration: ${err instanceof Error ? err.message : String(err)}`);
      });
    }, 150);
  }

  private revalidate(): void {
    const issues = validate(this.config);
    this.markIssues(issues);
    clear(this.issuesList);
    for (const issue of issues) {
      this.issuesList.appendChild(el('li', {}, el('strong', {}, `${issue.label}: `), issue.message));
    }
    this.issuesBox.hidden = issues.length === 0;
    setSaveEnabled(issues.length === 0);
  }

  /** Marks the control for each issue path as invalid and shows the message under it. */
  private markIssues(issues: UiIssue[]): void {
    const controls = ':scope > .form-control, :scope > .form-select, :scope > .input-group > .form-control, :scope > .form-check-input';
    for (const node of this.root.querySelectorAll<HTMLElement>('[data-path]')) {
      node.classList.remove('has-issue');
      const feedback = node.querySelector<HTMLElement>(':scope > .invalid-feedback, :scope > .input-group + .invalid-feedback');
      if (feedback) {
        feedback.textContent = '';
      }
      for (const control of node.querySelectorAll<HTMLElement>(controls)) {
        control.classList.remove('is-invalid');
      }
    }
    const byPath = new Map<string, string>();
    for (const issue of issues) {
      if (!byPath.has(issue.path)) {
        byPath.set(issue.path, issue.message);
      }
    }
    for (const [path, message] of byPath) {
      const node = this.root.querySelector<HTMLElement>(`[data-path="${CSS.escape(path)}"]`);
      if (!node) {
        continue;
      }
      node.classList.add('has-issue');
      const feedback = node.querySelector<HTMLElement>(':scope > .invalid-feedback');
      if (feedback) {
        feedback.textContent = message;
      }
      for (const control of node.querySelectorAll<HTMLElement>(controls)) {
        control.classList.add('is-invalid');
      }
    }
  }
}

async function start(): Promise<void> {
  const root = document.getElementById('app');
  if (!root) {
    return;
  }
  const hb = window.homebridge;
  hb.showSpinner();
  try {
    const blocks = await hb.getPluginConfig();
    const index = blocks.findIndex((block) => block && typeof block === 'object' && block.platform === 'NotifySwitch');
    const raw = index >= 0 ? blocks[index] : undefined;
    const page = new Page(readConfig(raw), root);
    page.setOtherBlocks(blocks.filter((_, i) => i !== index));
    page.renderAll();
  } catch (err) {
    root.appendChild(el('div', { class: 'alert alert-danger' }, `Could not load the configuration: ${err instanceof Error ? err.message : String(err)}`));
  } finally {
    hb.hideSpinner();
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    start().catch(() => undefined);
  });
} else {
  start().catch(() => undefined);
}
