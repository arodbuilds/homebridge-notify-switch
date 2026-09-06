import type { CharacteristicValue, PlatformAccessory, Service } from 'homebridge';

import type { NotifySwitchPlatform } from './platform.js';
import { PLUGIN_VERSION, SWITCH_RESET_DELAY_MS } from './settings.js';
import { buildTemplateVariables, renderTemplate, stripLineBreaks } from './template.js';
import type { Provider, RecipientResult, ResolvedAction, ResolvedSwitch } from './types.js';
import { HAP_NAME_MAX_LENGTH } from './patterns.js';

const FAILURE_SENSOR_SUBTYPE = 'failure';

interface ActionOutcome {
  action: ResolvedAction;
  results: RecipientResult[];
}

/**
 * One HomeKit switch (SPEC sections 7 and 9). Always reads as off; turning it on fires the
 * configured actions and the switch flips itself back off after one second.
 */
export class NotifySwitchAccessory {
  private readonly service: Service;
  private sensor?: Service;
  private on = false;
  private sensorOpen = false;
  private lastSendAt = 0;
  private resetTimer?: NodeJS.Timeout;
  private sensorTimer?: NodeJS.Timeout;
  private readonly label: string;

  constructor(
    private readonly platform: NotifySwitchPlatform,
    private readonly accessory: PlatformAccessory,
    private readonly config: ResolvedSwitch,
    private readonly providers: ReadonlyMap<string, Provider>,
  ) {
    const { Service, Characteristic } = platform;
    this.label = `[${config.name}]`;

    accessory.getService(Service.AccessoryInformation)
      ?.setCharacteristic(Characteristic.Manufacturer, 'arodbuilds')
      .setCharacteristic(Characteristic.Model, 'Notify Switch')
      .setCharacteristic(Characteristic.SerialNumber, config.id)
      .setCharacteristic(Characteristic.FirmwareRevision, PLUGIN_VERSION);

    this.service = accessory.getService(Service.Switch) ?? accessory.addService(Service.Switch);
    this.service.setCharacteristic(Characteristic.Name, config.name);
    this.service.getCharacteristic(Characteristic.On)
      .onGet(() => this.on)
      .onSet((value: CharacteristicValue) => this.handleSet(value));
    this.service.updateCharacteristic(Characteristic.On, false);

    this.configureFailureSensor();
  }

  /** Adds or removes the optional ContactSensor service to match the configuration (SPEC section 9). */
  private configureFailureSensor(): void {
    const { Service, Characteristic } = this.platform;
    const existing = this.accessory.getServiceById(Service.ContactSensor, FAILURE_SENSOR_SUBTYPE)
      ?? this.accessory.getService(Service.ContactSensor);

    if (!this.config.failureSensor) {
      if (existing) {
        this.accessory.removeService(existing);
      }
      return;
    }

    const sensorName = `${this.config.name} Failure`.slice(0, HAP_NAME_MAX_LENGTH).trim();
    this.sensor = existing ?? this.accessory.addService(Service.ContactSensor, sensorName, FAILURE_SENSOR_SUBTYPE);
    this.sensor.setCharacteristic(Characteristic.Name, sensorName);
    this.sensor.getCharacteristic(Characteristic.ContactSensorState)
      .onGet(() => this.sensorState());
    this.sensor.updateCharacteristic(Characteristic.ContactSensorState, this.sensorState());
  }

  private sensorState(): number {
    const { Characteristic } = this.platform;
    return this.sensorOpen
      ? Characteristic.ContactSensorState.CONTACT_NOT_DETECTED
      : Characteristic.ContactSensorState.CONTACT_DETECTED;
  }

  /** HomeKit SET handler. Returns immediately; the send runs in the background (SPEC section 7, step 1). */
  private handleSet(value: CharacteristicValue): void {
    if (value !== true) {
      // Turning the switch off from HomeKit is a no-op.
      this.on = false;
      return;
    }
    this.on = true;
    this.scheduleReset();
    this.flip().catch((err: unknown) => {
      this.platform.log.error(`${this.label} unexpected error while sending: ${err instanceof Error ? err.message : String(err)}`);
    });
  }

  /** Step 8: after one second set On back to false and notify HomeKit. */
  private scheduleReset(): void {
    if (this.resetTimer) {
      clearTimeout(this.resetTimer);
    }
    this.resetTimer = setTimeout(() => {
      this.resetTimer = undefined;
      this.on = false;
      this.service.updateCharacteristic(this.platform.Characteristic.On, false);
    }, SWITCH_RESET_DELAY_MS);
  }

  private async flip(): Promise<void> {
    const log = this.platform.log;

    if (!this.platform.isMasterOn()) {
      log.info(`${this.label} flip suppressed: master switch "${this.platform.masterSwitchName}" is off`);
      return;
    }
    if (!this.config.enabled) {
      log.info(`${this.label} flip suppressed: switch is disabled in the configuration`);
      return;
    }
    const now = Date.now();
    const cooldownMs = this.config.cooldownSeconds * 1000;
    if (cooldownMs > 0 && this.lastSendAt > 0 && now - this.lastSendAt < cooldownMs) {
      const remaining = Math.ceil((cooldownMs - (now - this.lastSendAt)) / 1000);
      log.info(`${this.label} flip ignored: cooldown active, ${remaining}s remaining`);
      return;
    }
    this.lastSendAt = now;

    const vars = buildTemplateVariables(this.config.name, new Date(now));
    const outcomes = await Promise.all(this.config.actions.map((action) => this.runAction(action, vars)));

    let total = 0;
    let failed = 0;
    for (const outcome of outcomes) {
      for (const result of outcome.results) {
        total += 1;
        if (!result.ok) {
          failed += 1;
        }
      }
    }
    const sent = total - failed;
    log.info(`${this.label} ${sent} of ${total} message${total === 1 ? '' : 's'} sent${failed > 0 ? `, ${failed} failed` : ''}`);

    this.evaluateFailure(total, failed);
  }

  private async runAction(action: ResolvedAction, vars: ReturnType<typeof buildTemplateVariables>): Promise<ActionOutcome> {
    const log = this.platform.log;
    const where = `${action.channel} via ${action.providerId}`;
    const body = renderTemplate(action.body, vars);
    const subject = action.subject !== undefined ? stripLineBreaks(renderTemplate(action.subject, vars)) : undefined;

    // Bodies are logged only when debug is on (SPEC section 8, item 4).
    log.debug(`${this.label} ${where}${subject !== undefined ? ` subject "${subject}"` : ''} body: ${body}`);

    const provider = this.providers.get(action.providerId);
    let results: RecipientResult[];
    if (!provider) {
      results = action.recipients.map((recipient) => ({ recipient, ok: false, error: `provider "${action.providerId}" is not available` }));
    } else {
      try {
        results = await provider.send({
          channel: action.channel,
          sender: action.sender,
          recipients: action.recipients,
          subject,
          body,
        });
      } catch (err) {
        // Providers never throw by contract; treat a rejection as a failure for every recipient.
        const error = err instanceof Error ? err.message : String(err);
        results = action.recipients.map((recipient) => ({ recipient, ok: false, error }));
      }
    }

    // Guarantee exactly one result per recipient, whatever the provider returned.
    const byRecipient = new Map(results.map((r) => [r.recipient, r] as const));
    const complete = action.recipients.map((recipient) => byRecipient.get(recipient) ?? { recipient, ok: false, error: 'no result returned by provider' });

    for (const result of complete) {
      const to = log.address(result.recipient, action.channel);
      if (result.ok) {
        log.info(`${this.label} ${where} to ${to}: sent${result.id ? ` (${result.id})` : ''}`);
      } else {
        const error = log.debugEnabled ? result.error : (result.error ?? '').split(result.recipient).join(to);
        log.warn(`${this.label} ${where} to ${to}: failed: ${error || 'unknown error'}`);
      }
    }
    return { action, results: complete };
  }

  /** Step 7: evaluate `failureMode` and update the failure sensor if enabled. */
  private evaluateFailure(total: number, failed: number): void {
    let failure: boolean;
    switch (this.config.failureMode) {
    case 'any':
      failure = failed > 0;
      break;
    case 'all':
      failure = total > 0 && failed === total;
      break;
    case 'off':
      failure = false;
      break;
    }

    if (!this.sensor) {
      return;
    }
    if (failure) {
      this.tripSensor();
    } else if (failed === 0) {
      this.closeSensor('successful send');
    }
  }

  private tripSensor(): void {
    if (this.sensorTimer) {
      clearTimeout(this.sensorTimer);
      this.sensorTimer = undefined;
    }
    this.sensorOpen = true;
    this.sensor?.updateCharacteristic(this.platform.Characteristic.ContactSensorState, this.sensorState());
    this.platform.log.warn(`${this.label} failure sensor tripped`);
    const resetMs = this.config.failureSensorResetSeconds * 1000;
    if (resetMs > 0) {
      this.sensorTimer = setTimeout(() => {
        this.sensorTimer = undefined;
        this.closeSensor(`${this.config.failureSensorResetSeconds}s timeout`);
      }, resetMs);
    }
  }

  private closeSensor(reason: string): void {
    if (this.sensorTimer) {
      clearTimeout(this.sensorTimer);
      this.sensorTimer = undefined;
    }
    if (!this.sensorOpen) {
      return;
    }
    this.sensorOpen = false;
    this.sensor?.updateCharacteristic(this.platform.Characteristic.ContactSensorState, this.sensorState());
    this.platform.log.info(`${this.label} failure sensor reset after ${reason}`);
  }
}
