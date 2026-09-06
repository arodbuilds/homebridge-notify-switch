import type { App } from '../app.js';
import { checkboxField, el, selectField, textField } from '../dom.js';
import { countryOptions } from '../phone.js';

/** Platform-level settings (SPEC section 5.1). */
export function renderSettings(app: App, container: HTMLElement): void {
  const c = app.config;
  container.appendChild(el('p', { class: 'section-copy' },
    'Platform-wide options. The default country is used when a phone number is entered without a country code.'));
  container.appendChild(el('div', { class: 'row g-2' },
    el('div', { class: 'col-md-6' }, textField('Name', c.name, (value) => {
      c.name = value;
      app.changed();
    }, { path: 'name', required: true, help: 'Platform display name shown in the Homebridge logs.' })),
    el('div', { class: 'col-md-6' }, selectField('Default Country', c.defaultCountry, countryOptions(), (value) => {
      c.defaultCountry = value;
      // Phone rows default to this country, so redraw the sections that contain them.
      app.rerender('providers');
      app.rerender('groups');
      app.rerender('switches');
      app.changed();
    }, { path: 'defaultCountry', help: 'Phone numbers entered without a country code are treated as numbers from this country.' })),
  ));
  const nameField = textField('Master switch name', c.masterSwitch.name, (value) => {
    c.masterSwitch.name = value;
    app.changed();
  }, { path: 'masterSwitch.name', help: 'Letters, numbers, spaces, and apostrophes only. Must start and end with a letter or number.' });
  nameField.hidden = !c.masterSwitch.enabled;
  container.appendChild(el('div', { class: 'row g-2' },
    el('div', { class: 'col-md-6' }, checkboxField('Show master switch', c.masterSwitch.enabled, (value) => {
      c.masterSwitch.enabled = value;
      nameField.hidden = !value;
      app.changed();
    }, {
      path: 'masterSwitch.enabled',
      help: 'A single switch in the Home app that turns all notifications on or off. When it is off, no switch sends anything.',
    })),
    el('div', { class: 'col-md-6' }, nameField),
  ));
  container.appendChild(checkboxField('Debug logging', c.debug, (value) => {
    c.debug = value;
    app.changed();
  }, { path: 'debug', help: 'Verbose logging, including message bodies and full recipient addresses. Credentials are never logged, even with this on.' }));
}
