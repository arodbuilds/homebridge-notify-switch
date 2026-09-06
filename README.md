<p align="center">
<img src="https://github.com/homebridge/branding/raw/latest/logos/homebridge-wordmark-logo-vertical.png" width="150">
</p>

<span align="center">

# Notify Switch

</span>

A [Homebridge](https://homebridge.io) plugin that exposes HomeKit switches which send a message when turned on. Each switch is always off. Turn it on from a HomeKit automation or scene, it sends one or more preset messages through the providers you configured, and it turns itself back off. Any HomeKit event can notify people by SMS, email, or Telegram.

> **Status:** early development. This version sends SMS and email through Twilio, email through SMTP, and messages through Telegram, and has a custom settings UI with connection and send tests. The full specification is in [SPEC.md](./SPEC.md).

## How it works

1. **Provider**: a connection to a messaging service (Twilio, SMTP, or Telegram).
2. **Recipient group**: a named list of people with phone numbers, email addresses, and Telegram chat IDs.
3. **Switch**: a HomeKit switch with one or more actions. Each action sends one message body on one provider to one or more groups.

Configure everything from the Homebridge UI under the plugin settings. You only need one provider, one group, and one switch to start.

## Five-minute Twilio SMS setup

1. In the [Twilio Console](https://console.twilio.com), copy the **Account SID** from the home page.
2. Create a Standard API key under **Account > API keys & tokens**. Copy the **SID** and the **Secret** (the secret is shown once). The Auth Token is deliberately not accepted; an API key can be revoked without rotating your account's master credential.
3. Note a Twilio phone number you own under **Phone Numbers > Manage > Active numbers**. US long codes must be registered for A2P 10DLC or messages will be filtered.
4. In the plugin settings add a Twilio provider with those values, a group with the phone numbers to notify, and a switch with an SMS action.
5. Save, restart Homebridge, and use the switch in a HomeKit automation with **Turn On** as the action.

## Settings UI

Open the plugin settings in the Homebridge UI. The page has three sections, Providers, Recipient Groups and Switches, plus the platform settings at the bottom. Phone numbers are entered with a country dropdown and a national number; they are stored in international format. SMS messages show a live character and segment counter that highlights characters SMS cannot carry. Save stays disabled while the page lists something to fix. If the custom page fails to load, the standard schema form covers every option.

Three buttons contact the outside world:

- **Test connection** on a provider checks the credentials without sending anything. SMTP logs in to the mail server, Twilio reads your account details, Telegram asks the bot who it is. The credentials in the form are used for that one request and are not stored until you click Save.
- **Find chat IDs** on a group asks your Telegram bot for the chats that have messaged it recently and adds one with a click. Send the bot a message first.
- **Test send** on a switch sends the switch's actions to their real recipients after you confirm, and lists the result for each recipient. It ignores the master switch and the cooldown.

## Configuration

The platform block in `config.json` looks like this. The settings UI and the schema form write the same structure.

```json
{
  "platform": "NotifySwitch",
  "name": "Notify Switch",
  "defaultCountry": "US",
  "masterSwitch": { "enabled": true, "name": "Notifications Enabled" },
  "providers": [
    {
      "id": "twilio-main",
      "type": "twilio",
      "name": "Twilio",
      "accountSid": "AC...",
      "apiKeySid": "SK...",
      "apiKeySecret": "...",
      "smsSenders": ["+16785550100"]
    }
  ],
  "groups": [
    { "id": "family", "name": "Family", "sms": ["+16785550101", "+16785550102"] }
  ],
  "switches": [
    {
      "id": "6f1c2a9e-2b1c-4b8f-9d1e-0c5a1e2f3a4b",
      "name": "Water Leak Alert",
      "cooldownSeconds": 60,
      "failureSensor": false,
      "actions": [
        {
          "providerId": "twilio-main",
          "channel": "sms",
          "groups": ["family"],
          "body": "Water detected under the kitchen sink at {{time}}."
        }
      ]
    }
  ]
}
```

Every field is documented in the settings UI. Phone numbers are stored in E.164 format (`+` and country code). A number entered without a leading `+` is normalized using `defaultCountry` and the normalized value is logged once at startup.

### Template variables

Available in `body` and `subject`: `{{switchName}}`, `{{time}}` (local HH:mm), `{{date}}` (local YYYY-MM-DD), and `{{datetime}}` (local ISO 8601 without zone). Unknown variables are left as typed. Times use the Homebridge host's time zone.

### Master switch

A platform-level switch, "Notifications Enabled" by default, appears in the Home app. While it is off no switch sends anything and each flip is logged as suppressed. Its state survives a Homebridge restart.

### Cooldown and failure sensor

`cooldownSeconds` sets the minimum time between sends for a switch, so an automation that fires repeatedly does not resend the same message. Set `failureSensor` to add a contact sensor to the switch's accessory. It opens when a send fails according to `failureMode` (`any`, `all`, or `off`) and closes on the next fully successful send or after `failureSensorResetSeconds`. Use it in a HomeKit automation to be told when a message did not go out.

### Startup validation

The plugin checks the whole configuration when Homebridge starts and logs every problem with its field path, for example:

```
switches[0].actions[0].providerId: no provider with id "twillio-main" (did you mean "twilio-main"?)
```

While there are errors nothing is registered. Cached accessories are left in place so your HomeKit automations are not lost while you fix a typo.

## Child bridge

Running this plugin as a [child bridge](https://github.com/homebridge/homebridge/wiki/Child-Bridges) is recommended. A slow or unreachable messaging service then cannot affect your other accessories.

## Security notes

- Credentials live in `config.json` like every Homebridge plugin. Homebridge UI backups contain `config.json` and should be treated as containing secrets.
- To keep secrets out of `config.json`, set `credentialsFile` on a provider to the path of a JSON file, relative to the Homebridge storage directory. Its keys override the provider's secret fields: `accountSid`, `apiKeySid` and `apiKeySecret` for Twilio, `username` and `password` for SMTP, `botToken` for Telegram. The file is read once at startup; a missing or malformed file is reported as a configuration error and nothing is registered. Example: `{ "apiKeySecret": "..." }` in `notify-switch-twilio.json` with `"credentialsFile": "notify-switch-twilio.json"` on the provider.
- Twilio accepts API keys only, never the Auth Token. SMTP setups should use an app password.
- Credentials are never written to the log at any level. Phone numbers and email addresses are partially masked at info level, and message bodies are logged only when `debug` is on.
- TLS certificate verification cannot be disabled.

## Troubleshooting

- **Nothing appears in HomeKit**: look for lines starting with a field path in the Homebridge log. The configuration has errors and nothing is registered until they are fixed.
- **The switch flips but nothing is sent**: check that the master switch is on, the switch is enabled, and the cooldown has expired. Each suppressed flip is logged at info level.
- **Twilio reports an error code**: the code and Twilio's message are logged at warn level. Look the code up at https://www.twilio.com/docs/api/errors.
- **SMTP fails with EAUTH**: most providers require an app password rather than your login password. **ECONNECTION or ETIMEDOUT** usually means the wrong port or security setting; port 465 pairs with SSL and port 587 with STARTTLS.
- **Telegram error 403**: the recipient has not started a chat with the bot, or blocked it. Open the bot in Telegram and send it any message. **Error 400** means the chat id is wrong or the message is not valid for the selected parse mode.
- Turn on `debug` in the plugin settings for full addresses and message bodies in the log.

## Development

```shell
npm install
npm run build
npm run lint
npm test        # builds, then runs the harness in test/harness against dist with mocked fetch and SMTP
npm run watch   # builds, links, and starts Homebridge with test/hbConfig
```

To try the settings UI, install the Homebridge UI into the dev instance once (`npm install --no-save homebridge-config-ui-x`), then `npm run watch` and open http://localhost:8581 (the dev config runs it without login). The settings page is built from `homebridge-ui/src` into `homebridge-ui/public/index.js` by `npm run build:ui`; edit, rebuild, and reopen the plugin settings to see changes. The server side lives in `src/ui` and is started by `homebridge-ui/server.js`.

## Changelog

See [CHANGELOG.md](./CHANGELOG.md).
