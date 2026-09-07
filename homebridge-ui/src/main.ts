import { setSaveEnabled, toastError } from './api.js';
import type { App, Section } from './app.js';
import { GETTING_STARTED, GETTING_STARTED_STEPS, HOMEKIT_USAGE, SAVE_STATUS, VALIDATION } from './copy.js';
import { clear, el } from './dom.js';
import { renderFooter } from './footer.js';
import { exportConfig, readConfig } from './model.js';
import type { UiConfig } from './model.js';
import { localeCountry } from './phone.js';
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

/** True on phones and tablets: the page then gives every button a 44px touch target (SPEC section 11.2, item 16). */
export function isTouchDevice(): boolean {
  try {
    return (window.matchMedia && window.matchMedia('(pointer: coarse)').matches) || navigator.maxTouchPoints > 0;
  } catch {
    return false;
  }
}

class Page implements App {
  private readonly containers = new Map<Section, HTMLElement>();
  private readonly issuesBox: HTMLElement;
  private readonly issuesHeading: HTMLElement;
  private readonly issuesList: HTMLElement;
  private pushTimer: number | undefined;
  private otherBlocks: Array<Record<string, unknown>> = [];
  /** Providers, groups and switches added this session whose card nobody has touched yet (SPEC section 11.2, item 15). */
  private readonly fresh = new WeakSet<object>();
  /** Whether the Providers section last rendered its guided empty state (SPEC section 11.2, item 19). */
  private providersEmpty: boolean;
  /** True from a Reset until the next change, so the Save status area reads the reset line (SPEC section 11.2, item 19). */
  private justReset = false;

  constructor(public config: UiConfig, private readonly root: HTMLElement) {
    this.providersEmpty = config.providers.length === 0;
    root.appendChild(el('p', { class: 'lead-copy' }, GETTING_STARTED));
    root.appendChild(el('p', { class: 'lead-copy' }, GETTING_STARTED_STEPS));
    for (const section of SECTIONS) {
      const container = el('div', { class: 'section-body' });
      this.containers.set(section.key, container);
      root.appendChild(el('section', { class: 'ns-section', id: `section-${section.key}` }, el('h2', { class: 'h5' }, section.title), container));
    }
    this.issuesList = el('ul', { class: 'mb-0 ps-3' });
    this.issuesHeading = el('div', { class: 'fw-semibold mb-1' }, 'Fix these before saving:');
    // The Save status area: the issue list, the "Fill in the new …" line, or "Nothing to save yet".
    this.issuesBox = el('div', { class: 'issues alert alert-warning', role: 'alert', hidden: true }, this.issuesHeading, this.issuesList);
    root.appendChild(this.issuesBox);
    root.appendChild(el('p', { class: 'lead-copy mt-3' }, HOMEKIT_USAGE));
    // The footer is the last element of the page (SPEC section 11.2, item 20).
    root.appendChild(renderFooter());
  }

  setOtherBlocks(blocks: Array<Record<string, unknown>>): void {
    this.otherBlocks = blocks;
  }

  renderAll(): void {
    this.providersEmpty = this.config.providers.length === 0;
    for (const section of SECTIONS) {
      this.rerender(section.key);
    }
    this.revalidate();
  }

  replaceConfig(config: UiConfig, reason?: 'restore' | 'reset'): void {
    this.config = config;
    this.renderAll();
    this.justReset = reason === 'reset';
    this.revalidate();
  }

  rerender(section: Section, refs = false): void {
    const container = this.containers.get(section);
    if (!container) {
      return;
    }
    clear(container);
    SECTIONS.find((s) => s.key === section)?.render(this, container);
    if (section === 'providers') {
      // The first provider added, or the last one removed: the Groups and Switches sections switch
      // between their Add buttons and the disabled "Add a provider first." state (SPEC section 11.2, item 19).
      const empty = this.config.providers.length === 0;
      if (empty !== this.providersEmpty) {
        this.providersEmpty = empty;
        this.rerender('groups');
        if (!refs) {
          this.rerender('switches');
        }
      }
    }
    if (refs && section !== 'switches') {
      this.rerender('switches');
    }
    this.changed();
  }

  changed(refs = false): void {
    this.justReset = false;
    if (refs) {
      // Provider or group identity changed: the Switches dropdowns must reflect it. Debounced because this runs per keystroke.
      this.scheduleSwitchRefresh();
    }
    this.revalidate();
    this.push();
  }

  addFresh(item: object): void {
    this.fresh.add(item);
  }

  watchCard(card: HTMLElement, item: object): void {
    if (!this.fresh.has(item)) {
      return;
    }
    card.classList.add('ns-fresh');
    const touch = (): void => {
      if (!this.fresh.has(item)) {
        return;
      }
      this.fresh.delete(item);
      card.classList.remove('ns-fresh');
      this.revalidate();
    };
    // Leaving a field (blur) or changing a select or checkbox counts as touching the card; typing alone does not.
    card.addEventListener('focusout', (event) => {
      if (event.target instanceof HTMLElement && event.target.matches('input, select, textarea')) {
        touch();
      }
    });
    card.addEventListener('change', touch);
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
        this.markIssues(this.splitIssues(validate(this.config)).visible);
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

  /** The card paths (`providers[2]`) of fresh items, with the kind of each for the "Fill in the new …" line. */
  private freshCards(): Array<{ path: string; kind: string }> {
    const out: Array<{ path: string; kind: string }> = [];
    this.config.providers.forEach((p, i) => this.fresh.has(p) && out.push({ path: `providers[${i}]`, kind: 'provider' }));
    this.config.groups.forEach((g, i) => this.fresh.has(g) && out.push({ path: `groups[${i}]`, kind: 'group' }));
    this.config.switches.forEach((s, i) => this.fresh.has(s) && out.push({ path: `switches[${i}]`, kind: 'switch' }));
    return out;
  }

  /** Issues on untouched cards are held back from the inline marks and the list; they still keep Save disabled. */
  private splitIssues(issues: UiIssue[]): { visible: UiIssue[]; held: UiIssue[]; fresh: Array<{ path: string; kind: string }> } {
    const fresh = this.freshCards();
    const onFresh = (issue: UiIssue): boolean => fresh.some((card) => issue.path === card.path || issue.path.startsWith(`${card.path}.`));
    return { visible: issues.filter((issue) => !onFresh(issue)), held: issues.filter(onFresh), fresh };
  }

  private revalidate(): void {
    const all = validate(this.config);
    const { visible, held, fresh } = this.splitIssues(all);
    this.markIssues(visible);
    clear(this.issuesList);
    for (const issue of visible) {
      this.issuesList.appendChild(el('li', {}, el('strong', {}, `${issue.label}: `), issue.message));
    }
    const nothingToSave = all.length === 0 && this.config.providers.length === 0 && this.config.groups.length === 0 && this.config.switches.length === 0;
    if (visible.length > 0) {
      this.issuesHeading.textContent = 'Fix these before saving:';
      this.issuesBox.className = 'issues alert alert-warning';
      this.issuesBox.setAttribute('role', 'alert');
    } else if (held.length > 0) {
      // Nothing to fix yet, only cards nobody has touched: say why Save is still disabled without listing errors.
      const kinds = [...new Set(held.map((issue) => fresh.find((card) => issue.path.startsWith(card.path))?.kind ?? 'card'))];
      this.issuesHeading.textContent = VALIDATION.finishNew(kinds.join(' and '));
      this.issuesBox.className = 'issues alert alert-info';
      this.issuesBox.setAttribute('role', 'status');
    } else if (nothingToSave) {
      // An empty configuration is valid; say so, or that a Reset is waiting to be saved (SPEC section 11.2, item 19).
      this.issuesHeading.textContent = this.justReset ? SAVE_STATUS.reset : SAVE_STATUS.nothing;
      this.issuesBox.className = 'issues alert alert-secondary';
      this.issuesBox.setAttribute('role', 'status');
    }
    this.issuesBox.hidden = all.length === 0 && !nothingToSave;
    setSaveEnabled(all.length === 0);
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
      // An issue on a field under a collapsed disclosure (the ID under Advanced) would otherwise be invisible.
      for (let details = node.closest('details'); details; details = details.parentElement?.closest('details') ?? null) {
        details.open = true;
      }
    }
  }
}

/** True when the stored platform block carries a defaultCountry of its own. */
function hasSavedCountry(raw: unknown): boolean {
  return typeof raw === 'object' && raw !== null && typeof (raw as { defaultCountry?: unknown }).defaultCountry === 'string'
    && (raw as { defaultCountry: string }).defaultCountry.trim().length > 0;
}

async function start(): Promise<void> {
  const root = document.getElementById('app');
  if (!root) {
    return;
  }
  if (isTouchDevice()) {
    document.body.classList.add('ns-touch');
  }
  const hb = window.homebridge;
  hb.showSpinner();
  try {
    const blocks = await hb.getPluginConfig();
    const index = blocks.findIndex((block) => block && typeof block === 'object' && block.platform === 'NotifySwitch');
    const raw = index >= 0 ? blocks[index] : undefined;
    const config = readConfig(raw);
    // First load with no saved default country: prefill it from the browser locale, US when the locale
    // names no known country. A saved value is never overridden (SPEC section 11.2, item 21).
    if (!hasSavedCountry(raw)) {
      config.defaultCountry = localeCountry(navigator.language) ?? 'US';
    }
    const page = new Page(config, root);
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
