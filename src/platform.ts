import type { API, Characteristic, DynamicPlatformPlugin, Logging, PlatformAccessory, PlatformConfig, Service } from 'homebridge';

import { PluginLogger } from './logging.js';
import { MasterSwitchAccessory } from './masterSwitchAccessory.js';
import { PLATFORM_NAME, PLUGIN_NAME } from './settings.js';
import { NotifySwitchAccessory } from './switchAccessory.js';
import type { Provider, ResolvedSwitch } from './types.js';
import { DEFAULT_MASTER_SWITCH_NAME, validateConfig } from './validation.js';

/** Stable key the master switch accessory UUID is derived from. */
const MASTER_SWITCH_KEY = `${PLUGIN_NAME}:master-switch`;

interface SwitchContext {
  switchId?: string;
  master?: boolean;
}

/**
 * Notify Switch dynamic platform (SPEC section 4). Validates the platform block on startup, registers
 * one accessory per switch keyed on the switch id, removes cached accessories that are no longer
 * configured, and exposes the optional master switch. Never throws.
 */
export class NotifySwitchPlatform implements DynamicPlatformPlugin {
  public readonly Service: typeof Service;
  public readonly Characteristic: typeof Characteristic;
  public readonly log: PluginLogger;

  /** Accessories restored from the Homebridge cache, keyed by UUID. */
  private readonly cached = new Map<string, PlatformAccessory>();
  private readonly switches = new Map<string, NotifySwitchAccessory>();
  private master?: MasterSwitchAccessory;
  public masterSwitchName = DEFAULT_MASTER_SWITCH_NAME;

  constructor(
    logging: Logging,
    public readonly config: PlatformConfig,
    public readonly api: API,
  ) {
    this.Service = api.hap.Service;
    this.Characteristic = api.hap.Characteristic;
    this.log = new PluginLogger(logging, config?.debug === true);

    this.api.on('didFinishLaunching', () => {
      this.start().catch((err: unknown) => {
        this.log.error(`startup failed: ${err instanceof Error ? err.message : String(err)}`);
      });
    });
  }

  /** Called by Homebridge for each accessory restored from disk, before didFinishLaunching. */
  configureAccessory(accessory: PlatformAccessory): void {
    this.log.debug(`restoring cached accessory "${accessory.displayName}"`);
    this.cached.set(accessory.UUID, accessory);
  }

  /** True when sends are allowed by the master switch (or when no master switch is exposed). */
  isMasterOn(): boolean {
    return this.master ? this.master.isOn : true;
  }

  private async start(): Promise<void> {
    const result = await validateConfig(this.config, this.log);

    for (const notice of result.notices) {
      this.log.info(notice);
    }
    let errors = 0;
    for (const issue of result.issues) {
      const line = issue.path ? `${issue.path}: ${issue.message}` : issue.message;
      if (issue.level === 'error') {
        errors += 1;
        this.log.error(line);
      } else {
        this.log.warn(line);
      }
    }

    if (!result.config || !result.switches || !result.providers) {
      this.log.error(`Configuration has ${errors} error${errors === 1 ? '' : 's'}; no accessories will be registered until it is fixed. ` +
        'Cached accessories are left untouched so HomeKit automations are not lost.');
      return;
    }

    const keep = new Set<string>();
    this.registerMasterSwitch(result.config.masterSwitch, keep);
    for (const sw of result.switches) {
      this.registerSwitch(sw, result.providers, keep);
    }
    this.removeStale(keep);

    const count = this.switches.size;
    this.log.info(`Registered ${count} switch${count === 1 ? '' : 'es'}${this.master ? ` and master switch "${this.masterSwitchName}"` : ''}`);
  }

  private registerMasterSwitch(masterConfig: { enabled: boolean; name: string }, keep: Set<string>): void {
    if (!masterConfig.enabled) {
      return;
    }
    this.masterSwitchName = masterConfig.name;
    const uuid = this.api.hap.uuid.generate(MASTER_SWITCH_KEY);
    keep.add(uuid);
    const accessory = this.obtainAccessory(uuid, masterConfig.name, { master: true });
    this.master = new MasterSwitchAccessory(this, accessory, masterConfig.name);
  }

  private registerSwitch(sw: ResolvedSwitch, providers: Map<string, Provider>, keep: Set<string>): void {
    // The accessory UUID is derived from the switch id, never the name (SPEC section 4, item 3).
    const uuid = this.api.hap.uuid.generate(sw.id);
    keep.add(uuid);
    const accessory = this.obtainAccessory(uuid, sw.name, { switchId: sw.id });
    this.switches.set(sw.id, new NotifySwitchAccessory(this, accessory, sw, providers));
    this.log.debug(`configured switch "${sw.name}" (${sw.id}) with ${sw.actions.length} action(s)`);
  }

  /** Reuses the cached accessory for `uuid` (renaming it if needed) or creates and registers a new one. */
  private obtainAccessory(uuid: string, displayName: string, context: SwitchContext): PlatformAccessory {
    const existing = this.cached.get(uuid);
    if (existing) {
      const renamed = existing.displayName !== displayName;
      if (renamed) {
        existing.displayName = displayName;
      }
      Object.assign(existing.context as SwitchContext, context);
      if (renamed) {
        this.log.info(`Renamed accessory to "${displayName}"`);
      }
      this.api.updatePlatformAccessories([existing]);
      return existing;
    }
    this.log.info(`Adding accessory "${displayName}"`);
    const accessory = new this.api.platformAccessory(displayName, uuid);
    Object.assign(accessory.context as SwitchContext, context);
    this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
    this.cached.set(uuid, accessory);
    return accessory;
  }

  /** Unregisters cached accessories whose switch id is no longer in the configuration (SPEC section 4, item 4). */
  private removeStale(keep: Set<string>): void {
    const stale: PlatformAccessory[] = [];
    for (const [uuid, accessory] of this.cached) {
      if (!keep.has(uuid)) {
        stale.push(accessory);
      }
    }
    if (stale.length === 0) {
      return;
    }
    for (const accessory of stale) {
      this.log.info(`Removing accessory "${accessory.displayName}" (no longer configured)`);
      this.cached.delete(accessory.UUID);
    }
    this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, stale);
  }
}
