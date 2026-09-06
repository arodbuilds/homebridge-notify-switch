# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

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
- CI workflow that lints, builds and runs the harness on Node 22 and 24.
