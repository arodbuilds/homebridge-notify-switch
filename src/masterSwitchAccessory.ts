import type { CharacteristicValue, PlatformAccessory, Service } from 'homebridge';

import type { NotifySwitchPlatform } from './platform.js';
import { PLUGIN_VERSION } from './settings.js';

interface MasterContext {
  master?: boolean;
  masterOn?: boolean;
}

/**
 * Platform-level master switch (SPEC section 4, item 6). While it is off, no switch sends anything.
 * Its state is kept in the accessory context so it survives a Homebridge restart.
 */
export class MasterSwitchAccessory {
  private readonly service: Service;
  private on: boolean;

  constructor(
    private readonly platform: NotifySwitchPlatform,
    private readonly accessory: PlatformAccessory,
    private readonly name: string,
  ) {
    const { Service, Characteristic } = platform;
    const context = accessory.context as MasterContext;
    context.master = true;
    this.on = context.masterOn !== false;

    accessory.getService(Service.AccessoryInformation)
      ?.setCharacteristic(Characteristic.Manufacturer, 'arodbuilds')
      .setCharacteristic(Characteristic.Model, 'Notify Switch Master')
      .setCharacteristic(Characteristic.SerialNumber, 'master')
      .setCharacteristic(Characteristic.FirmwareRevision, PLUGIN_VERSION);

    this.service = accessory.getService(Service.Switch) ?? accessory.addService(Service.Switch);
    this.service.setCharacteristic(Characteristic.Name, name);
    this.service.getCharacteristic(Characteristic.On)
      .onGet(() => this.on)
      .onSet((value: CharacteristicValue) => this.setOn(value === true));
    this.service.updateCharacteristic(Characteristic.On, this.on);
  }

  get isOn(): boolean {
    return this.on;
  }

  private setOn(value: boolean): void {
    if (value === this.on) {
      return;
    }
    this.on = value;
    (this.accessory.context as MasterContext).masterOn = value;
    try {
      this.platform.api.updatePlatformAccessories([this.accessory]);
    } catch (err) {
      this.platform.log.debug(`could not persist master switch state: ${err instanceof Error ? err.message : String(err)}`);
    }
    if (value) {
      this.platform.log.info(`Master switch "${this.name}" turned on; switches will send again`);
    } else {
      this.platform.log.info(`Master switch "${this.name}" turned off; all switches are suppressed until it is turned back on`);
    }
  }
}
