import type { ProviderType } from '../../src/types.js';

/**
 * In-app copy, verbatim from SPEC section 11.3. Field help is one sentence; anything longer is a
 * "Where do I find this?" link to the matching README section.
 */

/**
 * Links into the README on GitHub are written out in full (not built from a base) so the harness can
 * read every anchor from the built bundle and check that the README section exists.
 */
export const README_URL = 'https://github.com/arodbuilds/homebridge-notify-switch';

export const WHERE_LINK = 'Where do I find this?';

export interface HelpLink {
  text: string;
  href: string;
}

export const GETTING_STARTED = 'Notify Switch adds switches to the Home app. Turn one on, usually from an automation, and it sends a message, '
  + 'then turns itself off.';

export const GETTING_STARTED_STEPS = 'Set up in three steps: add a Provider (the service that sends), create a Recipient Group (who receives), '
  + 'then create a Switch (what to send). You only need one provider. Save, restart Homebridge, and add the switch to a HomeKit automation.';

export const PROVIDERS_SECTION = 'A provider is the service that delivers your messages. Add only the ones you will use.';

/** Provider chooser (SPEC section 11.2, item 13): one tile per type, the display name each creates, and the id base. */
export const PROVIDER_CHOOSER: Record<ProviderType, { title: string; help: string; name: string }> = {
  twilio: { title: 'Twilio', help: 'SMS text messages, and email if you have a Twilio-authenticated domain.', name: 'Twilio' },
  smtp: { title: 'Email (SMTP)', help: 'Send from a mailbox you already have, such as Fastmail, Gmail, iCloud, or Outlook.', name: 'Email' },
  telegram: { title: 'Telegram', help: 'Free messages through a bot you create. Best for family group chats.', name: 'Telegram' },
};

export const CHOOSER = {
  add: 'Add provider',
  prompt: 'Which service should send your messages?',
  cancel: 'Cancel',
};

/** Provider type badge text in card headers and dropdowns (SPEC section 11.2, item 13). */
export const PROVIDER_TYPE_LABEL: Record<ProviderType, string> = { twilio: 'Twilio', smtp: 'SMTP', telegram: 'Telegram' };

/** Provider Name field help, with examples (SPEC section 11.3). */
export const PROVIDER_NAME_HELP = 'How this provider is listed when you set up a switch. For example: Twilio, Home Gmail, Family bot.';

/** Guided empty state (SPEC section 11.2, item 19): the Get started card and the disabled Add buttons. */
export const GET_STARTED = {
  title: 'Get started',
  intro: 'Choose how you want to send messages. You can add more providers later.',
  addProviderFirst: 'Add a provider first.',
};

/** The Save status line at the bottom of the page while there is nothing to save (SPEC section 11.2, item 19). */
export const SAVE_STATUS = {
  nothing: 'Nothing to save yet',
  reset: 'Configuration reset. Click Save, then restart Homebridge.',
};

/** Version and credit footer (SPEC section 11.2, item 20). */
export const FOOTER = {
  name: 'Notify Switch',
  madeBy: 'Made by Alex Rodriguez',
  site: 'alex-rodriguez.com',
  siteUrl: 'https://alex-rodriguez.com/?ref=notify-switch#building',
  issues: 'Report an issue',
  issuesUrl: 'https://github.com/arodbuilds/homebridge-notify-switch/issues',
};

/** The ID under a card's Advanced disclosure (SPEC section 11.2, item 14). */
export const ID_FIELD = {
  label: 'ID',
  edit: 'Edit',
  providerHelp: 'How switches refer to this provider in config.json.',
  groupHelp: 'How switches refer to this group in config.json.',
};

export const CREDENTIALS_FILE_HELP = 'Optional. A JSON file, relative to the Homebridge storage directory, that holds this provider\'s secrets '
  + 'so they stay out of config.json.';
export const CREDENTIALS_FILE_LINK: HelpLink = {
  text: WHERE_LINK, href: 'https://github.com/arodbuilds/homebridge-notify-switch#keeping-secrets-out-of-configjson-with-credentialsfile',
};

export const TWILIO_HELP = {
  accountSid: 'Copy from the Twilio Console home page. It starts with AC and is not a secret.',
  accountSidLink: { text: WHERE_LINK, href: 'https://github.com/arodbuilds/homebridge-notify-switch#twilio-sms-and-email' } as HelpLink,
  apiKey: 'Create a Standard key in the Twilio Console and paste its SID and secret. The secret is shown once.',
  apiKeyLink: { text: 'Why not the Auth Token?', href: 'https://github.com/arodbuilds/homebridge-notify-switch#api-keys' } as HelpLink,
  smsSenders: 'Numbers you own in Twilio. Use Look up numbers to pick from your account.',
  smsSendersNote: 'US numbers must be registered for A2P 10DLC or carriers will block messages.',
  smsSendersNoteLink: {
    text: 'How do I register?', href: 'https://github.com/arodbuilds/homebridge-notify-switch#a2p-10dlc-registration-for-us-numbers',
  } as HelpLink,
  messagingServiceSid: 'Optional. Use a Messaging Service instead of a specific number. Found at Console > Messaging > Services. Starts with MG.',
  emailFrom: 'Send email from this address through Twilio. Its domain must be verified in the Twilio Console under Email > Domains.',
  emailFromLink: { text: WHERE_LINK, href: 'https://github.com/arodbuilds/homebridge-notify-switch#email-through-twilio' } as HelpLink,
};

export const SMTP_HELP = {
  presetLabel: 'Mail provider',
  preset: 'Pick your mail service to fill in the server settings. Choose Other for any other mail server.',
  server: 'Your mail provider\'s outgoing server settings. For example: smtp.fastmail.com, 465, SSL.',
  serverLocked: 'Filled in from the mail provider above. Click Edit to change them.',
  edit: 'Edit',
  username: 'Usually your full email address. For example: you@example.com.',
  password: 'Use an app password, not your login password. Most providers require it.',
  passwordLink: { text: 'Where do I create one?', href: 'https://github.com/arodbuilds/homebridge-notify-switch#app-passwords' } as HelpLink,
  fromAddress: 'The address messages come from. Your provider must allow sending from it. For example: alerts@example.com.',
  fromName: 'Optional. Some providers replace this with your account\'s display name.',
};

export const TELEGRAM_HELP = {
  botToken: 'BotFather sends the token. It looks like 123456789:AAF… Treat it like a password.',
  botTokenLink: { text: WHERE_LINK, href: 'https://github.com/arodbuilds/homebridge-notify-switch#telegram' } as HelpLink,
  chatIds: 'Use Find people and groups on your Telegram provider. IDs are numbers, not usernames.',
  parseMode: 'How Telegram reads the message. Plain text is the safest choice.',
};

export const GROUPS_SECTION = 'A group is a list of people. Switches send to groups, so you enter each person once.';

/** Group Name field help, with examples (SPEC section 11.3). */
export const GROUP_NAME_HELP = 'Who is in this list. For example: Family, Neighbors, On-call.';

export const SWITCHES_SECTION = 'Each switch appears in the Home app. Turning it on runs every action below it, then the switch turns itself off. '
  + 'Add one action per channel you want.';

export const SWITCH_HELP = {
  name: 'Shown in the Home app. Letters, numbers, spaces, and apostrophes. For example: Water Leak Alert, Smoke Alarm.',
  cooldownSeconds: 'Minimum seconds between sends for this switch. 0 disables the cooldown.',
  failureMode: 'Any: the sensor trips if any recipient fails. All: only if every recipient fails. Off: never trips; failures are still logged.',
  failureSensor: 'Adds a sensor to this switch that HomeKit automations can watch. It opens when a message fails to send.',
  failureSensorReset: 'Seconds after a failure before the sensor closes again on its own. 0 keeps it open until the next successful send.',
  subject: 'Optional. Defaults to the switch name.',
  bodySms: 'Up to 160 plain characters. Emoji and special symbols are not allowed for SMS.',
  bodyOther: 'Plain text.',
  sender: 'Automatic uses the only sender, or the Messaging Service when one is set.',
  bcc: 'Hide recipients from each other (BCC)',
  bccHelp: 'Recipients go in Bcc and your from address in To, so nobody sees the other addresses. A message to one recipient always uses To.',
};

/** The "Show variables" toggle next to every body and subject field (SPEC section 11.2, item 17). */
export const VARIABLES = {
  show: 'Show variables',
  hide: 'Hide variables',
  intro: 'Type these anywhere in the message or subject:',
  items: [
    ['{{switchName}}', 'the switch name'],
    ['{{time}}', 'the time, such as 14:05'],
    ['{{date}}', 'the date, such as 2026-09-07'],
    ['{{datetime}}', 'date and time together'],
  ],
  link: { text: 'More about variables', href: 'https://github.com/arodbuilds/homebridge-notify-switch#template-variables' } as HelpLink,
};

export const HOMEKIT_USAGE = 'After saving, restart Homebridge. Your switches appear in the Home app. Open Automations, choose a trigger such as a sensor '
  + 'detecting water, and add the switch with Turn On as the action. You can also test by tapping the switch directly.';

/** Per-card help toggle (SPEC section 11.2, item 16). */
export const HELP_TOGGLE = {
  show: 'Show help',
  hide: 'Hide help',
};

/** Validation messages (SPEC section 11.3): what the value looks like and where to get it. */
export const VALIDATION = {
  accountSid: 'That does not look like an Account SID. It starts with AC and is 34 characters; copy it from the Twilio Console.',
  apiKeySid: 'That does not look like an API Key SID. It starts with SK and is 34 characters; copy it from the Twilio Console.',
  messagingServiceSid: 'That does not look like a Messaging Service SID. It starts with MG and is 34 characters; copy it from the Twilio Console.',
  botToken: 'That does not look like a bot token. BotFather sends it as numbers, a colon, then letters. Paste the whole thing.',
  port: 'Port is usually 465 or 587.',
  switchName: 'Use letters, numbers, spaces, and apostrophes, starting and ending with a letter or number.',
  /** Shown instead of the issue list while every remaining issue is on a card nobody has touched yet (SPEC section 11.2, item 15). */
  finishNew: (what: string): string => `Fill in the new ${what} to enable Save.`,
};

/** The "Fix these before saving" box (SPEC section 11.2, item 15): a link per field, collapsed to a count past three entries. */
export const ISSUES = {
  heading: 'Fix these before saving:',
  count: (n: number): string => `${n} field${n === 1 ? '' : 's'} need${n === 1 ? 's' : ''} attention`,
  showAll: 'Show all',
  hide: 'Hide',
  collapseAfter: 3,
};

/** In-place Remove confirmation on card footers (SPEC section 11.2, item 11). */
export const REMOVE = {
  question: (what: 'provider' | 'group' | 'switch'): string => `Remove this ${what}?`,
  confirm: 'Remove',
  cancel: 'Cancel',
};

/** Unsaved draft recovery banner (SPEC section 11.2, item 23). */
export const DRAFT = {
  message: 'You have unsaved changes from earlier. Restore them?',
  restore: 'Restore',
  discard: 'Discard',
};

/** Telegram onboarding flow (SPEC section 11.2, item 10). */
export const TELEGRAM_ONBOARDING = {
  botFatherUrl: 'https://t.me/BotFather',
  step1Title: 'Create your bot',
  step1Intro: 'On your phone, scan this code with the camera to open BotFather in Telegram. On a computer with Telegram installed, '
    + 'click Open BotFather instead. Then, in the BotFather chat:',
  openBotFather: 'Open BotFather',
  botFatherCaption: 'Scan to open BotFather',
  step1Instructions: [
    'Send /newbot.',
    'Choose a display name such as Home Alerts.',
    'Choose a username ending in bot, for example homealerts_bot.',
    'BotFather replies with a token. Copy it and paste it below.',
  ],
  step2Title: 'Choose how people receive messages',
  groupTitle: 'Family group chat (recommended)',
  groupText: 'Everyone in the group gets every message. Nobody has to opt in individually.',
  individualTitle: 'Individual chats',
  individualText: 'Each person opens the bot and taps Start once.',
  step3GroupTitle: 'Add the bot to your group',
  addToGroup: 'Add bot to a group',
  groupCaption: 'Scan to add the bot to a group',
  groupSentence: 'Open Telegram on your phone and scan, or click the button, then pick your family group or create one. '
    + 'Everyone in the group will get alerts.',
  step3Title: 'Invite people',
  inviteCaption: 'Scan to start receiving alerts',
  enlarge: 'Enlarge',
  copyLink: 'Copy link',
  copyInvite: 'Copy invite message',
  openInTelegram: 'Open in Telegram',
  share: 'Share',
  inviteMessage: (username: string): string => `Tap this link and press Start to get alerts from our home: https://t.me/${username}?start=join`,
  connectFirst: 'Connect your bot in step 1 to get the links and QR codes.',
  findTitle: 'Find people and groups',
  findHelp: 'Lists everyone who has opened the bot and every group it has been added to. Choose a recipient group, then add people to it.',
  chooseGroup: 'Choose a recipient group first.',
  noGroups: 'Add a recipient group under Recipient Groups first.',
  afterFind: 'Added people appear in the group\'s Telegram chat IDs list. Save when you\'re done.',
};

/** Twilio "Look up numbers" (SPEC section 11.2, item 9). */
export const TWILIO_LOOKUP = {
  button: 'Look up numbers',
  help: 'Lists the phone numbers and Messaging Services on your Twilio account so you can pick instead of typing. Manual entry always works.',
  numbersLabel: 'Add a phone number from your account',
  servicesLabel: 'Use a Messaging Service from your account',
  numbersPlaceholder: 'Choose a phone number…',
  servicesPlaceholder: 'Choose a Messaging Service…',
};

/** Switch card Test send confirmation and its disabled-state hints (SPEC section 11.3). */
export const TEST_SEND = {
  confirm: (count: number): string => `Send to ${count} recipient${count === 1 ? '' : 's'} now?`,
  send: 'Send',
  cancel: 'Cancel',
  dismiss: 'Dismiss',
  fixErrors: 'Fix the errors above first',
  noRecipients: 'No recipients yet',
};

/** Settings > Advanced: backup, restore and reset (SPEC section 11.2, item 12). */
export const BACKUP = {
  summary: 'Advanced',
  backupNote: 'The full backup contains your provider credentials; store it like a password. '
    + 'The version without credentials is safe to share when asking for help.',
  download: 'Download backup',
  downloadWithoutCredentials: 'Download backup without credentials',
  restore: 'Restore from backup',
  restoreHelp: 'Choose a backup file. It is checked before anything changes; if it passes, the form is replaced with its contents and Save is enabled.',
  restoreFailed: 'The backup could not be loaded:',
  restored: 'Backup loaded. Review the form, then click Save.',
  restoredWithoutCredentials: 'Backup loaded. Enter the credentials it left out, then click Save.',
  reset: 'Reset plugin to fresh install',
  resetTitle: 'Reset plugin to fresh install?',
  resetList: [
    'All providers, groups, switches, and settings are removed.',
    'Switches disappear from the Home app after the next restart.',
    'Credentials files on disk are not touched.',
  ],
  resetDownloadFirst: 'Download backup first',
  resetPrompt: 'Type RESET to confirm.',
  resetConfirm: 'Confirm',
  resetDone: 'The configuration has been reset. Click Save, then restart Homebridge.',
};
