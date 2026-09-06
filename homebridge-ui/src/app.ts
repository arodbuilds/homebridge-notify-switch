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
}
