/**
 * In-app copy, verbatim from SPEC section 11.3.
 */

export const GETTING_STARTED = 'Notify Switch creates HomeKit switches that send a message when turned on. Set it up in three steps: '
  + 'add a Provider (the service that sends messages), create a Recipient Group (who receives them), then create a Switch (what to send). '
  + 'You only need one provider. After saving, restart Homebridge, then use the switch in a HomeKit automation or scene. '
  + 'The switch turns itself off after sending.';

export const PROVIDERS_SECTION = 'A provider is a connection to a messaging service. Twilio sends SMS and, with an authenticated domain, email. '
  + 'SMTP sends email through an account you already have, such as Fastmail, Gmail, or iCloud. Telegram sends to a chat through a bot you create. '
  + 'Add only the providers you plan to use. Use Test connection to confirm credentials before saving.';

export const TWILIO_HELP = {
  accountSid: 'Identifies your Twilio account and is not a secret. Found on the Twilio Console home page under Account Info. Starts with AC.',
  apiKey: 'Create a Standard API key at Console > Account > API keys & tokens. The secret is shown once; store it in a password manager. '
    + 'An API key can be revoked without changing your account password, which is why the Auth Token is not accepted here.',
  smsSenders: 'Twilio phone numbers you own, from Console > Phone Numbers > Manage > Active numbers. Include the country code. '
    + 'US long codes must be registered for A2P 10DLC or messages will be filtered.',
  messagingServiceSid: 'Optional. Use a Messaging Service instead of a specific number. Found at Console > Messaging > Services. Starts with MG.',
  emailFrom: 'Optional. Required only to send email through Twilio. The domain must be authenticated at Console > Communications > Email > Domains.',
};

export const SMTP_HELP = {
  server: 'Your mail provider\'s outgoing server. Fastmail: smtp.fastmail.com, 465, SSL. Gmail: smtp.gmail.com, 465, SSL. '
    + 'iCloud: smtp.mail.me.com, 587, STARTTLS. Outlook.com: smtp-mail.outlook.com, 587, STARTTLS.',
  username: 'Usually your full email address.',
  password: 'Most providers require an app password rather than your login password. Fastmail: Settings > Privacy & Security > App passwords, scope SMTP. '
    + 'Gmail: Google Account > Security > App passwords. iCloud: appleid.apple.com > Sign-In and Security > App-Specific Passwords.',
  fromAddress: 'Must be an address your provider allows you to send from.',
};

export const TELEGRAM_HELP = {
  botToken: 'Message @BotFather in Telegram, send /newbot, and follow the prompts. BotFather replies with the token. '
    + 'Then open a chat with your new bot and send it any message so it can find you.',
  chatIds: 'Chat IDs are numbers, not usernames. Use Find chat IDs above after messaging the bot. Group chats have negative IDs.',
};

export const GROUPS_SECTION = 'A group is a named list of people. Add phone numbers for SMS, email addresses for email, and chat IDs for Telegram. '
  + 'Switches send to groups, so you enter each person once here and reuse them everywhere. Phone numbers need a country code; pick it from the dropdown.';

export const SWITCHES_SECTION = 'Each switch appears in the Home app. Turning it on sends every action listed below it, then the switch turns itself off. '
  + 'Add one action per channel you want to use. Cooldown prevents an automation that fires repeatedly from sending the same message over and over. '
  + 'The failure sensor is optional; turn it on if you want a HomeKit automation to tell you when a message did not go out.';

export const SWITCH_HELP = {
  name: 'Letters, numbers, spaces, and apostrophes only. Must start and end with a letter or number. This is the name shown in the Home app.',
  cooldownSeconds: 'Minimum seconds between sends for this switch. 0 disables the cooldown.',
  failureMode: 'Any: the sensor trips if any recipient fails. All: only if every recipient fails. Off: never trips; failures are still logged.',
  bodySms: 'Up to 160 characters using standard characters. Emoji and some symbols are not allowed because they shorten the limit and can split the message. '
    + 'Variables: {{switchName}}, {{time}}, {{date}}.',
  bodyOther: 'Plain text. Variables: {{switchName}}, {{time}}, {{date}}, {{datetime}}.',
};

export const HOMEKIT_USAGE = 'After saving, restart Homebridge. Your switches appear in the Home app. Open Automations, choose a trigger such as a sensor '
  + 'detecting water, and add the switch with Turn On as the action. You can also test by tapping the switch directly.';
