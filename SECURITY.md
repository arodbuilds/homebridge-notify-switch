# Security policy

## Supported versions

Only the newest release receives security fixes. Older versions do not.

## Reporting a vulnerability

Please report vulnerabilities privately through GitHub: open the Security tab of this repository and choose Report a vulnerability. Do not open a public issue for security problems, and do not include real credentials, phone numbers, or message contents in the report; redacted examples are enough.

You will get an acknowledgement as soon as I can, a fix or mitigation as soon as one is ready, and credit in the release notes if you want it.

## Scope

In scope: anything that could expose a provider credential (Twilio API key, SMTP password, Telegram bot token, ntfy token), including through logs, the settings UI, the UI server endpoints, or a backup marked as credential-free; anything that lets the settings page or config.json execute code or reach a host the user did not configure; message content or recipient lists reaching anyone other than the configured recipients; and any way to send a message without turning a switch on.

Out of scope: a provider changing or retiring its API, SMS carrier filtering or registration requirements, tracking added by a provider to email it delivers, the security of a server the user chose to configure (a self-hosted ntfy instance, a mail server), and the Homebridge UI itself. Those are reported as ordinary issues, or to the provider.
