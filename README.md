<p align="center">
<img src="https://github.com/homebridge/branding/raw/latest/logos/homebridge-wordmark-logo-vertical.png" width="150">
</p>

<span align="center">

# Notify Switch

</span>

<!--
verified-by-homebridge: this plugin has not been through Homebridge verification yet.
Do not claim it. Once the plugin is verified, replace this comment with the badge:
[![verified-by-homebridge](https://badgen.net/badge/homebridge/verified/purple)](https://github.com/homebridge/homebridge/wiki/Verified-Plugins)
-->

[![npm](https://img.shields.io/npm/v/homebridge-notify-switch/beta)](https://www.npmjs.com/package/homebridge-notify-switch)
[![Build and Lint](https://github.com/arodbuilds/homebridge-notify-switch/actions/workflows/build.yml/badge.svg)](https://github.com/arodbuilds/homebridge-notify-switch/actions/workflows/build.yml)

A [Homebridge](https://homebridge.io) plugin that exposes HomeKit switches which send a message when turned on. Turn a switch on from a HomeKit automation or scene, it sends one or more preset messages by SMS, email, or Telegram, and it turns itself back off. Any HomeKit event can notify people.

> **Status:** beta. `0.1.0-beta.1` is the first public release. The configuration format is final and covered by the full specification in [SPEC.md](https://github.com/arodbuilds/homebridge-notify-switch/blob/latest/SPEC.md). Please report problems in the [issue tracker](https://github.com/arodbuilds/homebridge-notify-switch/issues).

## Contents

- [What it does](#what-it-does)
- [Install](#install)
- [Five-minute Twilio SMS setup](#five-minute-twilio-sms-setup)
- [Provider setup guides](#provider-setup-guides)
  - [Twilio (SMS and email)](#twilio-sms-and-email)
  - [SMTP (email through your own mailbox)](#smtp-email-through-your-own-mailbox)
  - [Telegram](#telegram)
- [Recipient groups](#recipient-groups)
- [Switches and actions](#switches-and-actions)
- [Using switches in HomeKit automations](#using-switches-in-homekit-automations)
- [Template variables](#template-variables)
- [Cooldown and master switch](#cooldown-and-master-switch)
- [Failure sensor](#failure-sensor)
- [Keeping secrets out of config.json with credentialsFile](#keeping-secrets-out-of-configjson-with-credentialsfile)
- [Child bridge](#child-bridge)
- [Security notes](#security-notes)
- [Troubleshooting](#troubleshooting)
- [Development](#development)
- [Changelog](#changelog)

## What it does

Notify Switch is built from three things you configure once in the Homebridge UI:

1. **Provider**: a connection to a messaging service. Twilio sends SMS and, with an authenticated domain, email. SMTP sends email through a mailbox you already have, such as Fastmail, Gmail, or iCloud. Telegram sends to a chat through a bot you create.
2. **Recipient group**: a named list of people, with phone numbers for SMS, email addresses for email, and chat IDs for Telegram. You enter each person once and reuse the group everywhere.
3. **Switch**: a HomeKit switch with one or more actions. Each action sends one message body through one provider on one channel to one or more groups.

Every switch is always off in the Home app. When something turns it on, every action fires in parallel, the results are logged, and one second later the switch turns itself off. You only need one provider, one group, and one switch to start.

Things it does not do in this version: receive replies, report delivery status after the provider accepted a message, send MMS or attachments, WhatsApp, or fall back to a second channel when the first fails.

## Install

Requirements: Node.js 22.12 or newer (or 24), and Homebridge 1.6 or newer (2.x included).

While the plugin is in beta, install the `beta` release:

- **Homebridge UI**: on the Plugins page search for `homebridge-notify-switch`, open the plugin's menu, choose **Manage Version**, and pick the newest `beta` version.
- **Command line**: `sudo npm install -g homebridge-notify-switch@beta`

The plugin does nothing until it is configured, and it never registers accessories while the configuration has errors. Running it as a [child bridge](#child-bridge) is recommended.

## Five-minute Twilio SMS setup

1. Sign in to the [Twilio Console](https://console.twilio.com) and copy the **Account SID** from **Account Info** on the home page. It starts with `AC`.
2. Open [API keys & tokens](https://console.twilio.com/us1/account/keys-credentials/api-keys) and create an API key. A **Standard** key works; so does a **Restricted** key with read and write access to Messaging. Copy the **SID** (starts with `SK`) and the **Secret**. The secret is shown once; keep it in a password manager. The Auth Token is deliberately not accepted, because an API key can be revoked without rotating your account's master credential.
3. Open [Active numbers](https://console.twilio.com/us1/develop/phone-numbers/manage/incoming) and copy a Twilio phone number you own, including the country code, for example `+16785550100`. If you send to US numbers, read [A2P 10DLC](#a2p-10dlc-registration-for-us-numbers) below; unregistered US long codes are filtered by the carriers.
4. In the Homebridge UI open the plugin settings and add a **Twilio** provider with those values, then click **Test connection**. Add a **Recipient group** with the phone numbers to notify (pick the country from the dropdown and type the national number). Add a **Switch**, give it a name such as `Water Leak Alert`, and add an **SMS** action on the Twilio provider to that group with a message body.
5. Click **Test send** on the switch to send it for real, then save and restart Homebridge. In the Home app create an automation with a trigger such as a leak sensor detecting water and add the switch with **Turn On** as the action.

## Provider setup guides

Add only the providers you plan to use. Every provider has a **Test connection** button in the settings UI that checks the credentials without sending anything: SMTP logs in to the mail server, Twilio lists one message on your account (a read that both Standard and Messaging-scoped Restricted keys are allowed), and Telegram asks the bot who it is. Credentials in the form are used for that one request and are not stored until you click Save.

### Twilio (SMS and email)

Twilio serves the `sms` channel and, once a domain is authenticated, the `email` channel.

| Field | Where to find it |
| --- | --- |
| `accountSid` | [Console home page](https://console.twilio.com), **Account Info**. Starts with `AC`. |
| `apiKeySid` and `apiKeySecret` | [Account > API keys & tokens](https://console.twilio.com/us1/account/keys-credentials/api-keys). Create a **Standard** key, or a **Restricted** key with read and write access to Messaging. |
| `smsSenders` | [Phone Numbers > Manage > Active numbers](https://console.twilio.com/us1/develop/phone-numbers/manage/incoming). E.164 format with the country code. |
| `messagingServiceSid` | Optional. [Messaging > Services](https://console.twilio.com/us1/develop/sms/services). Starts with `MG`. |
| `emailFrom` | Optional. Required only for the `email` channel. The domain must be authenticated (see below). |

#### API keys

1. Open [API keys & tokens](https://console.twilio.com/us1/account/keys-credentials/api-keys) and click **Create API key**.
2. Give it a name such as `Homebridge` and create it. **Standard** is the simplest choice. A **Restricted** key also works if you grant it read and write access to Messaging; Test connection reads the message list and sending creates messages, so both are needed.
3. Copy the **SID** into `apiKeySid` and the **Secret** into `apiKeySecret`. The secret cannot be shown again; if you lose it, delete the key and create a new one.

A Standard key can send messages but cannot manage the account, and a Restricted key can do only what you grant it. If a key leaks, delete it in the Console and create another; the plugin never asks for the Auth Token, so the account's master credential stays untouched. Full details: [Twilio API keys](https://www.twilio.com/docs/iam/api-keys).

#### Phone numbers

List every Twilio number you want to send from in `smsSenders`. An SMS action with a `sender` uses that number; an action without one uses the provider's only number, or the Messaging Service when `messagingServiceSid` is set. If you need to buy a number, use [Phone Numbers > Manage > Buy a number](https://console.twilio.com/us1/develop/phone-numbers/manage/search) and make sure it is SMS capable.

Trial accounts can only send to phone numbers verified under [Verified Caller IDs](https://console.twilio.com/us1/develop/phone-numbers/manage/verified) and prefix every message with a trial notice. Upgrade the account before relying on it for alerts.

#### A2P 10DLC registration for US numbers

Messages from a standard US long code to US phone numbers must come from a number registered for [A2P 10DLC](https://www.twilio.com/docs/messaging/compliance/a2p-10dlc). Unregistered traffic is blocked by the carriers and shows up in Twilio's message logs with error 30034. Register in the Console under **Messaging > Regulatory Compliance** (a brand, then a campaign, then attach your number to the campaign's Messaging Service). A registered number is normally attached to a Messaging Service, so set `messagingServiceSid` on the provider and omit `sender` on the action. Toll-free numbers use a separate, simpler [toll-free verification](https://www.twilio.com/docs/messaging/compliance/toll-free); numbers outside the US are not affected.

#### Email through Twilio

The `email` channel sends through Twilio's Emails API, which needs an authenticated sending domain.

1. In the Console open **Communications > Email > Domains** and add the domain you want to send from.
2. Add the DNS records Twilio shows to your domain and wait for the domain to show as verified.
3. Set `emailFrom.address` to an address at that domain and `emailFrom.name` to the display name recipients see.

Emails are sent as plain text. An email action on a Twilio provider without `emailFrom` is reported as a configuration error at startup. If you do not own a domain, use an [SMTP provider](#smtp-email-through-your-own-mailbox) instead.

### SMTP (email through your own mailbox)

SMTP serves the `email` channel through any mail account. The plugin sends one message per action with the recipients in `Bcc`, so recipients do not see each other's addresses. TLS certificate verification is always on.

| Field | Value |
| --- | --- |
| `host`, `port`, `security` | Your provider's outgoing server (table below). `ssl` is SMTP over TLS, usually port 465; `starttls` upgrades a plain connection, usually port 587. |
| `username` | Usually your full email address. |
| `password` | Almost always an **app password**, not your login password. |
| `from.address`, `from.name` | An address your provider allows you to send from, and an optional display name. |

| Provider | Host | Port | Security |
| --- | --- | --- | --- |
| Fastmail | `smtp.fastmail.com` | 465 | `ssl` |
| Gmail | `smtp.gmail.com` | 465 | `ssl` |
| iCloud | `smtp.mail.me.com` | 587 | `starttls` |
| Outlook.com | `smtp-mail.outlook.com` | 587 | `starttls` |

#### Fastmail

1. Open [Settings > Privacy & Security > App passwords](https://app.fastmail.com/settings/security/devices) and click **New app password**.
2. Name it `Homebridge`, choose the **SMTP** access scope, and generate it. Copy the password; it is shown once.
3. Use `smtp.fastmail.com`, port `465`, `ssl`, your full Fastmail address as `username`, the app password as `password`, and your Fastmail address (or one of its aliases) as `from.address`.

Fastmail help: [App passwords](https://www.fastmail.help/hc/en-us/articles/360058752854-App-passwords) and [Server names and ports](https://www.fastmail.help/hc/en-us/articles/1500000278342-Server-names-and-ports).

#### Gmail

1. Turn on 2-Step Verification for your Google account if it is not already on; app passwords require it.
2. Open [App passwords](https://myaccount.google.com/apppasswords), enter a name such as `Homebridge`, and click **Create**. Copy the 16-character password without the spaces.
3. Use `smtp.gmail.com`, port `465`, `ssl`, your Gmail address as `username`, the app password as `password`, and your Gmail address as `from.address`. Gmail rewrites `from.address` to your account address unless it is a configured "Send mail as" alias.

Google Workspace accounts may have app passwords disabled by the administrator. Google help: [Sign in with app passwords](https://support.google.com/accounts/answer/185833) and [Gmail SMTP settings](https://support.google.com/mail/answer/7126229).

#### iCloud

1. Sign in at [account.apple.com](https://account.apple.com/account/manage), open **Sign-In and Security > App-Specific Passwords**, and generate one named `Homebridge`. Two-factor authentication must be on.
2. Use `smtp.mail.me.com`, port `587`, `starttls`, your full iCloud address as `username`, the app-specific password as `password`, and your iCloud address (or an alias, or an iCloud+ custom domain address) as `from.address`.

Apple help: [App-specific passwords](https://support.apple.com/102654) and [Mail server settings for iCloud](https://support.apple.com/102525).

#### Outlook.com

1. Turn on two-step verification for your Microsoft account, then open [App passwords](https://account.live.com/proofs/AppPassword) and create one.
2. Use `smtp-mail.outlook.com`, port `587`, `starttls`, your full address as `username`, the app password as `password`, and your Outlook.com address as `from.address`.

Microsoft is retiring password sign-in for third-party apps on personal accounts. If the mail server rejects an app password with `EAUTH`, use Fastmail, Gmail, iCloud, or Twilio for email instead. Microsoft help: [POP, IMAP, and SMTP settings for Outlook.com](https://support.microsoft.com/office/pop-imap-and-smtp-settings-for-outlook-com-d088b986-291d-42b8-9564-9c414e2aa040).

#### Other mail servers

Any server that accepts an authenticated SMTP login works, including a mail relay on your own network, as long as its certificate is valid for the host name you enter. Self-signed certificates are rejected because verification cannot be turned off. Use `security: "none"` only for a server on a trusted network that offers no TLS at all; the password travels in clear text in that case.

### Telegram

Telegram serves the `telegram` channel through a bot you create. Bots cannot start a conversation, so every person and group must message the bot once first.

1. In Telegram open [@BotFather](https://t.me/BotFather), send `/newbot`, and follow the prompts for a display name and a username ending in `bot`.
2. BotFather replies with the bot token, which looks like `123456789:AAF...`. Put it in `botToken`. Treat it as a password; anyone with the token can send as the bot.
3. Open a chat with your new bot and send it any message. For a group chat, add the bot to the group and send a message that mentions it, or type `/start`, so the bot receives the message.
4. In the plugin settings, click **Find chat IDs** on a recipient group. The plugin calls the bot's `getUpdates` and lists every chat that has messaged it, with one-click **Add**. Private chats have positive IDs; groups and channels have negative IDs such as `-1001234567890`.

`parseMode` is `none` by default, so the body is sent as plain text. Choose `markdown` or `html` only if you write bodies in [Telegram's formatting syntax](https://core.telegram.org/bots/api#formatting-options); a body that does not parse in the selected mode is rejected by Telegram with error 400.

If **Find chat IDs** reports error 409, a webhook is set on the bot from another tool, and `getUpdates` cannot be used. Remove it with `deleteWebhook` or create a separate bot for Homebridge. More on bots: [Bots: An introduction for developers](https://core.telegram.org/bots).

## Recipient groups

A group is a named list of people. Each group has three lists: `sms` (phone numbers), `email` (email addresses), and `telegram` (chat IDs). A switch's action sends to whichever list matches its channel, so one `Family` group can serve an SMS action and an email action at the same time.

- Phone numbers are stored in E.164 format, for example `+16785550101`. In the settings UI pick the country from the dropdown and type the national number; pasting a number that already has a country code sets the country for you. A number in `config.json` without a leading `+` is normalized using `defaultCountry` and the normalized value is logged once at startup.
- Email addresses are validated on entry. Telegram chat IDs are numbers, not usernames; use **Find chat IDs** after messaging the bot.
- A group with no addresses is valid but produces a startup warning if a switch uses it.

Group and provider IDs are short slugs suggested from the name. They are how switches refer to groups, so renaming a group in the UI does not break the switches that use it.

## Switches and actions

Each switch appears in the Home app under its `name` and holds one or more actions.

| Field | Meaning |
| --- | --- |
| `name` | Shown in the Home app. Letters, numbers, spaces, and apostrophes; must start and end with a letter or number; at most 64 characters; unique. |
| `enabled` | Default `true`. A disabled switch is still registered so automations keep working, but does nothing when flipped and logs the suppression. |
| `cooldownSeconds` | Minimum seconds between sends, 0 to 86400. `0` disables the cooldown. See [Cooldown and master switch](#cooldown-and-master-switch). |
| `failureMode` | `any` (default), `all`, or `off`. See [Failure sensor](#failure-sensor). |
| `failureSensor`, `failureSensorResetSeconds` | Adds a contact sensor that trips on failure; reset timeout defaults to 300 seconds. |
| `actions` | At least one action. |

Each action has:

| Field | Meaning |
| --- | --- |
| `providerId` | The provider to send through. |
| `channel` | `sms`, `email`, or `telegram`. Must be a channel that provider serves. |
| `sender` | SMS only. One of the provider's `smsSenders`. Omit it when the provider has one number or uses a Messaging Service. |
| `groups` | Recipient groups to send to. |
| `recipients` | Extra individual addresses for this channel, on top of the groups. At least one address must come from `groups` or `recipients`. |
| `subject` | Email only. Defaults to the switch name. Line breaks are removed. |
| `body` | The message. SMS: 1 to 160 characters from the GSM-7 set, so no emoji; the settings UI shows a live character and segment counter and highlights characters SMS cannot carry. Email: up to 10,000 characters of plain text. Telegram: up to 4,096 characters. |

Recipients from every group plus `recipients` are merged and deduplicated before sending. Each SMS and each Telegram message is one request per recipient with at most five in flight per provider; email is one message per action. Every request has a 10 second timeout and one retry.

The **Test send** button on a switch sends its actions to the real recipients after you confirm and lists the result for each recipient. It ignores the master switch and the cooldown, and it works before you save as long as the switch has no validation errors.

The plugin checks the whole configuration when Homebridge starts and logs every problem with its field path, for example:

```
switches[0].actions[0].providerId: no provider with id "twillio-main" (did you mean "twilio-main"?)
```

While there are errors nothing is registered. Cached accessories are left in place, so your HomeKit automations survive while you fix a typo. The settings UI runs the same checks and keeps **Save** disabled while any remain.

<details>
<summary>Example platform block in config.json</summary>

The settings UI and the schema form write this structure. Every field is documented in the settings UI.

```json
{
  "platform": "NotifySwitch",
  "name": "Notify Switch",
  "defaultCountry": "US",
  "masterSwitch": { "enabled": true, "name": "Notifications Enabled" },
  "debug": false,
  "providers": [
    {
      "id": "twilio-main",
      "type": "twilio",
      "name": "Twilio",
      "accountSid": "AC...",
      "apiKeySid": "SK...",
      "apiKeySecret": "...",
      "smsSenders": ["+16785550100"]
    },
    {
      "id": "fastmail",
      "type": "smtp",
      "name": "Fastmail",
      "host": "smtp.fastmail.com",
      "port": 465,
      "security": "ssl",
      "username": "alex@example.com",
      "password": "app-password",
      "from": { "address": "alex@example.com", "name": "Home" }
    },
    {
      "id": "telegram-home",
      "type": "telegram",
      "name": "Telegram",
      "botToken": "123456789:AAF..."
    }
  ],
  "groups": [
    {
      "id": "family",
      "name": "Family",
      "sms": ["+16785550101", "+16785550102"],
      "email": ["a@example.com"],
      "telegram": ["123456789"]
    }
  ],
  "switches": [
    {
      "id": "6f1c2a9e-2b1c-4b8f-9d1e-0c5a1e2f3a4b",
      "name": "Water Leak Alert",
      "enabled": true,
      "cooldownSeconds": 60,
      "failureMode": "any",
      "failureSensor": false,
      "actions": [
        {
          "providerId": "twilio-main",
          "channel": "sms",
          "groups": ["family"],
          "body": "Water detected under the kitchen sink at {{time}}."
        },
        {
          "providerId": "fastmail",
          "channel": "email",
          "groups": ["family"],
          "subject": "Water leak: kitchen",
          "body": "Water detected under the kitchen sink at {{time}} on {{date}}."
        },
        {
          "providerId": "telegram-home",
          "channel": "telegram",
          "groups": ["family"],
          "body": "Water detected under the kitchen sink at {{time}}."
        }
      ]
    }
  ]
}
```

</details>

## Using switches in HomeKit automations

After saving, restart Homebridge. Your switches appear in the Home app in the room you assign them, and you can tap one to send its messages right away.

To send on an event:

1. In the Home app open **Automation** and tap **+**.
2. Choose a trigger: **An Accessory is Controlled** (a leak sensor detects water, a door opens, a smoke detector alarms), **A Sensor Detects Something**, **People Arrive** or **Leave**, or **A Time of Day Occurs**.
3. On the accessories screen select your Notify Switch and make sure its action is **Turn On**.
4. Optionally tap the switch and use **Convert to Shortcut** to add conditions, for example only at night or only when nobody is home.

Scenes work the same way: add the switch to a scene with the state on, and every time the scene runs the messages are sent. The switch turns itself off one second after each send, so an automation that turns it on again later still fires. Turning the switch off from the Home app does nothing.

Since HomeKit only ever sees the switch flip on and off, an automation that fires repeatedly, such as a motion sensor, will send on every trigger. Use [`cooldownSeconds`](#cooldown-and-master-switch) to rate-limit it.

## Template variables

These placeholders can be used in `body` and `subject`:

| Variable | Value |
| --- | --- |
| `{{switchName}}` | The switch's name. |
| `{{time}}` | Local time as `HH:mm`, for example `14:05`. |
| `{{date}}` | Local date as `YYYY-MM-DD`. |
| `{{datetime}}` | Local date and time in ISO 8601 form without a zone, for example `2026-09-06T14:05:00`. |

Times use the Homebridge host's time zone. Anything else inside double braces is left exactly as typed. Variables are expanded when the switch is flipped, so `{{time}}` is the moment the event happened.

## Cooldown and master switch

**Cooldown.** `cooldownSeconds` sets the minimum time between sends for one switch. Flips inside the window are ignored and logged at info level with the remaining time, so a motion sensor that triggers every few seconds sends one message per window instead of dozens. The cooldown is per switch and starts when a send begins; a restart of Homebridge clears it.

**Master switch.** A platform-level switch named `Notifications Enabled` by default appears in the Home app. While it is off, no switch sends anything and every flip is logged as suppressed. Use it as a single kill switch when you are testing automations or having work done at home. Its state survives a Homebridge restart. Rename it with `masterSwitch.name`, or set `masterSwitch.enabled` to `false` to hide it entirely; sends are then never suppressed. **Test send** in the settings UI bypasses the master switch.

## Failure sensor

Set `failureSensor` to `true` on a switch to add a contact sensor to the same accessory, so it shares the switch's room and name in the Home app. The contact opens when a send fails and closes on the next fully successful send from that switch or after `failureSensorResetSeconds` (default 300 seconds).

`failureMode` decides what counts as a failure:

- `any` (default): the sensor trips if any recipient on any channel fails.
- `all`: the sensor trips only if every recipient on every channel fails.
- `off`: the sensor never trips. Failures are still logged.

Use the sensor in a HomeKit automation, for example to flash a light or send a notification through a second switch, so you find out when a message did not go out. Failures are always logged at warn level with the provider's error code and a short message, whether or not the sensor is enabled.

## Keeping secrets out of config.json with credentialsFile

Credentials live in `config.json` like every Homebridge plugin. If you prefer to keep them out of it, and out of Homebridge UI backups and screenshots, set `credentialsFile` on a provider to the path of a JSON file. A relative path is resolved against the Homebridge storage directory (the folder that holds `config.json`, usually `/var/lib/homebridge` or `~/.homebridge`); an absolute path is used as is.

The file's keys override the provider's secret fields:

| Provider | Keys |
| --- | --- |
| `twilio` | `accountSid`, `apiKeySid`, `apiKeySecret` |
| `smtp` | `username`, `password` |
| `telegram` | `botToken` |

Example: `notify-switch-twilio.json` in the storage directory containing `{ "apiKeySecret": "..." }`, with `"credentialsFile": "notify-switch-twilio.json"` on the Twilio provider. Any secret field still present in `config.json` is used for keys the file does not set, and a key that is not a secret field of that provider type is ignored with a warning.

The file is read once at startup, and again when the settings UI runs **Test connection** or **Test send**. A missing or malformed file is reported as a configuration error with the field path and nothing is registered. Make the file readable only by the user Homebridge runs as, for example `chmod 600`.

## Child bridge

Running this plugin as a [child bridge](https://github.com/homebridge/homebridge/wiki/Child-Bridges) is recommended. Sending goes out over the internet, and a slow or unreachable messaging service then cannot delay your other accessories. In the Homebridge UI open the plugin's menu, choose **Bridge Settings**, enable the child bridge, save, restart, and pair the new bridge in the Home app with the QR code shown.

## Security notes

- **Homebridge UI backups contain `config.json`.** A backup archive includes every provider password, API key secret, and bot token you configured inline. Store backups as you would a password file and delete old ones. [`credentialsFile`](#keeping-secrets-out-of-configjson-with-credentialsfile) keeps secrets out of the backup.
- Twilio accepts API keys only, never the Auth Token, so a leaked key can be revoked without touching the account. SMTP setups should use an app password that you can revoke on its own. A Telegram bot token only controls that bot; revoke it with BotFather's `/revoke`.
- Credentials are never written to the log at any level. Phone numbers and email addresses are partially masked at info level (`+1678***0101`, `a***@example.com`), and message bodies are logged only when `debug` is on. Provider errors are reduced to a code and a short message before logging.
- The settings UI's **Test connection**, **Find chat IDs**, and **Test send** use the credentials from the form in memory for that one request and never store, log, or return them. They only connect to the mail host you configured and to Twilio's and Telegram's APIs.
- TLS certificate verification cannot be disabled.
- Email subjects and from names have line breaks removed. Telegram bodies are sent as plain text unless you choose a `parseMode`.
- Cooldown and the master switch limit the damage from a runaway automation.
- The plugin has no analytics, writes no files, and reads only the `credentialsFile` you point it at.

## Troubleshooting

Turn on `debug` in the plugin settings to see full addresses, message bodies, retries, and the response codes behind each failure in the Homebridge log. Every send logs one line per recipient and one summary line per switch:

```
[Water Leak Alert] sms via twilio-main to +1678***0101: sent (SM3f2...)
[Water Leak Alert] 1 of 1 message sent
```

### General

- **Nothing appears in HomeKit after a restart**: look for lines starting with a field path such as `switches[0].actions[0].body` in the log. The configuration has errors and nothing is registered until they are fixed. The settings UI lists the same errors.
- **The switch flips but nothing is sent**: the log says why. `flip suppressed: master switch ... is off` means the master switch is off; `switch is disabled` means `enabled` is false; `cooldown active` means the cooldown has not expired.
- **`request timed out after 10s`**: the provider did not answer within 10 seconds. The plugin retries once. Check the host's internet connection and DNS; on a Raspberry Pi, also check that the clock is right, since TLS fails with a wrong date.
- **The message arrived but a variable was not replaced**: check the spelling; unknown variables are left as typed, and names are case sensitive.

### Twilio

The log line contains Twilio's error code and message, for example `Twilio error 21211: The 'To' number is not a valid phone number`. Look any code up at [twilio.com/docs/api/errors](https://www.twilio.com/docs/api/errors). The most common:

| Code | Meaning | Fix |
| --- | --- | --- |
| 20003 | Authentication failed | The API key SID or secret is wrong, or the key was deleted. Create a new key. If Test connection reports a 403 with this code, the key is a Restricted key without Messaging permissions; grant them or use a Standard key. |
| 20404 | Resource not found | The Account SID does not match the key, or the number is not on this account. |
| 20429 | Too many requests | Twilio rate limited the account. The plugin honors the retry delay once; lower the number of recipients or add a cooldown. |
| 21211 | Invalid `To` number | The recipient number is not a valid phone number in E.164 format. |
| 21606 | `From` is not a valid SMS-capable number | The sender is not a Twilio number on this account, or it cannot send SMS. |
| 21608 | Unverified number on a trial account | Trial accounts can only send to verified numbers. Verify the recipient or upgrade. |
| 21610 | Recipient has opted out | The recipient replied STOP. They must reply START to receive messages again. |
| 21614 | `To` is not a mobile number | Landlines cannot receive SMS. |
| 30034 | Unregistered US number (shown in Twilio's message logs) | Register for [A2P 10DLC](#a2p-10dlc-registration-for-us-numbers). |
| 30032 | Unverified toll-free number (message logs) | Complete toll-free verification. |
| 30007 | Message filtered by the carrier (message logs) | Content flagged as spam, or an unregistered number. |

Twilio accepts a message with HTTP 201 before it is delivered, so carrier-side failures such as 30034 and 30007 do not appear in the Homebridge log. Check [Monitor > Logs > Messaging](https://console.twilio.com/us1/monitor/logs/sms) in the Console when a message is reported as sent but never arrives.

For the email channel, an error naming the domain or the from address means the domain is not authenticated yet, or `emailFrom.address` is not at the authenticated domain. `emailFrom is not configured on this provider` means the field is empty.

### SMTP

The log line contains nodemailer's error code and the server's reply, with your login removed, for example `SMTP EAUTH: 535 5.7.8 Username and Password not accepted`.

| Code | Meaning | Fix |
| --- | --- | --- |
| `EAUTH` | The server rejected the login | Use an app password, not the account password. Check that `username` is the full address. Outlook.com may refuse password logins altogether. |
| `ECONNECTION` | Could not connect | Wrong `host` or `port`, or the port is blocked. Port 465 pairs with `ssl` and port 587 with `starttls`; mixing them fails here or with a timeout. |
| `ETIMEDOUT` | The server did not answer | Same causes as `ECONNECTION`, or the network blocks outgoing mail ports. Some ISPs block port 25; use 465 or 587. |
| `EDNS` | Host name could not be resolved | Typo in `host`, or the host has no DNS. |
| `ESOCKET` | TLS handshake failed | The certificate does not match the host name or is self-signed. Use the host name from your provider's documentation. |
| `EENVELOPE` | The server refused the message | A recipient was rejected (usually a 550 reply) or `from.address` is not allowed for this login. Rejected recipients are reported one by one. |
| `EMESSAGE` | The server refused the message content | Check the reply text; often a size or policy limit. |

Temporary replies (421, 450, 451, 452) and rate limits are retried once after 2 seconds. Gmail limits consumer accounts to about 500 messages a day and returns a 550 reply above that.

### Telegram

| Code | Meaning | Fix |
| --- | --- | --- |
| 400 | Chat not found, or the message was rejected | The chat ID is wrong, or the body does not parse in the selected `parseMode`. Use **Find chat IDs** and set `parseMode` to `none` to test. |
| 401 | The bot token was rejected | The token is wrong or was revoked. Copy it again from BotFather. |
| 403 | The bot is blocked or was never started | The person has not messaged the bot, or blocked it, or the bot was removed from the group. Open the bot in Telegram and send it any message. |
| 409 | A webhook is set (only for **Find chat IDs**) | Another tool set a webhook on this bot. Remove it with `deleteWebhook` or use a separate bot. |
| 429 | Too many requests | Telegram's rate limit; the plugin honors `retry_after` once. Reduce recipients or add a cooldown. |

Group chat IDs are negative. If a group was upgraded to a supergroup, its ID changed; run **Find chat IDs** again after sending a new message in the group.

### Settings UI

- **The custom settings page does not load**: the standard schema form covers every option; open the plugin settings and use it. Check the Homebridge UI log for the reason.
- **Save is disabled**: the list at the top of the page shows what to fix. Every item names the provider, group, or switch it belongs to.
- **Test connection succeeds but Test send fails**: the credentials are right but the sender, domain, or recipient is not. The per-recipient result shows the provider's error.

If you are stuck, open an [issue](https://github.com/arodbuilds/homebridge-notify-switch/issues) with the log lines (remove any addresses you do not want public) and your configuration with the secrets removed.

## Development

See [CONTRIBUTING.md](./CONTRIBUTING.md) for the development loop, the test harness, and the release process. The full behavior specification is in [SPEC.md](./SPEC.md).

## Changelog

See [CHANGELOG.md](./CHANGELOG.md).
