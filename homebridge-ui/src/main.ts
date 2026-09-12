import { setSaveEnabled, toastError } from './api.js';
import type { App, LegacyConfig, Section, ValidationListener } from './app.js';
import { BANNER, DRAFT, GETTING_STARTED, GETTING_STARTED_STEPS, HOMEKIT_USAGE, ISSUES, LEGACY, SAVE_STATUS, VALIDATION } from './copy.js';
import { button, clear, el, linkButton } from './dom.js';
import { clearDraft, readDraft, saveDraft, stableStringify } from './draft.js';
import type { Draft } from './draft.js';
import { renderFooter } from './footer.js';
import { exportConfig, legacySwitches, presentChannels, readConfig } from './model.js';
import type { UiConfig, UiProvider, UiSwitch } from './model.js';
import { CHANNELS } from '../../src/types.js';
import type { Channel } from '../../src/types.js';
import { providersForChannel, resolveDefaultProvider } from '../../src/defaults.js';
import { isCountry, localeCountry } from './phone.js';
import { renderGroups } from './sections/groups.js';
import { renderProviders } from './sections/providers.js';
import { renderSettings } from './sections/settings.js';
import { renderSwitches } from './sections/switches.js';
import { timeZoneCountry } from '../../src/timeZones.js';
import { validate, validProviders } from './validate.js';
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

/** The controls a field wrapper owns: direct children, a password input group, or the input inside an address row. */
const CONTROLS = [
  ':scope > .form-control', ':scope > .form-select', ':scope > .input-group > .form-control', ':scope > .form-check-input',
  ':scope > .address-row-controls > .address-control > .form-control', ':scope > .address-row-controls > .address-control .phone-national',
].join(', ');

/** True on phones and tablets: the page then gives every button a 44px touch target (SPEC section 11.2, item 16). */
export function isTouchDevice(): boolean {
  try {
    return (window.matchMedia && window.matchMedia('(pointer: coarse)').matches) || navigator.maxTouchPoints > 0;
  } catch {
    return false;
  }
}

/** True when `path` is `prefix` itself or a field under it (`groups[0].sms` covers `groups[0].sms[2]`). */
function underPath(path: string, prefix: string): boolean {
  return path === prefix || path.startsWith(`${prefix}.`) || path.startsWith(`${prefix}[`);
}

class Page implements App {
  private readonly containers = new Map<Section, HTMLElement>();
  private readonly issuesBox: HTMLElement;
  private readonly issuesHeading: HTMLElement;
  private readonly issuesList: HTMLElement;
  private readonly issuesToggle: HTMLButtonElement;
  private issuesExpanded = false;
  private readonly draftBanner: HTMLElement;
  private pushTimer: number | undefined;
  private otherBlocks: Array<Record<string, unknown>> = [];
  /** Providers, groups and switches added this session whose card nobody has touched yet (SPEC section 11.2, item 15). */
  private readonly fresh = new WeakSet<object>();
  /**
   * Fields the user has left (blur), changed (selects and checkboxes) or jumped to from the issue list. An
   * error is shown inline only on a touched field (SPEC section 11.2, item 15).
   */
  private readonly touched = new Set<string>();
  /** The messages currently shown inline, by path. A focused field only ever loses its message, never gains one. */
  private shown = new Map<string, string>();
  /** Whether the Providers section last rendered its guided empty state (SPEC section 11.2, item 19). */
  private providersEmpty: boolean;
  /** True from a Reset until the next change, so the Save status area reads the reset line (SPEC section 11.2, item 19). */
  private justReset = false;
  /** The upgrade notice at the top of the page while the loaded configuration cannot be represented (SPEC section 11.2, item 26). */
  private readonly legacyNotice: HTMLElement;
  /**
   * The channels each switch had present at the last pass (SPEC section 11.2, item 8). Every change, whichever card
   * it came from, is compared against it so a channel that becomes present is ticked; one the user unticked stays
   * unticked while it stays present and is ticked again only if it leaves and comes back.
   */
  private readonly presence = new WeakMap<UiSwitch, Set<Channel>>();
  /**
   * The channels whose default this page wrote on appearance (SPEC section 5.7 and section 11.2, item 25) and has not
   * asked about yet, with the card that asks. An entry loaded from config.json never prompts.
   */
  private readonly pendingPrompts = new Map<Channel, UiProvider>();

  constructor(public config: UiConfig, private readonly root: HTMLElement, pendingDraft?: Draft, public legacy?: LegacyConfig) {
    this.providersEmpty = config.providers.length === 0;
    // The page banner is the first element of the page (SPEC section 11.2, item 28), served from the plugin's own
    // public folder beside this bundle; nothing on the page loads from an external host.
    root.appendChild(el('img', { class: 'ns-banner', src: BANNER.file, alt: BANNER.alt, width: '2560', height: '640' }));
    // A configuration with more than one action on the same channel: the blocking notice comes right after the
    // banner, before anything else on the page, and stays until Reset plugin to fresh install replaces the
    // configuration. It is only in the page while it applies, so the draft banner follows the banner otherwise.
    this.legacyNotice = el('div', { class: 'ns-legacy-notice alert alert-warning', role: 'alert' }, LEGACY.notice);
    if (legacy) {
      root.appendChild(this.legacyNotice);
    }
    // Unsaved draft recovery banner (SPEC section 11.2, item 23), directly under the page banner when a draft waits.
    // Laid out by its own rule, not `d-flex`, whose `!important` display would defeat the `hidden` attribute.
    this.draftBanner = el('div', { class: 'ns-draft-banner alert alert-info', role: 'status', hidden: true });
    root.appendChild(this.draftBanner);
    if (pendingDraft) {
      this.offerDraft(pendingDraft);
    }
    root.appendChild(el('p', { class: 'lead-copy' }, GETTING_STARTED));
    root.appendChild(el('p', { class: 'lead-copy' }, GETTING_STARTED_STEPS));
    for (const section of SECTIONS) {
      const container = el('div', { class: 'section-body' });
      this.containers.set(section.key, container);
      root.appendChild(el('section', { class: 'ns-section', id: `section-${section.key}` }, el('h2', { class: 'h5' }, section.title), container));
    }
    this.issuesList = el('ul', { class: 'mb-0 ps-3 ns-issue-list' });
    this.issuesHeading = el('span', { class: 'fw-semibold' }, ISSUES.heading);
    this.issuesToggle = linkButton(ISSUES.showAll, () => {
      this.issuesExpanded = !this.issuesExpanded;
      this.revalidate();
    }, 'ns-issues-toggle');
    this.issuesToggle.hidden = true;
    // The Save status area: the issue list, the "Fill in the new …" line, or "Nothing to save yet".
    this.issuesBox = el('div', { class: 'issues alert alert-warning', role: 'alert', hidden: true },
      el('div', { class: 'd-flex flex-wrap align-items-baseline justify-content-between gap-2 mb-1' }, this.issuesHeading, this.issuesToggle),
      this.issuesList);
    root.appendChild(this.issuesBox);
    root.appendChild(el('p', { class: 'lead-copy mt-3' }, HOMEKIT_USAGE));
    // The footer is the last element of the page (SPEC section 11.2, item 20).
    root.appendChild(renderFooter());

    // Touched state per field (SPEC section 11.2, item 15): leaving a control, or changing a select, checkbox
    // or radio, touches the field wrapper the control sits in. Typing alone does not.
    root.addEventListener('focusout', (event) => {
      if (event.target instanceof HTMLElement && event.target.matches('input, select, textarea')) {
        this.touchControl(event.target);
      }
    });
    root.addEventListener('change', (event) => {
      if (event.target instanceof HTMLElement && event.target.matches('select, input[type="checkbox"], input[type="radio"]')) {
        this.touchControl(event.target);
      }
    });
  }

  setOtherBlocks(blocks: Array<Record<string, unknown>>): void {
    this.otherBlocks = blocks;
  }

  renderAll(): void {
    // A loaded (or restored) configuration is the baseline: nothing is ticked on the way in.
    this.syncPresence(false);
    // The on-appearance defaults (SPEC section 5.7) are written before any section is drawn, so the sections render with
    // the entry in place and nothing on the page redraws itself after load without a user action. The entry goes out
    // with the load's own push (each section's rerender pushes).
    if (!this.legacy) {
      this.writeDefaults(validate(this.config));
    }
    this.providersEmpty = this.config.providers.length === 0;
    for (const section of SECTIONS) {
      this.rerender(section.key);
    }
    if (this.legacy) {
      this.lockSections();
    }
    this.revalidate();
  }

  /**
   * Disables every control of every section while the loaded configuration cannot be represented (SPEC section
   * 11.2, item 26), except Download backup, Download backup without credentials and Reset plugin to fresh install.
   * Disclosures stay openable so the Settings > Advanced buttons can be reached; the Reset modal is created
   * outside the sections when it opens, so its own controls are untouched.
   */
  private lockSections(): void {
    for (const container of this.containers.values()) {
      container.classList.add('ns-locked');
      for (const control of container.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement | HTMLButtonElement>(
        'input, select, textarea, button',
      )) {
        if (!control.classList.contains('ns-legacy-allowed')) {
          control.disabled = true;
        }
      }
    }
  }

  replaceConfig(config: UiConfig, reason?: 'restore' | 'reset'): void {
    this.config = config;
    this.touched.clear();
    this.shown.clear();
    // Reset (or a restore) replaces a configuration the editor could not represent with one it can: the page becomes an ordinary one.
    this.legacy = undefined;
    this.legacyNotice.remove();
    if (reason === 'reset') {
      // A draft never survives a Reset confirm (SPEC section 11.2, item 23).
      clearDraft();
    }
    this.renderAll();
    this.justReset = reason === 'reset';
    this.revalidate();
  }

  rerender(section: Section, refs = false): void {
    const container = this.containers.get(section);
    if (!container) {
      return;
    }
    // Before anything is drawn, so a switch card redrawn below already shows a channel this change made present.
    this.syncPresence(true);
    clear(container);
    // A section redrawn after Reset is an ordinary one again; `lockSections` marks it while the notice shows.
    container.classList.remove('ns-locked');
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
    if (refs && section !== 'settings') {
      // The Default provider dropdowns under Settings follow the providers (SPEC section 11.2, item 25).
      this.rerender('settings');
    }
    this.changed();
  }

  changed(refs = false): void {
    this.justReset = false;
    this.syncPresence(true);
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

  pendingDefaultPrompt(channel: Channel): UiProvider | undefined {
    return this.pendingPrompts.get(channel);
  }

  chooseDefault(channel: Channel, id?: string): void {
    this.pendingPrompts.delete(channel);
    if (id === undefined) {
      // Keep: the entry written on appearance stands; only the prompt goes.
      this.revalidate();
      return;
    }
    this.config.defaultProviders[channel] = id;
    this.changed(true);
    this.rerender('settings');
  }

  /**
   * Platform defaults written on appearance (SPEC section 5.7): the moment a channel has two or more validated providers
   * and `defaultProviders[channel]` names none of the providers, the current fallback (the first validated provider in
   * configuration order) is written, so the configuration is fully determined whether or not the prompt is answered.
   * The prompt is then shown on the last validated provider's card (the one just added, in the usual case) until it is
   * answered. Startup's fallback warning is left to hand-edited configurations.
   */
  private syncDefaults(issues: UiIssue[]): void {
    if (this.writeDefaults(issues)) {
      // The Settings dropdown and the switch editors' "Platform default" options follow; the entry goes out with the next push.
      this.scheduleSwitchRefresh();
      this.push();
    }
  }

  /** The write behind `syncDefaults`, without the redraw or the push: what the initial load runs before drawing. Returns true when an entry was written. */
  private writeDefaults(issues: UiIssue[]): boolean {
    const valid = validProviders(this.config, issues);
    let written = false;
    for (const channel of CHANNELS) {
      const pending = this.pendingPrompts.get(channel);
      if (pending && !this.config.providers.includes(pending)) {
        this.pendingPrompts.delete(channel);
      }
      const candidates = providersForChannel(valid, channel);
      if (candidates.length < 2) {
        continue;
      }
      // Resolved against every provider, so an entry naming a provider whose card is momentarily invalid is left alone.
      if (resolveDefaultProvider(channel, this.config.providers, this.config.defaultProviders).source === 'stored') {
        continue;
      }
      this.config.defaultProviders[channel] = candidates[0].id.trim();
      this.pendingPrompts.set(channel, candidates[candidates.length - 1]);
      written = true;
    }
    return written;
  }

  /**
   * Compares every switch's present channels with the last pass (SPEC section 11.2, item 8): with `tick`, a channel
   * that became present since then is ticked, wherever the change came from (this card, a group card, a provider
   * card, a restore). A switch seen for the first time (just added, or a copy) keeps its ticks as they are and only
   * sets its baseline. Returns true when something was ticked.
   */
  private syncPresence(tick: boolean): boolean {
    let ticked = false;
    for (const s of this.config.switches) {
      const present = presentChannels(this.config, s);
      const before = this.presence.get(s);
      if (before && tick) {
        for (const channel of present) {
          if (!before.has(channel) && !s.channels[channel]) {
            s.channels[channel] = true;
            if (s.customize && !s.bodies[channel]) {
              // Under Customize each channel has its own message; a new one starts as a copy of the shared message.
              s.bodies[channel] = s.body;
            }
            ticked = true;
          }
        }
      }
      this.presence.set(s, new Set(present));
    }
    return ticked;
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

  entryRemoved(listPath: string, index: number): void {
    const prefix = `${listPath}[`;
    const next = new Set<string>();
    for (const path of this.touched) {
      if (!path.startsWith(prefix)) {
        next.add(path);
        continue;
      }
      const match = /^(\d+)\](.*)$/.exec(path.slice(prefix.length));
      if (!match) {
        next.add(path);
        continue;
      }
      const n = Number(match[1]);
      if (n < index) {
        next.add(path);
      } else if (n > index) {
        next.add(`${prefix}${n - 1}]${match[2]}`);
      }
      // n === index: the removed entry's fields are forgotten.
    }
    this.touched.clear();
    for (const path of next) {
      this.touched.add(path);
    }
    // The inline messages are redrawn from the new indices on the next validation pass.
    this.shown.clear();
  }

  /**
   * Marks the field wrapper around `control` as touched and redraws the inline messages. A field that was
   * touched before is redrawn too: leaving it is what lets an error typed while it had focus appear.
   */
  private touchControl(control: HTMLElement): void {
    const field = control.closest<HTMLElement>('[data-path]');
    const path = field?.dataset.path;
    if (!path) {
      return;
    }
    this.touched.add(path);
    this.revalidate();
  }

  touchFields(paths: string[]): void {
    for (const path of paths) {
      this.touched.add(path);
    }
    this.revalidate();
  }

  /** Every field on the page counts as touched (a restored draft: SPEC section 11.2, item 23). */
  private touchAll(): void {
    const paths: string[] = [];
    for (const node of this.root.querySelectorAll<HTMLElement>('[data-path]')) {
      if (node.dataset.path) {
        paths.push(node.dataset.path);
      }
    }
    this.touchFields(paths);
  }

  /**
   * An issue list entry was clicked (SPEC section 11.2, item 15): the field counts as touched so its message
   * shows, the page scrolls to it, and it takes focus. A field under a collapsed disclosure is opened first.
   */
  private jumpTo(path: string): void {
    this.touched.add(path);
    this.revalidate();
    const node = this.root.querySelector<HTMLElement>(`[data-path="${CSS.escape(path)}"]`);
    if (!node) {
      return;
    }
    for (let details = node.closest('details'); details; details = details.parentElement?.closest('details') ?? null) {
      details.open = true;
    }
    node.scrollIntoView({ block: 'center', behavior: 'smooth' });
    const focusable = [...node.querySelectorAll<HTMLElement>('input, select, textarea, button')].find((candidate) => {
      return !(candidate as HTMLInputElement).disabled && candidate.getClientRects().length > 0;
    });
    focusable?.focus({ preventScroll: true });
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
      }
      // The Default provider dropdowns under Settings name providers too. The redraw keeps every disclosure in the
      // section (Advanced included) as open or closed as the user left it, and is skipped while a control inside
      // Settings has focus, so it never pulls the section out from under the user.
      const settings = this.containers.get('settings');
      if (settings && !settings.contains(document.activeElement)) {
        const open = [...settings.querySelectorAll('details')].map((details) => details.open);
        clear(settings);
        renderSettings(this, settings);
        [...settings.querySelectorAll('details')].forEach((details, i) => {
          details.open = open[i] ?? details.open;
        });
      }
      this.revalidate();
    }, 400);
  }

  private push(): void {
    if (this.legacy) {
      // Nothing the editor holds describes the stored configuration; it is neither pushed nor kept as a draft (SPEC section 11.2, item 26).
      return;
    }
    if (this.pushTimer !== undefined) {
      window.clearTimeout(this.pushTimer);
    }
    this.pushTimer = window.setTimeout(() => {
      this.pushTimer = undefined;
      const block = exportConfig(this.config);
      const blocks = [block, ...this.otherBlocks];
      // The in-progress configuration is kept as a draft for the next load (SPEC section 11.2, item 23),
      // except right after a Reset, which never leaves a draft behind.
      if (!this.justReset) {
        saveDraft(block);
      }
      window.homebridge.updatePluginConfig(blocks).catch((err: unknown) => {
        toastError(`Could not update the configuration: ${err instanceof Error ? err.message : String(err)}`);
      });
    }, 150);
  }

  /** Shows the recovery banner for a draft that differs from the saved configuration. */
  private offerDraft(draft: Draft): void {
    const hide = (): void => {
      this.draftBanner.hidden = true;
      clear(this.draftBanner);
    };
    const restore = button(DRAFT.restore, () => {
      hide();
      this.replaceConfig(readConfig(draft.config), 'restore');
      this.touchAll();
    }, 'btn btn-primary btn-sm ns-draft-restore');
    const discard = button(DRAFT.discard, () => {
      clearDraft();
      hide();
    }, 'btn btn-outline-secondary btn-sm ns-draft-discard');
    this.draftBanner.appendChild(el('span', { class: 'flex-grow-1 ns-draft-message' }, DRAFT.message));
    this.draftBanner.appendChild(el('span', { class: 'd-inline-flex gap-2' }, restore, discard));
    this.draftBanner.hidden = false;
  }

  /** The card paths (`providers[2]`) of fresh items, with the kind of each for the "Fill in the new …" line. */
  private freshCards(): Array<{ path: string; kind: string }> {
    const out: Array<{ path: string; kind: string }> = [];
    this.config.providers.forEach((p, i) => this.fresh.has(p) && out.push({ path: `providers[${i}]`, kind: 'provider' }));
    this.config.groups.forEach((g, i) => this.fresh.has(g) && out.push({ path: `groups[${i}]`, kind: 'group' }));
    this.config.switches.forEach((s, i) => this.fresh.has(s) && out.push({ path: `switches[${i}]`, kind: 'switch' }));
    return out;
  }

  /** Issues on untouched cards are held back from the list; they still keep Save disabled. */
  private splitIssues(issues: UiIssue[]): { listed: UiIssue[]; held: UiIssue[]; fresh: Array<{ path: string; kind: string }> } {
    const fresh = this.freshCards();
    const onFresh = (issue: UiIssue): boolean => fresh.some((card) => underPath(issue.path, card.path));
    return { listed: issues.filter((issue) => !onFresh(issue)), held: issues.filter(onFresh), fresh };
  }

  /** True when the issue's own field or one of the fields it references has been touched. */
  private revealed(issue: UiIssue): boolean {
    for (const path of this.touched) {
      if (underPath(path, issue.path) || issue.related?.some((prefix) => underPath(path, prefix))) {
        return true;
      }
    }
    return false;
  }

  private revalidate(): void {
    if (this.legacy) {
      // The stored configuration is not represented, so there is nothing to validate; Save stays disabled until Reset (SPEC section 11.2, item 26).
      this.issuesBox.hidden = true;
      setSaveEnabled(false);
      return;
    }
    const all = validate(this.config);
    this.syncDefaults(all);
    const { listed, held, fresh } = this.splitIssues(all);
    this.markIssues(all);
    for (const node of this.root.querySelectorAll<ValidationListener>('.ns-on-validate')) {
      node.nsOnValidate?.(all);
    }
    // One entry per field, each a link that scrolls to the field, marks it touched and focuses it (SPEC section 11.2, item 15).
    clear(this.issuesList);
    const byPath = new Map<string, UiIssue>();
    for (const issue of listed) {
      if (!byPath.has(issue.path)) {
        byPath.set(issue.path, issue);
      }
    }
    const entry = (issue: UiIssue): HTMLElement => {
      const link = button('', () => this.jumpTo(issue.path), 'btn btn-link btn-sm p-0 ns-link-button ns-issue-link text-start');
      link.appendChild(el('strong', {}, `${issue.label}: `));
      link.appendChild(document.createTextNode(issue.message));
      link.setAttribute('data-issue-path', issue.path);
      return el('li', {}, link);
    };
    for (const issue of byPath.values()) {
      this.issuesList.appendChild(entry(issue));
    }
    const nothingToSave = all.length === 0 && this.config.providers.length === 0 && this.config.groups.length === 0 && this.config.switches.length === 0;
    this.issuesToggle.hidden = true;
    this.issuesList.hidden = false;
    if (byPath.size > 0) {
      // Past three entries the box collapses to a one-line count with an expand toggle.
      const collapsible = byPath.size > ISSUES.collapseAfter;
      const collapsed = collapsible && !this.issuesExpanded;
      this.issuesHeading.textContent = collapsed ? ISSUES.count(byPath.size) : ISSUES.heading;
      this.issuesList.hidden = collapsed;
      this.issuesToggle.hidden = !collapsible;
      this.issuesToggle.textContent = collapsed ? ISSUES.showAll : ISSUES.hide;
      this.issuesToggle.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
      this.issuesBox.className = 'issues alert alert-warning';
      this.issuesBox.setAttribute('role', 'alert');
    } else if (held.length > 0) {
      // Nothing to fix yet, only cards nobody has touched: say why Save is still disabled without listing errors.
      const kinds = [...new Set(held.map((issue) => fresh.find((card) => underPath(issue.path, card.path))?.kind ?? 'card'))];
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

  /** True when the field wrapper holds a value worth a green check: a non-empty input or textarea, or a select. */
  private hasValue(node: HTMLElement): boolean {
    for (const control of node.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(CONTROLS)) {
      if (control instanceof HTMLInputElement && control.type === 'checkbox') {
        return false;
      }
      return control.value.trim().length > 0;
    }
    return false;
  }

  /**
   * Draws the inline state of every field (SPEC section 11.2, item 15): the first issue on a touched field as
   * a message under it, a green check on a touched field that passes, nothing on an untouched field. The field
   * that has focus never gains a message; one it already shows is kept until validation clears it.
   */
  private markIssues(issues: UiIssue[]): void {
    const active = document.activeElement instanceof HTMLElement ? document.activeElement.closest<HTMLElement>('[data-path]') : null;
    const activePath = active?.dataset.path;
    const byPath = new Map<string, UiIssue>();
    for (const issue of issues) {
      if (!byPath.has(issue.path)) {
        byPath.set(issue.path, issue);
      }
    }
    const shown = new Map<string, string>();
    for (const node of this.root.querySelectorAll<HTMLElement>('[data-path]')) {
      const path = node.dataset.path ?? '';
      const issue = byPath.get(path);
      let message: string | undefined;
      if (issue && this.revealed(issue)) {
        message = path === activePath ? this.shown.get(path) : issue.message;
      }
      const feedback = node.querySelector<HTMLElement>(':scope > .invalid-feedback');
      const controls = node.querySelectorAll<HTMLElement>(CONTROLS);
      if (message !== undefined) {
        shown.set(path, message);
        node.classList.add('has-issue');
        if (feedback) {
          // A phone row explains its own parse failure under the number; the generic message would repeat it.
          const ownMessage = node.querySelector<HTMLElement>(':scope > .address-row-controls .phone-feedback.text-danger');
          feedback.textContent = ownMessage?.textContent ? '' : message;
        }
        for (const control of controls) {
          control.classList.add('is-invalid');
          control.classList.remove('ns-valid');
        }
        // An issue on a field under a collapsed disclosure (the ID under Advanced) would otherwise be invisible.
        for (let details = node.closest('details'); details; details = details.parentElement?.closest('details') ?? null) {
          details.open = true;
        }
        continue;
      }
      node.classList.remove('has-issue');
      if (feedback) {
        feedback.textContent = '';
      }
      const valid = !issue && this.touched.has(path) && this.hasValue(node);
      for (const control of controls) {
        control.classList.remove('is-invalid');
        control.classList.toggle('ns-valid', valid && !(control instanceof HTMLInputElement && control.type === 'checkbox'));
      }
    }
    this.shown = shown;
  }
}

/** True when the stored platform block carries a defaultCountry of its own. */
function hasSavedCountry(raw: unknown): boolean {
  return typeof raw === 'object' && raw !== null && typeof (raw as { defaultCountry?: unknown }).defaultCountry === 'string'
    && (raw as { defaultCountry: string }).defaultCountry.trim().length > 0;
}

/** The country of the Homebridge host's time zone, asked from the UI server (SPEC section 11.2, item 21). */
async function hostCountry(): Promise<string | undefined> {
  try {
    const result = await window.homebridge.request('/host-timezone', {}) as { ok?: unknown; timeZone?: unknown } | undefined;
    if (!result || result.ok !== true) {
      return undefined;
    }
    const country = timeZoneCountry(result.timeZone);
    return country && isCountry(country) ? country : undefined;
  } catch {
    return undefined;
  }
}

/**
 * A draft that differs from the configuration the page is about to show, when there is one. A draft equal
 * to it means the changes were saved (or nothing changed) and is removed.
 */
function pendingDraft(config: UiConfig): Draft | undefined {
  const draft = readDraft();
  if (!draft) {
    return undefined;
  }
  if (stableStringify(exportConfig(readConfig(draft.config))) === stableStringify(exportConfig(config))) {
    clearDraft();
    return undefined;
  }
  return draft;
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
    // First load with no saved default country: the browser locale's region, else the country of the
    // Homebridge host's time zone, else US. A saved value is never overridden (SPEC section 11.2, item 21).
    if (!hasSavedCountry(raw)) {
      config.defaultCountry = localeCountry(navigator.language) ?? (await hostCountry()) ?? 'US';
    }
    // A switch with more than one action on the same channel cannot be shown (SPEC section 11.2, item 26): the block
    // is kept as loaded for the backups, the notice is shown, and no draft is offered over it.
    const legacyNames = legacySwitches(raw);
    const legacy: LegacyConfig | undefined = legacyNames.length > 0 && raw && typeof raw === 'object'
      ? { block: raw as Record<string, unknown>, switches: legacyNames } : undefined;
    const page = new Page(config, root, legacy ? undefined : pendingDraft(config), legacy);
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
