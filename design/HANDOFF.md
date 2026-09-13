# Handoff: homebridge-notify-switch settings page

## Status (September 12, 2026)
Design reference: the **Notify Switch** tab of `Plugin Settings Standard.dc.html` in the project root, exported here as `notify-switch-settings.html`. The page runs on the same shell as the Peloton plugin (see `design_handoff_peloton/`) at its beta.2 level: draft-restore bar, fresh-install behaviour, card header with help toggle, 12-column body grid, sticky validation summary. Anything described as "shell" below is shared across all plugins and must be implemented once, identically.

## Overview
The Homebridge config UI (custom UI under `homebridge-ui/`) for **homebridge-notify-switch**, display name **Notify Switch**. The plugin adds switches to the Home app; turning one on (usually from an automation) sends a message through SMS, email, Telegram or ntfy, then the switch turns itself off. The page sets up **Providers** (services that send), **Recipient Groups** (who receives), **Switches** (what to send) and plugin-wide **Settings**.

## About the design file
`notify-switch-settings.html` is a **design reference built in HTML**: a single self-contained interactive prototype. It is not production code. Recreate it inside the plugin's custom UI (`homebridge-ui/public/index.html` + the `homebridge-plugin-ui-utils` API) using the host's Bootstrap variables, not by shipping this file. The review chrome above the modal (theme / width / fresh install toggles) is design tooling only.

Open the prototype in a browser and use the toolbar:
- **Dark theme**: host dark theme.
- **iPad width / Phone width / Modal width**: cycles 800 → 768 → 400 px.
- **Fresh install**: empty first run (Get started panel, gated sections, no draft bar).

## Fidelity
**High-fidelity for structure, copy, states and behaviour. Host-themed for colour and type.** Every colour is a Homebridge/Bootstrap variable (see Design tokens) so the page follows the host; the plugin owns no palette. Recreate spacing, type sizes, control heights, copy and states exactly. Hard-coded hex fallbacks in the prototype are the host's light-theme values.

## Copy rules
Sentence case. No em dashes. "Switch" for the HomeKit accessory, "provider" for a sending service, "group" for a recipient list. Help text is one or two plain sentences; examples are introduced with "For example:".

## Page order (top to bottom)
1. Plugin banner: `assets/notify-switch-banner.png`, 4:1, full container width, 6 px radius, 16 px top margin. Alt: "Notify Switch — Homebridge switches that send SMS, email, Telegram, or ntfy messages when turned on."
2. Unsaved-changes bar (shell, host machinery): "You have unsaved changes from earlier. Restore them?" RESTORE (primary, 31 px) / DISCARD. Never shown on a fresh install.
3. Intro paragraph one: "Notify Switch adds switches to the Home app. Turn one on, usually from an automation, and it sends a message, then turns itself off."
4. Intro paragraph two: "Set up in three steps: add a Provider (the service that sends), create a Recipient Group (who receives), then create a Switch (what to send). You only need one provider. Save, restart Homebridge, and add the switch to a HomeKit automation."
5. Sections: **Providers**, **Recipient Groups**, **Switches**, **Settings**
6. Sticky "Fix these before saving:" summary while anything blocks Save
7. Saved status box after Save: "Saved. Restart Homebridge to apply."
8. Closing paragraph: "After saving, restart Homebridge. Your switches appear in the Home app. Open Automations, choose a trigger such as a sensor detecting water, and add the switch with Turn On as the action. You can also test by tapping the switch directly."
9. Footer line (12.6 px muted, 1 px top rule): 20 px footer glyph (`assets/notify-switch-mark.svg`, currentColor, inlined) · "Notify Switch v{version}" · "Made by Alex Rodriguez" · alex-rodriguez.com · Report an issue.

Container: one root element, `padding: 0 16px 16px`, `overflow-wrap: anywhere`. The host draws the modal, title bar ("Notify Switch", ✕) and the CLOSE / SAVE footer.

## Section anatomy (shell)
- `h2` 20 px weight 300, 1 px bottom rule (`--ns-border`), 4 px padding-bottom, 8 px below. 24 px above each section.
- One intro sentence (14.4 px).
- Cards, then exactly one Add button (38 px, `--ns-primary` fill, white uppercase 16 px, 4 px radius).
- **Gating**: Recipient Groups and Switches are gated on at least one provider. While gated, the Add button is outlined, disabled (`cursor: not-allowed`, secondary text) with the hint "Add a provider first." beside it.
- **Get started** (first section, nothing configured): the chooser tiles render inline inside a framed panel with the prompt "Get started. Choose how you want to begin — you can add more later." and no Cancel.

### Card (shell)
1 px `--ns-cardborder`, 6 px radius, 16 px below, `overflow: hidden`.
- **Header strip**: `--ns-subtle` fill, 8 px 16 px padding, 1 px bottom rule. Left: bold title (live from the Name field; falls back to "New {noun}"), type badge (`--ns-badge` fill, white 11.5 px weight 600, 3 px 7 px padding, 4 px radius), status badge when set (`--ns-success` fill: "Default for ntfy", "Default for email"). Right cluster (12.6 px links, 12 px gap): "Make default for {channel}" (link colour, providers that can be a default), then "Show help / Hide help" (secondary colour).
- **Body**: 16 px 16 px 0 padding; 12-column grid, 8 px column gap, 16 px under each field; every cell full width below 600 px.
- **Advanced**: disclosure link "▸ Advanced / ▾ Advanced" (12.6 px secondary) under the grid; opens a second 12-column grid.
- **Result bar** (after Test): 12 px 16 px, 1 px top rule, message + "Dismiss" link.
- **Footer strip**: `--ns-subtle`, 8 px 16 px, 1 px top rule. Right: primary action as an outlined `--ns-link` 31 px button ("Test connection" on providers, "Test send" on switches). Left: "Remove {noun}" (danger text button; confirms in place: "Remove {title}?" + red REMOVE 31 px + Cancel link), "Duplicate {noun}" link where allowed (groups, switches).
- Help toggle hides every 12.6 px help caption in the card at once; default is help shown.

### Field types (shell)
- **text / number / time / password**: label 14.4 px weight 600 (+ red `*` when required), control 38 px, 6 px radius, 11 px side padding, 16 px text. Password gets an attached SHOW / HIDE button on the right. Readonly fields show an "Edit" link at the label's right and a locked look.
- **select**: same control; options listed per field below.
- **textarea**: 3 rows.
- **check**: 16 px checkbox, label 14.4 px, caption under the label.
- **list**: rows of (input + 31 px REMOVE), "None yet." when empty, then a 31 px outlined add button with the field's add label. Rows flagged `storedAs` show a green 12.6 px "Stored as +15550101234" line under the input.
- **note**: caption-only row (12.6 px secondary) with optional link.
- **block**: bold 14.4 px sub-heading with a caption; groups the checks that follow.
- **step**: numbered panel (1 px `--ns-border`, 6 px radius, 12 px padding): 24 px numbered disc (`--ns-locked`), bold label, caption, then child fields / actions.
- **action**: 31 px outlined uppercase button with optional caption. **danger** action: red text button.
- **preview**: 14.4 px text with a 3 px left rule in `--ns-border`.
- Optional trailing help link (`linkText`) renders in `--ns-link` at the end of the caption.

## Providers
Intro: "A provider is the service that delivers your messages. Add only the ones you will use."
**Add provider** opens the chooser "Which service should send your messages?" with four tiles (auto-fit grid, min 150 px; single column on phone):
- Twilio: "SMS text messages, and email if you have a Twilio-authenticated domain."
- Email (SMTP): "Send from a mailbox you already have, such as Fastmail, Gmail, iCloud, or Outlook."
- Telegram: "Free messages through a bot you create. Best for family group chats."
- ntfy: "Free push notifications to the ntfy app. No account needed for public topics."
Cancel closes it. A new card starts empty and focuses Name.

Shared Name caption for every provider: "How this provider is listed when you set up a switch. For example: Twilio, Home Gmail, Family bot."
Shared Credentials File caption: "Optional. A JSON file, relative to the Homebridge storage directory, that holds this provider's secrets so they stay out of config.json." + link "Where do I find this?"

### Twilio (badge "Twilio", can be made default)
- Name (required, default "Twilio")
- Account SID (required). Caption "Copy from the Twilio Console home page. It starts with AC and is not a secret." + "Where do I find this?"
- API Key SID (required, placeholder "e.g. SK…"). Caption "Create a Standard key in the Twilio Console and paste its SID and secret. The secret is shown once." + link "Why not the Auth Token?"
- API Key Secret (password, required)
- SMS Senders (list, add label "Add sender number", placeholder "e.g. (555) 010-1234", stored-as line). Caption "Numbers you own in Twilio. Use Look up numbers to pick from your account."
- Note: "US numbers must be registered for A2P 10DLC or carriers will block messages." + link "How do I register?"
- Action "Look up numbers". Caption "Lists the phone numbers and Messaging Services on your Twilio account so you can pick instead of typing. Manual entry always works."
- Email From address (7 cols, placeholder "e.g. alerts@example.com"). Caption "Send email from this address through Twilio. Its domain must be verified in the Twilio Console under Email > Domains." + "Where do I find this?"
- Email From name (5 cols, placeholder "e.g. Home")
- Advanced: ID (readonly, 6 cols, "twilio"; caption "How switches refer to this provider in config.json."), Messaging Service SID (6 cols, placeholder "MG…"; caption "Optional. Use a Messaging Service instead of a specific number. Found at Console > Messaging > Services. Starts with MG."), Credentials File (12 cols, placeholder "e.g. notify-switch-twilio.json").
- Primary action: Test connection → result "Connected and signed in."

### ntfy (badge "ntfy", status "Default for ntfy")
- Name (required, default "ntfy")
- Note: "ntfy delivers to the ntfy app on your phone. Install the app, subscribe to a topic name of your choosing, and add that topic to a group. Anyone who knows the topic name can read it, so pick something unguessable or use an access token." + "Where do I find this?"
- Server (required, default "https://ntfy.sh"). Caption "Leave as ntfy.sh unless you run your own server."
- Authentication (select: None / Access token (recommended) / Username and password; default None). Caption for None: "No credentials. Works for public topics on ntfy.sh; anyone who guesses the topic name can publish to it too." + "Where do I find this?" (Token and username/password reveal their own fields in the real UI.)
- Advanced: ID (readonly, "ntfy"), Credentials File (placeholder "e.g. notify-switch-ntfy.json"), 6 cols each.
- Primary: Test connection.

### Email (SMTP) (badge "SMTP", status "Default for email")
- Name (required, default "Fastmail")
- Mail provider (select: Fastmail / Gmail / iCloud / Outlook.com / Yahoo / Zoho / Other). Caption "Pick your mail service to fill in the server settings. Choose Other for any other mail server."
- Host (readonly, 7 cols, "smtp.fastmail.com"), Port (readonly, 2 cols, "465"), Security (readonly select, 3 cols, SSL / STARTTLS / None). Caption "Filled in from the mail provider above. Click Edit to change them." Choosing Other unlocks them.
- Username (required, default "you@example.com"). Caption "Usually your full email address. For example: you@example.com."
- Password (password, required). Caption "Use an app password, not your login password. Most providers require it." + link "Where do I create one?"
- From address (required, 7 cols). Caption "The address messages come from. Your provider must allow sending from it. For example: alerts@example.com."
- From name (5 cols, default "Home"). Caption "Optional. Some providers replace this with your account's display name."
- Advanced: ID (readonly, "fastmail"), Credentials File (placeholder "e.g. notify-switch-fastmail.json").
- Primary: Test connection.

### Telegram (badge "Telegram")
- Name (required, default "Telegram")
- Step 1 "Create your bot". Caption "On your phone, scan this code with the camera to open BotFather in Telegram. On a computer with Telegram installed, click Open BotFather instead. Then, in the BotFather chat: send /newbot, choose a display name such as Home Alerts, choose a username ending in bot, and BotFather replies with a token." Children: action "Open BotFather"; Bot Token (password, required; caption "BotFather sends the token. It looks like 123456789:AAF… Treat it like a password." + "Where do I find this?"). The real UI shows a QR code beside the button.
- Step 2 "Choose how people receive messages". Delivery (select: Family group chat (recommended) / Individual chats). Caption "Everyone in the group gets every message. Nobody has to opt in individually."
- Step 3 "Add the bot to your group". Caption "Connect your bot in step 1 to get the links and QR codes." Empty until the token is verified.
- Step 4 "Find people and groups". Caption "Lists everyone who has opened the bot and every group it has been added to. Choose a recipient group, then add people to it." Children: Recipient group (select of existing groups), action "Find people and groups".
- Advanced: ID (readonly, "telegram"), Parse mode (select: Plain text / Markdown / HTML; caption "How Telegram reads the message. Plain text is the safest choice."), 6 cols each.
- Primary: Test connection.

## Recipient Groups (gated on a provider)
Intro: "A group is a list of people. Switches send to groups, so you enter each person once."
Card, no type badge. Fields:
- Name (required, default "Family - Garage"). Caption "Who is in this list. For example: Family, Neighbors, On-call."
- Phone numbers (SMS) (list, "Add phone number", placeholder "e.g. (555) 010-2345"). Caption "Stored with the country code from Settings."
- Email addresses (list, "Add email address", placeholder "e.g. sam@example.com")
- Telegram chat IDs (list, "Add chat ID"). Caption "Use Find people and groups on your Telegram provider. IDs are numbers, not usernames."
- ntfy topics (list, "Add topic"). Caption "Topic names as subscribed in the ntfy app. Letters, numbers, dashes and underscores."
- Advanced: ID (readonly, 6 cols, "family"; caption "How switches refer to this group in config.json.")
- Footer: Remove group, Duplicate group. No primary action. **Add group** adds a card directly (no chooser).

## Switches (gated on a provider)
Intro: "Each switch appears in the Home app. Turning it on sends your message to everyone in the groups you pick, on every channel they have, then the switch turns itself off."
Card, no type badge. Fields:
- Name (required, default "Door Open Notification", placeholder "e.g. Water Leak Alert"). Caption "Shown in the Home app. Letters, numbers, spaces, and apostrophes. For example: Water Leak Alert, Smoke Alarm."
- Enabled (check, on)
- Cooldown (seconds) (number, 6 cols, default 0). Caption "Minimum seconds between sends for this switch. 0 disables the cooldown."
- Failure Mode (select, 6 cols: Any / All / Off; default Any). Caption "Any: the sensor trips if any recipient fails. All: only if every recipient fails. Off: never trips; failures are still logged."
- Failure Sensor (check, off). Caption "Adds a sensor to this switch that HomeKit automations can watch. It opens when a message fails to send."
- Block "Recipients": "Everyone in the groups you tick gets the message on every channel they have an address for." One check per group, labelled "{Group}: 4 SMS, 4 email, 1 ntfy" (live counts).
- Block "Extra recipients": "People outside the groups above, entered under their channel." Lists (6 cols each): Phone numbers (SMS), Email addresses, ntfy topics.
- Block "Send by": "Untick a channel to skip it for this switch." Checks (4 cols each): "SMS (4 numbers)", "Email (4 addresses)", "ntfy (1 topic)" (live counts; a channel with no provider is omitted).
- Message (textarea, required, default "Did you forget something? As of {{time}} the garage door has remained open for more than 15 minutes."). Caption "Up to 160 plain characters. Emoji and special symbols are not allowed for SMS." + link "More about variables"
- Subject (default "Did you forget something?"). Caption "Used as the email subject and the ntfy title. Defaults to the switch name."
- Preview line: "Will send SMS via Twilio to 4 numbers, email via Fastmail to 4 addresses, ntfy via ntfy to 1 topic." (live)
- Advanced: ID (readonly, 12 cols, UUID; caption "Generated. HomeKit tracks the switch by this id, so you can rename it freely."); Customize message per channel (check; caption "Write a different message for each channel. Each starts as a copy of the shared message."); Email provider (select, 6 cols: Platform default (Fastmail) / Fastmail (SMTP) / Twilio; caption "For this switch only. The default for every switch is under Settings."); Priority (select, 6 cols: Min / Low / Default / High / Urgent; caption "How the app announces it. Urgent and high can break through Do Not Disturb; min shows no notification."); Hide recipients from each other (BCC) (check; caption "Recipients go in Bcc and your from address in To, so nobody sees the other addresses. A message to one recipient always uses To."); Tags (6 cols, placeholder "e.g. warning, house"; caption "Optional. Up to 8, separated by commas. Emoji short codes such as warning or house show as icons in the app.").
- Footer: Test send (→ "Sent. The switch turned on, then off again."), Remove switch, Duplicate switch.

## Settings
Intro: "Platform-wide options. The default country is used when a phone number is entered without a country code." Fields render uncarded on the page grid.
- Name (required, 6 cols, default "Notify Switch"). Caption "Platform display name shown in the Homebridge logs."
- Default Country (select, 6 cols: United States (+1) / Canada (+1) / United Kingdom (+44) … full list in the real UI). Caption "Phone numbers entered without a country code are treated as numbers from this country."
- Time format (select, 6 cols: 12-hour (5:15 PM) / 24-hour (17:15))
- Date format (select, 6 cols: Month/Day/Year (9/8/2026) / Day/Month/Year (8/9/2026) / Year-Month-Day (2026-09-08)). Caption "Used by {{time}}, {{date}} and {{datetime}} in messages."
- Show master switch (check, 6 cols, on). Caption "A single switch in the Home app that turns all notifications on or off. When it is off, no switch sends anything."
- Master switch name (6 cols, default "Notifications Enabled"). Caption "Letters, numbers, spaces, and apostrophes only. Must start and end with a letter or number."
- Default email provider (select, 6 cols: Fastmail (SMTP) / Twilio). Caption "Switches send email through this provider unless a switch says otherwise under Advanced."
- Debug logging (check, off). Caption "Verbose logging, including message bodies and full recipient addresses. Credentials are never logged, even with this on."

Advanced (collapsed):
- Note: "The full backup contains your provider credentials; store it like a password. The version without credentials is safe to share when asking for help."
- Actions (6 cols each): "Download backup", "Download backup without credentials"
- Restore from backup (file, placeholder "Choose a file"). Caption "Choose a backup file. It is checked before anything changes; if it passes, the form is replaced with its contents and Save is enabled."
- Danger text button: "Reset plugin to fresh install"

## Validation (shell)
Validate on blur; a field is marked only after it has been touched. Invalid: red border + 12.6 px red message under the control. Valid required text fields: small green ✓ inside the control at the right.
- Empty required field: "{Label} is required."
- Duplicate name within a section (case-insensitive): "Another {noun} already uses this name."
- Summary box: sticky at the bottom of the scroll area, warning colours, "Fix these before saving:" then "{Card title}: {message}" entries that focus the field. SAVE is disabled (outlined, secondary text, `not-allowed`) while any entry exists.

## Interactions (shell)
- Add → chooser (providers) or direct card (groups, switches); the new card is expanded with help shown and Name focused.
- Remove confirms in place; Duplicate copies the card and its values with " copy" appended to the name.
- Help toggle per card; Advanced disclosure per card; both persist while the page is open.
- Test actions show the result bar until dismissed.
- Save: disabled while issues exist; on success shows the saved status box. Host handles the actual write and restart prompt.
- Fresh install: providers section shows the Get started panel, groups and switches show the disabled Add with "Add a provider first.", Settings keeps defaults, no draft bar.

## Phone width (< 600 px)
Every grid cell is full width; chooser tiles stack; card header badges wrap under the title while the link cluster stays on the first row; card footers wrap with the primary action on top. Touch targets at least 44 px.

## Design tokens (host Bootstrap variables; light → dark fallbacks)
- Page background `--ns-bg` #ffffff → #1c1c1c; text `--ns-text` #212529 → #ffffff
- Secondary text `--ns-secondary` rgba(33,37,41,.75) → rgba(222,226,230,.75)
- Rules `--ns-border` #dee2e6 → #495057; card border `--ns-cardborder` rgba(0,0,0,.176) → rgba(255,255,255,.15)
- Subtle strip `--ns-subtle` rgba(33,37,41,.03) → #262626; locked/disc `--ns-locked` #e9ecef → #343a40
- Link `--ns-link` #0d6efd → #6ea8fe; primary button `--ns-primary` #607d8b; danger #dc3545; success #198754; badge #6c757d
- Warning `--ns-warnbg` #fff3cd → #3a3524, `--ns-warntext` #664d03 → #ffe69c
- Type: host system stack. Body 14.4 px / 300 / 1.5; labels 14.4 px / 600; help 12.6 px / 300 / 1.4; h2 20 px / 300; controls 16 px; badges 11.5 px / 600; small buttons 13.5 px uppercase.
- Controls 38 px tall, 6 px radius, 11 px side padding. Small buttons 31 px, 4 px radius.
- Spacing: 16 px card padding, 24 px between sections, 12 px inside panels, 8 px grid gap, 16 px under each field.
- Banner artwork colours (the one place the plugin carries colour): field #16263a, mark #F2F2F3.

## Assets (`assets/`)
- `notify-switch-banner.png` 4:1 page banner.
- `notify-switch-mark.svg` footer glyph, currentColor, render at 20 px; inline it so it follows the host theme.

## Files
- `notify-switch-settings.html` self-contained interactive prototype (open directly in a browser).
- Source of truth in the design project: `Plugin Settings Standard.dc.html` (Notify Switch tab); its Build contract tab lists the shell invariants by id.
