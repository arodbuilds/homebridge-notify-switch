# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

Nothing yet.

## [1.2.0] - 2026-09-10

Time and date formats for the message variables, a fix for channels that were left unticked, a rewritten default-provider prompt, click-to-insert variables, Duplicate switch and Duplicate group, readable locked fields in dark mode, and provider names that follow the mail provider preset. Two optional fields are added to the platform block (`timeFormat`, `dateFormat`); nothing else changes in the configuration format. A configuration written by 1.1.x starts and sends unchanged, but `{{time}}`, `{{date}}` and `{{datetime}}` render differently unless the new settings are set to 24-hour and Year-Month-Day (see Changed).

### Added

- **Time and date formats.** Two settings under **Settings**, directly below Default Country, choose how `{{time}}`, `{{date}}` and `{{datetime}}` render: **Time format** (12-hour such as `5:15 PM`, or 24-hour such as `17:15`) and **Date format** (Month/Day/Year such as `9/8/2026`, Day/Month/Year such as `8/9/2026`, or Year-Month-Day such as `2026-09-08`). `{{datetime}}` is the date, a space, then the time. Stored as `timeFormat` (`12h`, `24h`) and `dateFormat` (`mdy`, `dmy`, `ymd`) on the platform block; both are optional and default to 12-hour and Month/Day/Year, and the schema form carries them too. An invalid value is a startup error, like an invalid `defaultCountry` (SPEC sections 5.1, 5.6 and 11.2, item 27).

- **Click-to-insert variables.** In every **Show variables** list, each variable is now a button showing the token with the value it would render right now beside it (`{{time}}` as `5:15 PM` in your Time format and Date format settings, `{{switchName}}` as the switch's current name). Clicking one inserts the token at the cursor of the field the list belongs to, replacing any selection, and leaves the cursor after it. Keyboard accessible. A help line under the list says so; the **More about variables** link stays (SPEC section 11.2, item 17).

- **Duplicate switch.** A text button beside **Remove switch** copies the switch directly below it: a new id, the name `{name} copy` (then `{name} copy 2`, within the 64-character limit; `Copy` for an unnamed switch) and everything else identical, from recipients and messages to the cooldown, failure mode, failure sensor and enabled state. The copy is treated like a new switch, its Name field takes focus and the card scrolls into view (SPEC section 11.2, item 11).
- **Duplicate group.** The same beside **Remove group**: a copy directly below the group with every address list, named `{name} copy` with the same suffix rule, and an id generated from the new name that keeps following it until you edit it. No switch is changed (SPEC section 11.2, item 11).

### Changed

- **Provider names follow the mail provider preset and stay unique.** Picking Fastmail, Gmail, iCloud, Outlook.com, Yahoo or Zoho on an SMTP card whose name is still the one the settings UI filled in (`Email`, or an earlier preset's name) renames the provider to the preset (Other goes back to `Email`), and the id follows as before; a name you typed yourself is left alone. A name the UI fills in that another provider already uses gets a numeric suffix (`Email 2`, `Twilio 2`, `Gmail 2`), and the id is generated from that name (`twilio-2`) (SPEC section 11.2, items 13 and 22).
- **The default provider is written the moment it applies, and the prompt has moved and changed.** When a second provider for a channel is filled in, the settings UI now writes the first provider in the list as `defaultProviders[channel]` at once, so `config.json` is fully determined whether or not you answer the question, and the "Choose a default … provider" warning and the "Optional before saving:" status are gone. The question sits at the bottom of the new provider's card, directly above **Remove provider** and **Test connection**, and reads "You now have 2 ways to send email. Switches use Fastmail unless told otherwise. Which should they use?" with the new provider preselected; picking a radio changes nothing until you press **Use the selected provider** (writes your pick) or **Keep Fastmail** (leaves it). It shows only on the load in which the provider was added. Every provider card's header now carries a **Default for email** badge on the channel's default while more than one provider serves it, and a **Make default for email** button on the others. Removing the default with several providers left writes the new fallback immediately and asks again on the last remaining card. At startup, the fallback warning for a missing entry is now reached only by hand-edited configurations (SPEC sections 5.7 and 11.2, item 25).
- README, "Which channel should I use?": the email entry now asks you to have each recipient add your sending address to their contacts, since mail from a sender in the address book is far less likely to be filtered as spam.
- **`{{time}}`, `{{date}}` and `{{datetime}}` change format for everyone** unless the new settings are set to 24-hour and Year-Month-Day. Before, they always rendered as `14:05`, `2026-09-08` and `2026-09-08T14:05:00`; now the defaults give `2:05 PM`, `9/8/2026` and `9/8/2026 2:05 PM`. With 24-hour and Year-Month-Day chosen, `{{time}}` and `{{date}}` are as before and `{{datetime}}` reads `2026-09-08 14:05`, without seconds. Existing messages keep working; only the rendered text changes.
- Version 1.2.0. SPEC.md records everything above in sections 5.1, 5.6, 5.7, 11.2 (items 8, 11, 13, 17, 18, 22, 25 and 27) and 11.3; status is current as of 1.2.0.

### Fixed

- **Dark mode: locked and read-only fields are readable.** The Host, Port and Security fields locked by a mail provider preset, and the ID field of that card, drew dark text on a dark background in dark mode (1.3:1); the other ID fields drew a white box with dark text. Every read-only, locked or disabled input, select and textarea now takes the theme's secondary background behind the surrounding text colour, in one stylesheet rule, so it reads in both themes (SPEC section 11.2, item 18).
- **Send by now ticks a channel that becomes present whatever card you edited.** Giving a group its first ntfy topic (or email address, or chat ID) on the group card, or adding a provider for a channel your recipients already have, left the channel unticked on the switches that send to that group, so Save wrote no action for it and nothing was sent on it. Only ticking a group or adding an extra recipient on the switch card itself ticked it. The comparison now runs on every change in one place, so the channel is ticked and its action written wherever the change came from. A channel you unticked by hand stays unticked while it stays present and is ticked again only if it goes away and comes back (SPEC section 11.2, item 8).

## [1.1.2] - 2026-09-08

Package metadata and one README paragraph. Nothing changes in the plugin, the configuration format or the settings UI.

### Changed

- `package.json` keywords gain `supports-hap` and `ntfy`. The Homebridge verification checker requires a plugin to declare the transports it supports (homebridge/plugins README, "Declaring Supported Transports"); the plugin publishes HAP accessories only, so `supports-matter` is not declared. `ntfy` names the fourth channel alongside the existing `sms`, `twilio`, `email`, `smtp` and `telegram` keywords (SPEC section 13).
- README, Twilio Email guide: the tracking paragraph now states that Twilio Email adds an open-tracking pixel to every message, that as of September 2026 there is no setting to turn it off per message or per account (the Emails API has no tracking field and the [Email settings in the Twilio Console](https://www.twilio.com/docs/email/settings) cover only event forwarding, IP addresses, and the address allow list), that Twilio Email sends from shared SendGrid IP addresses whose reputation is outside the household's control, and that a household that wants neither should send through its own SMTP mailbox (SPEC sections 6.2 and 15).

## [1.1.1] - 2026-09-07

Email deliverability and documentation. Nothing changes in the configuration format or the settings UI beyond one corrected line of copy.

### Changed

- **Both email paths mark messages as automated.** SMTP and Twilio Email sends carry the header `Auto-Submitted: auto-generated` (RFC 3834, the value for automated messages that are not replies), through nodemailer's `headers` option and the Emails API's `content.headers` object respectively (SPEC sections 6.2 and 6.3).
- **Twilio email tracking.** This release set out to disable Twilio's open and click tracking on every send, because the tracking pixel got a message scored 5.7 as spam at Fastmail. The Emails API documents no per-message setting for it, so nothing is sent and the README now says that Twilio may add tracking, that the plugin cannot turn it off, and that a household that wants none can use its own SMTP mailbox. The plan is recorded as a future item in SPEC section 15.
- README: a "Which channel should I use?" section after the intro (email to start, Telegram or ntfy for push, SMS only when the recipient will not install anything); Twilio registration notes under the A2P 10DLC guide (Sole Proprietor 10DLC with its one brand, one campaign, one number and 1 message per second limits; toll-free verification; fees as of September 2026 with a link to Twilio's pricing page); the switch card screenshot placeholder is replaced by `assets/switch-config.png` with a caption.
- SPEC.md: sections 6.2, 6.3, 11.3, 13, 14 and 15 record the above; status is current as of 1.1.1.
- The package description on npm now lists ntfy: "Homebridge switches that send SMS, email, Telegram, or ntfy messages when turned on. Trigger them from HomeKit automations and scenes."
- Version 1.1.1.

### Fixed

- Settings UI: the empty state of a group card's email list read "No email addresss yet."; it reads "No email addresses yet." The line was built by appending an `s` to the singular label, so the other lists keep reading "No phone numbers yet.", "No chat IDs yet." and "No topics yet." (SPEC section 11.3).
- Harness: the Twilio Email request shape now includes the header inside `content` and nothing new at the top level, both email providers are checked for `Auto-Submitted: auto-generated`, the group card empty-state lines are checked in the browser, and the assets test tolerates the README screenshot.

## [1.1.0] - 2026-09-07

A new way to reach people (ntfy), a simpler way to set up a switch, and a security review of the 1.0.1 code. A configuration written by 1.0.x still starts and sends unchanged. The settings UI reads your existing switches into the new editor and writes them back exactly as they were, with the one exception below.

### Breaking

- **Switches with more than one action on the same channel must be set up again.** The new switch editor holds one action per channel, so a switch that sends, say, two different SMS messages (possible in 1.0.x by adding two SMS actions) cannot be shown in it. When the settings page finds such a switch it does not try: a notice at the top reads "Warning: upgrading to 1.1 requires reconfiguring this plugin. Download a backup for reference, then use Reset plugin to fresh install under Advanced and set up your switches again.", the Switches section names the switches it cannot show, and everything on the page is disabled except **Download backup**, **Download backup without credentials** and **Reset plugin to fresh install** under **Settings > Advanced**; nothing is saved until the reset is done. Both backups carry the configuration exactly as stored, so nothing is lost for reference. The plugin itself is unaffected: startup validation and sending still handle several actions per channel, so the existing switches keep working until you reconfigure. **Restore from backup** refuses such a file. To keep two messages on one channel, use two switches (SPEC section 11.2, item 26).

### Added

- **ntfy push notifications.** A fourth provider type sends free push notifications to the [ntfy](https://ntfy.sh) app through a topic name, on ntfy.sh or your own server, with no account for public topics or an access token for reserved ones. Groups gain an **ntfy topics** list; each ntfy message carries a title (the switch's Subject, defaulting to the switch name), a priority from `min` to `urgent`, and up to eight tags the app shows as icons. **Test connection** checks the server and the credentials without publishing anything. The README has a setup guide with the app links and a warning about topic names, which anyone who knows them can read.
- **A new switch editor.** A switch card no longer lists actions. Instead you tick the groups to send to under **Recipients** (each shows what it holds: `Family: 3 SMS, 1 email, 2 ntfy`) and add any extra people by channel; **Send by** shows one checkbox per channel your recipients can be reached on, ticked by default, with the number of people each reaches; you type one **Message** and, for email and ntfy, one **Subject**; and a preview line says exactly what will happen: `Will send SMS via Twilio to 3 numbers, email via Fastmail to 1 address, ntfy via ntfy to 2 topics.` **Advanced** holds a **Customize message per channel** option (each channel gets its own message, and its own subject or title for email and ntfy), a provider dropdown for any channel with more than one provider, the SMS sender, BCC for email, and the ntfy priority and tags. Behind the scenes `config.json` keeps the same `actions` array as before, one action per ticked channel, so nothing changes for hand-edited configurations or the schema form; loading a saved configuration reverses the mapping without loss, and the test suite loads a set of fixture configurations, renders each, writes it back and compares. A stored action whose provider is gone (you removed your only Telegram provider, say) is not dropped: its channel stays ticked under **Send by**, greyed out, with the note "No provider configured for Telegram; add one or untick to remove.", Save waits, and the action is written back as it was until you untick it or add a provider.
- **Platform defaults per channel.** When a second provider for a channel is set up (two ways to send email, say), its card asks "You now have 2 ways to send email. Which should switches use unless told otherwise?" The answer is stored as `defaultProviders` on the platform block and can be changed under **Settings > Default email provider**, which appears only while more than one provider serves the channel. Switches that do not name a provider under Advanced follow the default; a single provider is the default on its own with nothing stored. Until the question is answered the summary box shows "Choose a default email provider" as a warning that never blocks Save. Removing the default provider leaves the single remaining one as the default, or asks again when several remain. At startup a missing default with several providers falls back to the first in config order with a warning naming it, and an entry naming a provider that does not exist or cannot send on the channel is an error.
- Name rule for provider and group names (and the platform name, which Homebridge prefixes every log line with): printable characters only, no control characters, no angle brackets, 1 to 64 characters. Enforced by `config.schema.json`, by the settings UI with the message "Use letters, numbers, spaces, and punctuation, up to 64 characters.", and at startup as a warning naming the field, never an error, so an existing configuration keeps starting.
- Size and time bounds, stated in SPEC section 12: 100 recipients per action after deduplication, 200 entries per address list, 20 actions per switch, 100 providers, groups and switches each, 8 tags per action, 1 MiB of any provider response body, 100 distinct chats from one Telegram lookup, 1 MB per backup file or draft.
- Harness: the ntfy provider and its card, the security review's log escaping, name rule, forbidden keys, credentials file messages and bounds, the platform default rules and their startup validation, the defaults prompt and Settings dropdown, the switch editor, the round-trip fixtures under `test/fixtures` (a configuration whose only Telegram provider was removed among them), and the legacy notice with its backups, Reset and Restore refusal (`ui-legacy.test.mjs`, fixture under `test/fixtures/legacy`).

### Changed

- Switches section intro: "Each switch appears in the Home app. Turning it on sends your message to everyone in the groups you pick, on every channel they have, then the switch turns itself off."
- The "This switch sends to a group with … but it has no … action" warning and its **Add … action** button are gone from the settings UI: a channel you do not want is simply unticked under **Send by**. The startup warning for a group channel no action covers stays, for hand-edited configurations.
- Summary box entries are left-aligned with the bullet beside the first line of the text, wrapped entries included. Outlined buttons such as **Add phone number** take a lighter fill on hover that does not read as pressed; only a press is a shade darker.
- Every log line has control characters escaped (`\n`, `\u001b`) and every configuration value quoted in a startup message is escaped and cut to 80 characters, so nothing in `config.json` or a provider's reply can start a new log line or emit a terminal escape sequence. With `debug` on, a multi-line body is logged on one line.
- Email addresses with control or Unicode format characters are rejected; the old pattern let them into log lines.
- The `subject` startup warning now reads "only applies to the email and ntfy channels".
- Telegram **Find people and groups** lists at most 100 distinct chats.
- README: the Switches section describes the new editor, with a screenshot placeholder, and moves the `actions` shape and the new `defaultProviders` field into their own subsections; ntfy is covered throughout; the dark-mode troubleshooting entry is gone (fixed in 1.0.0).
- SPEC.md: sections 3, 5 (new 5.7 Platform defaults, and a note that actions stay the stored form the UI derives), 6, 8, 10, 11.2 (item 8 rewritten for the switch editor, new items 24, 25 and 26), 11.3 and 12 record the above.

### Security

Findings of the 1.1.0 review of the 1.0.1 code:

- Restore from backup and draft recovery reject a key named `__proto__`, `constructor` or `prototype` at any nesting level (the file is refused with the offending path; a draft is discarded), and so do startup validation and every UI server endpoint. Before this, such a key in a backup was carried into the platform block as an unknown key.
- Backup files over 1 MB are refused before they are read; a draft over 1 MB is neither written nor loaded.
- Provider HTTP responses are read up to 1 MiB and the stream is cancelled past that, so a server the user points the plugin at cannot make it buffer an unbounded reply.
- The settings UI re-checks the bot username against `^[A-Za-z0-9_]{5,32}$` before building a Telegram link or QR code from it.
- The Test send endpoint refuses a switch id over 64 characters.
- Dependency review: the runtime tree (`nodemailer`, `@homebridge/plugin-ui-utils`) has no install scripts and `npm audit` reports no advisories; the lockfile is committed.

## [1.0.1] - 2026-09-07

Closes the remaining pre-release audit findings and adds the brand assets. The only user-visible changes are the SMTP Test connection success line and the mark in the settings page footer.

### Added

- Brand assets under `assets/`: `notify-switch-192.png`, `notify-switch-512.png`, `notify-switch-banner.png` (2560x640), `notify-switch-social.png` (2560x1280), `notify-switch-dark.svg`, `notify-switch-light.svg` and `notify-switch-mark.svg`. The SVGs contain only the drawing; their embedded metadata was stripped. The directory is listed in `.npmignore` and is not in the package.json `files` array, so nothing under it is published (SPEC section 13, items 8 and 9).
- Settings UI: the Notify Switch mark, inlined into the UI bundle from `assets/notify-switch-mark.svg` at build time, precedes the plugin name in the footer credit at 20px. It is drawn with `currentColor`, so it follows the host's theme, and is hidden from assistive technology. It is not added to the getting-started header. No new runtime dependency (SPEC section 11.2, item 20).
- Harness: `maskAddress` is covered for phone numbers, email addresses and Telegram chat ids, short and empty values included; the flip handler's log output is checked at info level (the body and subject never appear, every address is masked, failures are warned with the address masked in the error too) and with `debug` on (the body and the full addresses appear). A packaging test asserts the bundle inlines the mark as shipped, the SVGs carry no metadata, and `npm pack` leaves out `assets/`, the source and the tests.

### Changed

- SMTP Test connection success line: "Connected to {host}:{port} and logged in." The submitted username is no longer echoed; the harness asserts that no Test connection response contains it, on success, on a plain failure, and on an error that quotes the login (SPEC section 11.2, item 3).
- `config.schema.json` now matches the runtime: `providers` and `switches` are optional (only `name` is required), as SPEC section 10 says an empty or absent list is not an error; `smtpPreset` is declared as an optional hidden string with the preset enum (`fastmail`, `gmail`, `icloud`, `outlook`, `yahoo`, `zoho`), so a value stored by the settings UI passes the schema; the `sender` and `messagingServiceSid` patterns no longer accept an empty string. The settings UI already omits both keys when blank, so nothing it saves changes.
- README: the Homebridge logo at the top is replaced by `assets/notify-switch-banner.png` at full width with the alt text "Notify Switch"; the badges stay below it. The centered "Notify Switch" heading under the old logo is gone, since the banner carries the name.
- SPEC.md: sections 5.2, 5.5, 10, 11.2 (items 3 and 20), 11.3 and 13 record the above; the configuration example no longer shows an empty `messagingServiceSid`.
- GitHub issue forms replace the markdown issue templates: a bug report (versions, host, area, what happened, expected, steps, log lines, backup without credentials, and two confirmation checkboxes), a feature request, and a provider request, each with a title prefix and label. Blank issues are off; the chooser links to the README setup guide and the Homebridge Discord.
- README: Getting help links straight to the bug report form.
- CLAUDE.md: the runtime dependency rule names `nodemailer` and `@homebridge/plugin-ui-utils`, matching package.json and SPEC section 12.

## [1.0.0] - 2026-09-07

The first stable release. The configuration format is final: a configuration written by any 0.1.0 beta loads unchanged, and the full behaviour is described in SPEC.md.

### Added

What Notify Switch does, in one place:

- **Switches that send messages.** Every configured switch appears in the Home app, always off. Turn it on, from an automation, a scene, or by hand, and it sends every action on it in parallel, then turns itself off a second later. Turning it off does nothing.
- **Three ways to reach people.** SMS through Twilio; email through Twilio (with an authenticated domain) or through any SMTP mailbox (Fastmail, Gmail, iCloud, Outlook.com, Yahoo, Zoho, or another server); and Telegram through a bot you create. Twilio takes API keys only, never the Auth Token.
- **Recipient groups.** Named lists of phone numbers, email addresses and Telegram chat IDs, entered once and reused by every switch. An action can add extra individual recipients on top.
- **Messages with variables.** `{{switchName}}`, `{{time}}`, `{{date}}` and `{{datetime}}` work in every body and email subject; subjects default to the switch name. Email actions can hide recipients from each other (BCC).
- **A master switch, cooldowns and a failure sensor.** "Notifications Enabled" silences every switch while off and remembers its position across restarts. Each switch has a cooldown, an enable flag, and an optional contact sensor that trips when a send fails so an automation can react.
- **Startup validation that keeps automations safe.** Every problem is logged with its field path and a "did you mean" hint. While the configuration has errors nothing is registered and existing accessories stay untouched, so a typo never breaks HomeKit. A configuration with no switches removes every accessory. Phone numbers without a country code are normalized with the default country. A group with addresses on a channel a switch does not send on is reported once per switch.
- **Sending that finishes the job.** Every request has a 10 second timeout, one retry, a rate limit honored once, and at most five requests in flight per provider. One recipient's failure never stops the others. Each result is logged per recipient with addresses masked; credentials are never logged, and message bodies only when debug is on.
- **A settings page in the Homebridge UI.** Pick a provider (Twilio, Email over SMTP, Telegram), fill in a guided card, create a group and a switch, and save; the schema form stays complete as a fallback. Every provider card has **Test connection**. Twilio's **Look up numbers** picks sender numbers and Messaging Services from the account. The SMTP card's **Mail provider** picker fills the server settings and links to the right app-password page. The Telegram card is a three-step wizard with QR codes (or **Open in Telegram** and **Share** on phones) and **Find people and groups** adds chats to a group with one click.
- **Help as you type.** Phone entry with a country dropdown and national formatting; a live SMS character and segment counter that flags characters SMS cannot carry; **Test send** per switch with a confirmation and per-recipient results; a warning with a one-click fix when a switch targets a group with addresses on a channel it does not send on; errors that appear once a field is left, with a summary box that links to each field, and Save disabled until the configuration is valid. Unsaved changes are offered back the next time the page opens.
- **Backup, restore and reset** under Settings > Advanced. **Download backup** saves the whole configuration; **Download backup without credentials** (new in this release) saves the same file with every secret replaced by an empty string and `"credentialsRemoved": true`, safe to attach to an issue. **Restore from backup** accepts either file, or a whole config.json, checks it before anything changes, and, for a backup without credentials, loads everything else and marks the empty secret fields as errors so the summary lists them. **Reset plugin to fresh install** asks for `RESET` first.
- **Light and dark mode, phones and touch devices**, with WCAG AA contrast, touch targets and no horizontal overflow checked by the test suite.
- **`credentialsFile`** on any provider keeps secrets in a separate JSON file, out of config.json, Homebridge UI backups and screenshots.

### Changed

- Help text under the backup buttons: "The full backup contains your provider credentials; store it like a password. The version without credentials is safe to share when asking for help."
- README: install the release by its exact name from the Homebridge UI or with `npm install -g homebridge-notify-switch`, no beta wording, and a **Getting help** section that asks for a backup without credentials and the relevant log lines.
- SPEC.md is current as of 1.0.0: every deviation recorded in the phase and beta pull requests is folded into the relevant section and the open questions are settled.
- npm keywords: homebridge-plugin, homebridge, homekit, notification, alert, sms, twilio, email, smtp, telegram.
- Version 1.0.0.

### Security

- Backups without credentials: the file replaces the API key secret, the SMTP password, the bot token, and every field a `credentialsFile` may supply with an empty string; nothing else is removed, so the file still shows the configuration a helper needs to see.
- TLS verification cannot be disabled, credentials are never logged, and the plugin has no analytics and writes no files.

## Pre-release history

The 0.1.0 betas that led to 1.0.0, kept for reference.

### [0.1.0-beta.7] - 2026-09-07

Validation and polish in the settings UI, plus two runtime changes: email recipients are in To by default with a per-action BCC option, and the default country prefill also reads the Homebridge host's time zone.

#### Added

- Per-action **Hide recipients from each other (BCC)** checkbox on email actions (`bcc`, default false; SPEC sections 5.5, 6.2 and 6.3). SMTP and Twilio Email now put every recipient in To by default so recipients see each other; with the option on and more than one recipient, recipients go in Bcc and the from address in To as before. A single recipient is always addressed in To. Set on another channel the option is ignored with a startup warning. Harness tests cover both providers and the validation passthrough; `config.schema.json` carries the field for the schema form.
- Default country from the host time zone (SPEC section 11.2, item 21): when the browser locale names no region, the settings UI asks the UI server for the Homebridge host's time zone (new `/host-timezone` endpoint returning `Intl.DateTimeFormat().resolvedOptions().timeZone`) and maps it to a country with a small static table (`src/timeZones.ts`), falling back to US. A saved value is never overridden. Harness tests cover the endpoint, the table, and every branch in the browser.
- SMTP **Mail provider** preset picker (SPEC section 11.2, item 22) replacing the Common settings table: Fastmail, Gmail, iCloud, Outlook.com, Yahoo, Zoho, Other, as a segmented control on wide screens and a dropdown below 600px. A preset fills host, port and security and locks them behind an **Edit** link; Other leaves them editable. The password help names the chosen provider and links directly to its app-password page (the Gmail text notes that 2-Step Verification must be on first). The preset key is stored as `smtpPreset` for redisplay only; the runtime reads host, port and security. From name help: "Some providers replace this with your account's display name."
- Unsaved draft recovery (SPEC section 11.2, item 23): every change is written to `localStorage` under `homebridge-notify-switch:draft`; on the next load a draft that differs from the saved configuration and is less than 24 hours old is offered in a banner ("You have unsaved changes from earlier. Restore them?" with **Restore** and **Discard**). Restore loads the draft and marks every field touched; a draft equal to the saved configuration is removed; a Reset confirm never leaves a draft behind. The Homebridge UI exposes no hook to intercept Close, so the banner is the recovery path.
- Green check inside a field once it passes validation after being touched.
- Browser tests: per-field validation (blur, focus, clearing, checks), input bounding boxes unchanged when an error appears on an email entry and a phone entry, issue list links and collapsing, Test send gating, in-place Remove confirmation, placeholder italics and a 2:1 contrast check against the input text colour in both themes, outlined button hover and focus state, chooser columns, draft recovery, the SMTP presets, and the time zone branches.

#### Changed

- Per-field validation (SPEC section 11.2, item 15): touched state is tracked per field rather than per card. A field shows its error only after it has been left, changed (selects and checkboxes) or jumped to from the issue list; while it has focus an error is only ever cleared, never added. Cross-field checks (recipient coverage, duplicate names, ids that follow the name, provider-dependent channel and sender checks, "Add at least one action") belong to every field they read and appear once one of those fields is touched. New cards still show nothing until a field is touched and their issues stay out of the list behind "Fill in the new … to enable Save."
- Error layout: validation messages render on their own line below the field or list row; address rows put the input and Remove in a flex line with the message as a block below, so inputs never change width or wrap when a message appears. A phone row explains a parse failure once, under the number.
- Issue list: every entry in "Fix these before saving" is a link that scrolls to the field, marks it touched and focuses it. With more than three entries the box collapses to "{n} fields need attention" with a **Show all** toggle.
- Test send is disabled while the switch, or a provider or group it uses, has a validation issue ("Fix the errors above first") or resolves to zero recipients ("No recipients yet"); the confirmation can no longer read "Send to 0 recipients".
- **Remove switch**, **Remove provider** and **Remove group** confirm in place like Test send: "Remove this switch?" with a red **Remove** and a text **Cancel**; Escape or Cancel restores the button. List-entry Remove buttons stay single-click.
- **Add action** is an outlined secondary button matching **Add phone number**, directly under the actions list. The chooser's **Cancel** is an outlined secondary button too, and the chooser tiles fill the card width in three equal columns, stacked below 600px.
- Outlined secondary buttons keep their outline on hover and focus with a subtle background highlight; they no longer take Bootstrap's solid fill.
- Provider type badges read Twilio, SMTP and Telegram (also in the switch Provider dropdown).
- Placeholders: every realistic-looking placeholder starts with "e.g." and placeholders are italic in the host's lighter placeholder colour in both themes. Help lines carry examples where a field has one (provider, group and switch names, SMTP username and from address, server settings).
- The **Variables** label next to Subject and Message is a link-styled **Show variables** / **Hide variables** toggle with a chevron; the panel content is unchanged.
- SPEC sections 5.1, 5.2, 5.5, 6.2, 6.3, 11.2 and 11.3, and the README (SMTP section with Yahoo and Zoho, actions table, Test send, troubleshooting) describe the new behaviour.
- Version bumped to `0.1.0-beta.7`.

### [0.1.0-beta.6] - 2026-09-07

Dark-mode contrast, a guided empty state, and a footer. Runtime behavior does not change, except that the settings UI now prefills the default country from the browser locale on a fresh install.

#### Added

- Guided empty state (SPEC section 11.2, item 19): while there are no providers, the Providers section body is a single **Get started** card with the line "Choose how you want to send messages. You can add more providers later." and the three provider chooser tiles inline. The Recipient Groups and Switches sections stay visible, but **Add group** and **Add switch** are disabled, drawn outlined, with the hint "Add a provider first." Once one provider exists the page renders as before; removing the last provider brings the card back. The Save status area at the bottom reads "Nothing to save yet" while there are no providers, groups or switches, and "Configuration reset. Click Save, then restart Homebridge." immediately after a Reset, with Save enabled in both cases.
- Version and credit footer (SPEC section 11.2, item 20) as the last element of the page: "Notify Switch v{version} · Made by Alex Rodriguez · alex-rodriguez.com · Report an issue". The version comes from the installed package.json through a new `/version` endpoint on the UI server, so it always reflects the installed package. Both links open in a new tab; the site link carries `?ref=notify-switch` and nothing else is tracked.
- Default country from the browser locale (SPEC section 11.2, item 21): on first load with no saved `defaultCountry`, the dropdown is prefilled from the region of `navigator.language` (`en-GB` gives GB), falling back to US for a locale without a known region. A saved value is never overridden. Startup normalization is unchanged.
- README **About** section: "Built by Alex Rodriguez. If this plugin is useful to you, say hello at alex-rodriguez.com."
- Browser tests for the guided empty state, the footer (version from the stubbed server, links, last element, wrapping at 320px) and the locale prefill (`en-GB`, `de`, and a saved value), a handler test for `/version`, and the layout contrast test now also renders an empty configuration.

#### Fixed

- Dark-mode contrast, second pass (SPEC section 11.2, item 18). The Homebridge UI marks dark mode inside the settings iframe by adding `dark-mode` and `config-ui-x-dark-mode-{theme}` to the body and colouring the body and cards itself; it never sets Bootstrap's `data-bs-theme` there, so Bootstrap's variables keep their light values and beta.5's `--bs-secondary-color` was near-black text on a near-black page: empty-state lines, checkbox help, field help under Settings and the Advanced disclosure toggles were invisible. The stylesheet now re-declares the theme variables it reads (`--bs-secondary-color`, `--bs-border-color`, `--bs-secondary-bg`, `--bs-link-color` and their companions) with Bootstrap's dark values under the host's body marker, and one rule styles every piece of secondary text (field help, hints, empty-state lines, captions, table captions, disabled buttons, every `details > summary`, the help toggle) with `--bs-secondary-color` falling back to the surrounding text colour. Chooser tiles no longer paint `--bs-body-bg` (white on the dark theme) and sit on the surface the host paints; disabled buttons are drawn on a plain background at full opacity.
- The headless theme test emulated dark mode with `data-bs-theme="dark"`, which the Homebridge UI does not use, so it passed while the real page was unreadable. It now themes the page the way the host does (the host's body classes and its own body, card, alert, link and primary-button rules from homebridge-config-ui-x 5.29, no `data-bs-theme`) and asserts WCAG AA contrast in dark and light mode on a full configuration and on an empty one: an empty-state line, checkbox help, field help under Settings, the Settings > Advanced summary toggle, the Get started card's caption and tile help, the "Add a provider first." hint, a disabled Add button, the Save status line, a help link and the footer, on top of the elements checked before. Against the beta.5 stylesheet this test fails.

#### Changed

- Version bumped to `0.1.0-beta.6`.

### [0.1.0-beta.5] - 2026-09-07

Usability and copy. Runtime behavior does not change.

#### Added

- Provider chooser: **Add provider** now opens three tiles (Twilio: "SMS text messages, and email if you have a Twilio-authenticated domain."; Email (SMTP): "Send from a mailbox you already have, such as Fastmail, Gmail, iCloud, or Outlook."; Telegram: "Free messages through a bot you create. Best for family group chats.") with a Cancel link. Picking one creates the card with the type fixed, the name prefilled (Twilio, Email, Telegram) and the id generated from the name (`twilio`, `email`, `telegram`, with a numeric suffix such as `twilio-2` when taken). The Type dropdown is gone; the type badge stays in the card header.
- Per-card **Show help** / **Hide help** toggle in every card header that collapses field help (status lines, counters and validation messages stay). Expanded at 600px and above, collapsed below; the choice is kept in memory per card for the page's lifetime only.
- **Variables** text button on every message and subject field that lists `{{switchName}}`, `{{time}}`, `{{date}}` and `{{datetime}}` with a link to the README; the help strings no longer list variables.
- Phone-friendly Telegram onboarding: on viewports below 600px and on touch devices the QR codes, their captions and Enlarge are hidden in favour of **Open in Telegram**, **Copy link** and **Share** (Web Share API; hidden when the browser has none).
- "Where do I find this?" style links from field help into the README (Twilio account and API keys with "Why not the Auth Token?", A2P 10DLC with "How do I register?", email through Twilio, SMTP app passwords with "Where do I create one?" and a new README **App passwords** heading, Telegram, credentials file, template variables). A harness test reads every README anchor from the built UI bundle and checks that the heading exists.
- Headless layout test additions: 360px viewport with no horizontal overflow and stacked phone rows, the primary action on top of a wrapped card footer, 44px touch targets on an emulated touch device, and WCAG AA (4.5:1) contrast of help text, the Advanced label, a QR caption and the help toggle against the background in dark mode and light mode. New browser tests cover the chooser, hidden ids, fresh cards, the help and Variables toggles, and the two step 3 variants of the Telegram card.
- Copyright line "Copyright 2026 Alex Rodriguez (arodbuilds) https://alex-rodriguez.com" at the top of `LICENSE` (Apache-2.0 text unchanged below it), as a header comment in `src/index.ts`, and `package.json` `author` set to Alex Rodriguez with the same URL.

#### Changed

- Provider and group ids are generated from the name and hidden from the main form. Each card's **Advanced** disclosure shows the ID read-only with an **Edit** button for people who hand-edit config.json; format and uniqueness are still validated and an issue on the ID opens the disclosure. A generated id follows the name as it is typed until it is edited by hand or a switch action refers to it, so renaming never breaks a switch. The ID help text and its validation message left the main form.
- Validate on blur: a newly added provider, group or switch card shows placeholders and no errors until a field in it loses focus or a select or checkbox changes; its issues are also left out of the issue list. Save stays disabled while any issue exists; while every remaining issue is on an untouched card the issue box reads "Fill in the new provider to enable Save." as an info line. The Homebridge UI keeps its Save button disabled while issues exist, so "or Save is attempted" cannot occur; touching a field is the trigger.
- Telegram card: step 1 opens with "On your phone, scan this code with the camera to open BotFather in Telegram. On a computer with Telegram installed, click Open BotFather instead. Then, in the BotFather chat:" and the four instructions now read "Send /newbot." "Choose a display name such as Home Alerts." "Choose a username ending in bot, for example homealerts_bot." "BotFather replies with a token. Copy it and paste it below."; the QR is captioned "Scan to open BotFather". Step 2 no longer holds a QR code or link; the chosen card drives step 3. With the group card selected, step 3 is "Add the bot to your group" with the startgroup QR ("Scan to add the bot to a group"), the link, **Add bot to a group**, **Copy link** and "Open Telegram on your phone and scan, or click the button, then pick your family group or create one. Everyone in the group will get alerts." With individual chats selected, step 3 is the invite QR ("Scan to start receiving alerts"), the link, Enlarge, Copy link and Copy invite message. Never both. Parse Mode moved under the card's Advanced disclosure (default plain text). After **Find people and groups** returns results: "Added people appear in the group's Telegram chat IDs list. Save when you're done."
- Theme contrast: help text, hints, captions, disabled buttons and disclosure labels such as Advanced take their colour from the Bootstrap theme variables the Homebridge UI injects (`--bs-secondary-color`, falling back to `--bs-body-color`); borders and the step badges use `--bs-border-color` and `--bs-secondary-bg`. No fixed greys remain for text.
- Phone rows below 600px stack the country dropdown on its own line, then the number field with Remove beside it. Card footers put the primary action first and reverse the row so it stays on top when the footer wraps. All buttons, text buttons included, are at least 44px tall on touch devices.
- Copy rewrite (SPEC section 11.3, `config.schema.json` and the settings UI): getting started in two paragraphs, shorter Providers, Groups and Switches intros, one-sentence field help for the Twilio, SMTP, Telegram, group and switch fields listed in the spec, "Common settings" expander with the Fastmail, Gmail, iCloud and Outlook table under the SMTP server fields (the schema form keeps the table in the `host` description), the Channel dropdown limited to the channels the selected provider serves with no help text, and validation messages that say what the value looks like and where to get it (Account SID, API Key SID, Messaging Service SID, bot token, port, switch name).
- README: Telegram section mirrors the new step 1 copy and the two step 3 variants, the IDs paragraph describes the Advanced disclosure, the provider guides mention the chooser and the help toggle, and troubleshooting covers untouched cards.
- Version bumped to `0.1.0-beta.5`.

### [0.1.0-beta.4] - 2026-09-07

#### Added

- Twilio **Look up numbers** on the provider card, enabled once the Account SID, API Key SID and API Key Secret are filled. Through the settings UI server it lists the first 20 phone numbers on the account (`GET /2010-04-01/Accounts/{accountSid}/IncomingPhoneNumbers.json?PageSize=20`) and the first 20 Messaging Services (`GET https://messaging.twilio.com/v1/Services?PageSize=20`) with the same Basic auth as everything else, and shows them as two dropdowns with friendly names. Picking a number appends it to the senders list; picking a service fills the Messaging Service SID. When a page reports more entries the status ends with "Showing the first 20; enter others manually."; a key that may not list numbers (401 or 403) gets "This API key cannot list numbers. Enter them manually." Manual entry remains available. Harness tests cover success, the paging note and the permission failure with mocked `fetch`, and a browser test drives the dropdowns.
- Telegram onboarding flow replacing the Telegram provider card: step 1 "Create your bot" with an Open BotFather link, a QR code of it, four numbered instructions and the token field, which checks the token with `getMe` as soon as it looks valid and shows "Connected to @username"; step 2 "Choose how people receive messages" with the "Family group chat (recommended)" and "Individual chats" cards, the former with an "Add bot to a group" link and QR code; step 3 "Invite people" with a QR code for the bot's start link, Enlarge (full-page modal), Copy link and Copy invite message; then **Find people and groups** (the renamed Find chat IDs), which lists private chats by first name and username and groups by title, includes `my_chat_member` updates so a group appears as soon as the bot is added, and adds each entry to the recipient group chosen in a dropdown, prompting for one when none is chosen. QR codes are inline SVG generated in the UI bundle by `qrcode-generator`, a dev dependency; no new runtime dependency. All copy is in SPEC section 11.3 and the README Telegram section mirrors the three steps.
- Settings > **Advanced** (collapsed by default) with **Download backup** (`notify-switch-backup-YYYY-MM-DD.json`, with a line stating the file contains credentials), **Restore from backup** (a file picker whose JSON is checked against the form's rules before anything changes, listing the problems if it fails and replacing the form and enabling Save if it passes; a whole config.json holding a NotifySwitch block is accepted too), and **Reset plugin to fresh install** (a red text button opening a confirmation that lists what is removed, offers Download backup first, and requires typing RESET before the red Confirm button enables; confirming replaces the form with the empty default configuration and enables Save). Browser tests cover all three.
- Startup: a configuration that passes validation with zero switches now unregisters every cached accessory, the master switch included, and clears the master switch position and failure sensor state persisted in their contexts. A configuration that fails validation still leaves cached accessories untouched. `test/harness/platform.test.mjs` drives both paths and a normal start against a fake Homebridge API.
- SPEC section 2 notes the 1.1 plan: WhatsApp via Twilio with a single approved utility template carrying the body as its variable, and voice calls via Twilio as a candidate for the same release.
- Browser tests for phone entry (typing with the caret mid-field, editing an existing number, pasting E.164, and the +1 region re-derivation), with the Chromium helpers shared in `test/harness/browser.mjs`.

#### Changed

- Phone entry no longer reformats while typing. The field accepts digits, spaces, dashes, dots, parentheses and a leading plus while it has focus (anything else is dropped as typed with the caret kept in place). On blur the text is parsed with libphonenumber-js using the selected country as the hint, stored as E.164, the country is re-derived from the number (a +1 305 number selects United States even if Canada was selected) and the dropdown updated, and the field shows the national format. "Stored as +…" appears only when parsing succeeds; otherwise an inline error shows and the raw text stays. Applies to sender numbers, group SMS lists and extra SMS recipients.
- Messaging Service SID moved under the Twilio card's **Advanced** disclosure next to the credentials file, with the same help text; the disclosure opens when either is set.
- Card buttons: **Add action** is a link-style button directly under the actions list, left aligned. Every switch card has a footer with **Remove switch** as a red text button on the left and **Test send** as the only outlined primary button on the right; clicking it replaces the button in place with "Send to {n} recipients now?", a primary **Send** and a text **Cancel** (Escape or Cancel restores it), and per-recipient results render below the footer with a Dismiss link. Provider cards (Remove provider, Test connection) and group cards (Remove group) use the same footer. The layout smoke test asserts that no two primary buttons are adjacent in any card footer. Red is reserved for Remove buttons and the reset flow.
- An empty `providers` or `switches` list is a warning rather than a blocking error at startup and in the settings UI, so an empty (reset) configuration can be saved; `config.schema.json` no longer sets `minItems` on those two lists. An action that references a missing provider is still an error.
- Telegram private chats are listed as "First (@username)"; the empty result message now points at pressing Start or adding the bot to a group.
- README status line no longer names a version ("The current release is shown in the badge above."). README, CONTRIBUTING and SPEC carry no hardcoded version, so a release touches only `CHANGELOG.md` and `package.json`.
- Version bumped to `0.1.0-beta.4`.

### [0.1.0-beta.3] - 2026-09-06

#### Added

- Uncovered channel warnings. For each switch, the channels present in the groups it targets are compared with the channels its actions cover. The settings UI shows a warning on the switch card for each uncovered channel ("This switch sends to a group with email addresses, but it has no email action. Those recipients will not receive anything.", worded per channel) with an "Add email action" (or SMS, or Telegram) button that appends an action for that channel with the first provider serving it preselected and the targeted groups that hold addresses on that channel selected. It is a warning, not a validation error, so Save stays enabled. Startup logs the same condition once per switch and channel as a warning with the switch name, the group ids and the channel. The detection lives in one module (`src/coverage.ts`) shared by the UI and startup validation, with harness coverage.
- Harness tests, one per provider, that send to three recipients where the second fails at once with a 4xx (Twilio error 21211 invalid To, Telegram 400 chat not found, SMTP 550 recipient rejected) and assert that the first and third are still sent and reported ok while the second is reported failed with the code. A further test drives the per-recipient runner directly with tasks that throw synchronously and reject asynchronously.
- Headless Chromium smoke test for the built settings UI (`test/harness/ui-layout.test.mjs`, on `playwright-core`, a dev dependency that downloads nothing). It loads the page with the host's Bootstrap appended after the plugin stylesheet, as the Homebridge UI does, and checks at 400px, 599px and 900px that no rendered element has a bounding box starting left of the viewport or ending past it, that the page has no horizontal scroll, that the two-column grids stack to one column below 600px, and that the uncovered channel warning renders with its copy and button while Save stays enabled. It uses a Chromium or Chrome binary from `NOTIFY_SWITCH_CHROMIUM`, `CHROMIUM_PATH`, `CHROME_BIN`, the usual install paths or the `chrome` channel; without one it is skipped locally and fails on CI.

#### Changed

- Per-recipient continuation is explicit. Providers that send one request per recipient (Twilio SMS, Telegram) collect the outcomes through a shared runner (`sendEach` in `src/providers/http.ts`) built on `Promise.allSettled`, never `Promise.all`, so one recipient's rejection or thrown error becomes a failed result for that recipient alone while every other recipient is still sent and reported. The switch accessory collects its actions the same way. The runner carries a comment stating that one recipient's failure must never stop the others; nothing in the send path was found to throw or return early, so this replaces the implicit guarantee with a structural one.
- Account SID help text in the settings UI, `config.schema.json` and SPEC section 11.3 now reads: "Identifies your Twilio account and is not a secret. Found on the Twilio Console home page under Account Info. Starts with AC."
- Settings UI Test send confirmation: "Send now" is now the primary (blue) button and Cancel stays neutral. Red is reserved for Remove buttons only; no other button on the page uses it.
- Version bumped to `0.1.0-beta.3`.

#### Fixed

- Settings UI content was clipped at the left edge of the settings modal: section headings, labels and help text started off-screen and the page scrolled horizontally. The iframe has no padding of its own, and the Settings section used bare Bootstrap `.row` elements whose negative gutter margins reached past the page. The page is now wrapped in a container with 16px of horizontal padding on both sides, and every two-column layout uses a gap-based grid (`.ns-grid`) with no negative margins that stacks to a single column below 600px. No element on the page has a negative margin or a width over 100%; the new smoke test enforces this.

### [0.1.0-beta.2] - 2026-09-06

#### Added

- Harness tests that assert the exact URL, method, empty body and `Authorization` header of the Twilio connection test as submitted by the settings form, that pasted whitespace is trimmed, and that 401, 403, 404 and 5xx responses are classified with Twilio's code and message.

#### Changed

- Release workflow: publishing now uses npm trusted publishing (GitHub OIDC) instead of the `NPM_TOKEN` secret, which is no longer referenced. The workflow upgrades npm to the latest release before publishing, because trusted publishing requires npm 11.5.1 or newer and the version bundled with Node.js 22 is older, and fails early if npm is still too old.
- Dependabot no longer opens pull requests for TypeScript major version updates.

#### Fixed

- Settings UI Twilio **Test connection** failed with "Twilio rejected the API key" for valid keys. The test read the Account resource (`GET /2010-04-01/Accounts/{accountSid}.json`), which Twilio answered with 401 for a valid Standard key and which a Restricted key cannot read, and the handler dropped Twilio's error code and message on 401, so a working Standard key looked like a wrong secret. The test now lists one message (`GET /2010-04-01/Accounts/{accountSid}/Messages.json?PageSize=1`) with Basic auth of `apiKeySid:apiKeySecret`, which passes for Standard keys and for Restricted keys scoped to Messaging. Failure messages for 401, 403 and 404 now include Twilio's `code` and `message` when present, and a 403 names the missing Messaging permission.
- Settings UI password inputs use `autocomplete="new-password"` so browsers stop offering the saved Homebridge login in the API Key Secret, SMTP password and bot token fields.
- Twilio requests without a body no longer send a `Content-Type` header.
- Release workflow: `npm publish` now passes `--access public`. npm requires it to generate provenance for a package that does not exist on the registry yet, so the first publish failed without it. Applies to both the `beta` and `latest` dist-tags, which share one publish command.

### [0.1.0-beta.1] - 2026-09-06

#### Added

- Dynamic platform `NotifySwitch` that exposes one HomeKit switch per configured entry. Turning a switch on sends its actions and the switch turns itself off after one second.
- Master switch (default name "Notifications Enabled") that suppresses every send while off. Its state survives a Homebridge restart.
- Per-switch cooldown, enable flag, failure mode, and optional failure contact sensor that trips on send failure and resets on the next successful send or after a timeout.
- Startup validation that reports every configuration issue in one pass with its field path, including "did you mean" hints for mistyped provider and group ids. Nothing is registered while the configuration has errors.
- Phone numbers without a country code are normalized to E.164 using `defaultCountry` and the normalized value is logged once at startup.
- Template variables `{{switchName}}`, `{{time}}`, `{{date}}`, and `{{datetime}}` in message bodies and email subjects.
- Twilio provider for the `sms` channel using Node's built-in `fetch`, with a 10 second timeout, one retry with a 2 second backoff (rate limit `Retry-After` honored once), and at most 5 requests in flight per provider.
- Twilio `email` channel: one request per action to `comms.twilio.com/v1/Emails` with every recipient, the plain body sent as `content.text` and, escaped inside a `pre` element, as the required `content.html`; the `operationId` is reported as the id for each recipient. An email action on a Twilio provider without `emailFrom` is a startup validation error.
- SMTP provider on nodemailer: one message per action with recipients in `bcc` and the from address in `to`, `security` mapped to `secure` and `requireTLS`, certificate verification always on, addresses rejected by the server reported as per-recipient failures, one retry after temporary server replies or connection errors, CR and LF stripped from the subject and from name.
- Telegram provider: one `sendMessage` per chat id with at most 5 in flight, `parseMode` mapped to `parse_mode`, readable errors for a blocked bot (403) and a bad chat id (400), `retry_after` honored once on 429.
- `credentialsFile` on any provider: a JSON file relative to the Homebridge storage directory whose keys override the provider's secret fields, read once at startup. A missing or malformed file is a validation error with the field path.
- Local harness (`npm test`) covering each provider's success, per-recipient failure, timeout and rate limit paths with a mocked `fetch` and a mocked nodemailer transport, plus `credentialsFile` validation. Excluded from the published package.
- `CLAUDE.md` with the project conventions.
- Logging that masks phone numbers and email addresses at info level and never logs credentials or message bodies unless `debug` is on.
- `config.schema.json` covering the full configuration with password fields for secrets and provider fields shown only for the selected type.
- Custom settings UI (`customUi` in `config.schema.json`, built with `@homebridge/plugin-ui-utils`) with Providers, Recipient Groups and Switches sections, platform settings, and the in-app copy from the specification. Plain HTML, CSS and TypeScript bundled with esbuild; libphonenumber-js is the only third party code in the bundle. The schema form remains complete as the fallback.
- Settings UI phone entry: country dropdown with flag, name and dial code defaulting to `defaultCountry`, national number field with a local placeholder, live validation and formatting, storage as E.164, and paste normalization that also sets the country.
- Settings UI SMS body counter with character, septet and segment counts and highlighting of characters outside GSM-7.
- Settings UI validation mirroring startup validation: issues are listed with the field they belong to and the Save button is disabled while any remain. Provider and group ids are suggested from the name, switch ids are generated as UUIDs, and provider, channel, sender and group pickers are dropdowns fed by the current configuration.
- Settings UI server (`homebridge-ui/server.js`, compiled from `src/ui`): Test connection per provider (SMTP `verify()`, Twilio account lookup, Telegram `getMe`), Find chat IDs for Telegram groups via `getUpdates`, and Test send per switch that requires a confirmation click and reports per-recipient results. Submitted credentials are used in memory for the one request, never logged, stored or returned; `credentialsFile` is applied the same way startup applies it.
- Harness coverage for the settings UI server handlers, including checks that no response contains a credential.
- Release workflow (`.github/workflows/release.yml`) that publishes to npm with provenance when a GitHub release is published: pre-releases under the `beta` dist-tag, releases under `latest`. The first publish authenticates with the `NPM_TOKEN` secret; later releases move to npm trusted publishing.
- Dependabot configuration for npm and GitHub Actions with weekly, grouped minor and patch updates.
- `CONTRIBUTING.md` with the development loop, the test command, and the release steps.

#### Changed

- The send path is shared between the switch accessory and the settings UI's Test send (`src/send.ts`); behavior of the switch is unchanged.
- `@homebridge/plugin-ui-utils` is a runtime dependency because the Homebridge UI loads `homebridge-ui/server.js` from the installed package. The plugin itself never imports it.
- CI workflow that lints, builds and runs the harness on Node 22 and 24.
- The package is no longer marked private and is published as `0.1.0-beta.1`. The published package contains only `dist`, the built settings UI, `config.schema.json`, `README.md`, `CHANGELOG.md`, `LICENSE`, and `package.json`; the source, tests, specification, and project conventions are excluded.
- README rewritten as the full user guide: provider setup guides with credential steps and links, recipient groups, switches and actions, HomeKit automations, template variables, cooldown and master switch, failure sensor, `credentialsFile`, child bridge, security notes, and troubleshooting by provider.

[Unreleased]: https://github.com/arodbuilds/homebridge-notify-switch/compare/v1.1.2...HEAD
[1.2.0]: https://github.com/arodbuilds/homebridge-notify-switch/compare/v1.1.2...v1.2.0
[1.1.2]: https://github.com/arodbuilds/homebridge-notify-switch/compare/v1.1.1...v1.1.2
[1.1.1]: https://github.com/arodbuilds/homebridge-notify-switch/compare/v1.1.0...v1.1.1
[1.1.0]: https://github.com/arodbuilds/homebridge-notify-switch/compare/v1.0.1...v1.1.0
[1.0.1]: https://github.com/arodbuilds/homebridge-notify-switch/compare/v1.0.0...v1.0.1
[1.0.0]: https://github.com/arodbuilds/homebridge-notify-switch/compare/v0.1.0-beta.7...v1.0.0
[0.1.0-beta.7]: https://github.com/arodbuilds/homebridge-notify-switch/compare/v0.1.0-beta.6...v0.1.0-beta.7
[0.1.0-beta.6]: https://github.com/arodbuilds/homebridge-notify-switch/compare/v0.1.0-beta.5...v0.1.0-beta.6
[0.1.0-beta.5]: https://github.com/arodbuilds/homebridge-notify-switch/compare/v0.1.0-beta.4...v0.1.0-beta.5
[0.1.0-beta.4]: https://github.com/arodbuilds/homebridge-notify-switch/compare/v0.1.0-beta.3...v0.1.0-beta.4
[0.1.0-beta.3]: https://github.com/arodbuilds/homebridge-notify-switch/compare/v0.1.0-beta.2...v0.1.0-beta.3
[0.1.0-beta.2]: https://github.com/arodbuilds/homebridge-notify-switch/compare/v0.1.0-beta.1...v0.1.0-beta.2
[0.1.0-beta.1]: https://github.com/arodbuilds/homebridge-notify-switch/releases/tag/v0.1.0-beta.1
