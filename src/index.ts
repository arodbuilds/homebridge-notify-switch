import type { API } from 'homebridge';

import { NotifySwitchPlatform } from './platform.js';
import { PLATFORM_NAME } from './settings.js';

/**
 * Registers the Notify Switch dynamic platform with Homebridge.
 */
export default (api: API): void => {
  api.registerPlatform(PLATFORM_NAME, NotifySwitchPlatform);
};
