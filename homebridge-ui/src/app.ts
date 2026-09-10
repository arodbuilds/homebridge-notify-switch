import type { Channel } from '../../src/types.js';
import type { UiConfig, UiProvider } from './model.js';
import type { UiIssue } from './validate.js';

export type Section = 'providers' | 'groups' | 'switches' | 'settings';

/** An element that wants to know the current issues after every validation pass (the Test send gate). */
export interface ValidationListener extends HTMLElement {
  nsOnValidate?(issues: UiIssue[]): void;
}

/**
 * A stored configuration the editor cannot represent (SPEC section 11.2, item 26): a switch with more than one
 * action on the same channel. The page keeps the block as loaded for the backups and shows the upgrade notice;
 * nothing is pushed or saved until Reset plugin to fresh install replaces it.
 */
export interface LegacyConfig {
  /** The platform block exactly as `getPluginConfig` returned it. */
  block: Record<string, unknown>;
  /** The names of the switches that cannot be shown. */
  switches: string[];
}

/** What a section needs from the page: the shared config and a way to report changes. */
export interface App {
  config: UiConfig;
  /** Set while the loaded configuration cannot be represented; cleared by Reset (SPEC section 11.2, item 26). */
  readonly legacy?: LegacyConfig;
  /**
   * A value changed. The config is pushed to the Homebridge UI and revalidated.
   * `refs` means provider or group ids, names, types or senders changed, so the Switches section re-renders its dropdowns.
   */
  changed(refs?: boolean): void;
  /** Items were added or removed, or a type changed: re-render the section (and the Switches section when `refs`). */
  rerender(section: Section, refs?: boolean): void;
  /**
   * Replaces the whole configuration (restore from backup, reset) and re-renders every section.
   * `reason: 'reset'` makes the Save status area read the reset line instead of "Nothing to save yet".
   */
  replaceConfig(config: UiConfig, reason?: 'restore' | 'reset'): void;
  /**
   * Marks the fields at `paths` touched so their errors show inline (SPEC section 11.2, item 15): the secret
   * fields a backup without credentials left empty (item 12).
   */
  touchFields(paths: string[]): void;
  /**
   * Marks a provider, group or switch that was just added. Its card's issues stay out of the issue list
   * until a field in it is touched (SPEC section 11.2, item 15).
   */
  addFresh(item: object): void;
  /** Hooks a card to its item: while the item is fresh, the first focusout or change inside the card lifts the hold. */
  watchCard(card: HTMLElement, item: object): void;
  /**
   * An entry of a list (`providers`, `groups[0].sms`, `switches[1].actions`) was removed: the touched state of
   * the entries after it moves down one index so it keeps following the right fields (SPEC section 11.2, item 15).
   */
  entryRemoved(listPath: string, index: number): void;
  /**
   * The provider whose card asks which provider switches should use for `channel` (SPEC section 11.2, item 25):
   * set while this page wrote `defaultProviders[channel]` on appearance and nobody has answered yet.
   */
  pendingDefaultPrompt(channel: Channel): UiProvider | undefined;
  /** Writes `defaultProviders[channel]` (with `id`), or keeps it (without), and closes the prompt for the channel. */
  chooseDefault(channel: Channel, id?: string): void;
}
