# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

- Release workflow: publishing now uses npm trusted publishing (GitHub OIDC) instead of the `NPM_TOKEN` secret, which is no longer referenced. The workflow upgrades npm to the latest release before publishing, because trusted publishing requires npm 11.5.1 or newer and the version bundled with Node.js 22 is older, and fails early if npm is still too old.
- Dependabot no longer opens pull requests for TypeScript major version updates.

### Fixed

- Release workflow: `npm publish` now passes `--access public`. npm requires it to generate provenance for a package that does not exist on the registry yet, so the first publish failed without it. Applies to both the `beta` and `latest` dist-tags, which share one publish command.

## [0.1.0-beta.1] - 2026-09-06

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
- Custom settings UI (`customUi` in `config.schema.json`, built with `@homebridge/plugin-ui-utils`) with Providers, Recipient Groups and Switches sections, platform settings, and the in-app copy from the specification. Plain HTML, CSS and TypeScript bundled with esbuild; libphonenumber-js is the only third party code in the bundle. The schema form remains complete as the fallback.
- Settings UI phone entry: country dropdown with flag, name and dial code defaulting to `defaultCountry`, national number field with a local placeholder, live validation and formatting, storage as E.164, and paste normalization that also sets the country.
- Settings UI SMS body counter with character, septet and segment counts and highlighting of characters outside GSM-7.
- Settings UI validation mirroring startup validation: issues are listed with the field they belong to and the Save button is disabled while any remain. Provider and group ids are suggested from the name, switch ids are generated as UUIDs, and provider, channel, sender and group pickers are dropdowns fed by the current configuration.
- Settings UI server (`homebridge-ui/server.js`, compiled from `src/ui`): Test connection per provider (SMTP `verify()`, Twilio account lookup, Telegram `getMe`), Find chat IDs for Telegram groups via `getUpdates`, and Test send per switch that requires a confirmation click and reports per-recipient results. Submitted credentials are used in memory for the one request, never logged, stored or returned; `credentialsFile` is applied the same way startup applies it.
- Harness coverage for the settings UI server handlers, including checks that no response contains a credential.
- Release workflow (`.github/workflows/release.yml`) that publishes to npm with provenance when a GitHub release is published: pre-releases under the `beta` dist-tag, releases under `latest`. The first publish authenticates with the `NPM_TOKEN` secret; later releases move to npm trusted publishing.
- Dependabot configuration for npm and GitHub Actions with weekly, grouped minor and patch updates.
- `CONTRIBUTING.md` with the development loop, the test command, and the release steps.

### Changed

- The send path is shared between the switch accessory and the settings UI's Test send (`src/send.ts`); behavior of the switch is unchanged.
- `@homebridge/plugin-ui-utils` is a runtime dependency because the Homebridge UI loads `homebridge-ui/server.js` from the installed package. The plugin itself never imports it.
- CI workflow that lints, builds and runs the harness on Node 22 and 24.
- The package is no longer marked private and is published as `0.1.0-beta.1`. The published package contains only `dist`, the built settings UI, `config.schema.json`, `README.md`, `CHANGELOG.md`, `LICENSE`, and `package.json`; the source, tests, specification, and project conventions are excluded.
- README rewritten as the full user guide: provider setup guides with credential steps and links, recipient groups, switches and actions, HomeKit automations, template variables, cooldown and master switch, failure sensor, `credentialsFile`, child bridge, security notes, and troubleshooting by provider.

[Unreleased]: https://github.com/arodbuilds/homebridge-notify-switch/compare/v0.1.0-beta.1...HEAD
[0.1.0-beta.1]: https://github.com/arodbuilds/homebridge-notify-switch/releases/tag/v0.1.0-beta.1
