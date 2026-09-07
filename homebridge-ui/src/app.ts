import type { UiConfig } from './model.js';

export type Section = 'providers' | 'groups' | 'switches' | 'settings';

/** What a section needs from the page: the shared config and a way to report changes. */
export interface App {
  config: UiConfig;
  /**
   * A value changed. The config is pushed to the Homebridge UI and revalidated.
   * `refs` means provider or group ids, names, types or senders changed, so the Switches section re-renders its dropdowns.
   */
  changed(refs?: boolean): void;
  /** Items were added or removed, or a type changed: re-render the section (and the Switches section when `refs`). */
  rerender(section: Section, refs?: boolean): void;
  /** Replaces the whole configuration (restore from backup, reset) and re-renders every section. */
  replaceConfig(config: UiConfig): void;
  /**
   * Marks a provider, group or switch that was just added. Its card shows placeholders and no errors
   * until a field in it is touched (SPEC section 11.2, item 15).
   */
  addFresh(item: object): void;
  /** Hooks a card to its item: while the item is fresh, the first focusout or change inside the card reveals its errors. */
  watchCard(card: HTMLElement, item: object): void;
}
