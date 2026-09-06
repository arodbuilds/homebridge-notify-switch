# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.0-beta.3] - 2026-09-06

### Added

- Uncovered channel warnings. For each switch, the channels present in the groups it targets are compared with the channels its actions cover. The settings UI shows a warning on the switch card for each uncovered channel ("This switch sends to a group with email addresses, but it has no email action. Those recipients will not receive anything.", worded per channel) with an "Add email action" (or SMS, or Telegram) button that appends an action for that channel with the first provider serving it preselected and the targeted groups that hold addresses on that channel selected. It is a warning, not a validation error, so Save stays enabled. Startup logs the same condition once per switch and channel as a warning with the switch name, the group ids and the channel. The detection lives in one module (`src/coverage.ts`) shared by the UI and startup validation, with harness coverage.
- Harness tests, one per provider, that send to three recipients where the second fails at once with a 4xx (Twilio error 21211 invalid To, Telegram 400 chat not found, SMTP 550 recipient rejected) and assert that the first and third are still sent and reported ok while the second is reported failed with the code. A further test drives the per-recipient runner directly with tasks that throw synchronously and reject asynchronously.
- Headless Chromium smoke test for the built settings UI (`test/harness/ui-layout.test.mjs`, on `playwright-core`, a dev dependency that downloads nothing). It loads the page with the host's Bootstrap appended after the plugin stylesheet, as the Homebridge UI does, and checks at 400px, 599px and 900px that no rendered element has a bounding box starting left of the viewport or ending past it, that the page has no horizontal scroll, that the two-column grids stack to one column below 600px, and that the uncovered channel warning renders with its copy and button while Save stays enabled. It uses a Chromium or Chrome binary from `NOTIFY_SWITCH_CHROMIUM`, `CHROMIUM_PATH`, `CHROME_BIN`, the usual install paths or the `chrome` channel; without one it is skipped locally and fails on CI.

### Changed

- Per-recipient continuation is explicit. Providers that send one request per recipient (Twilio SMS, Telegram) collect the outcomes through a shared runner (`sendEach` in `src/providers/http.ts`) built on `Promise.allSettled`, never `Promise.all`, so one recipient's rejection or thrown error becomes a failed result for that recipient alone while every other recipient is still sent and reported. The switch accessory collects its actions the same way. The runner carries a comment stating that one recipient's failure must never stop the others; nothing in the send path was found to throw or return early, so this replaces the implicit guarantee with a structural one.
- Account SID help text in the settings UI, `config.schema.json` and SPEC section 11.3 now reads: "Identifies your Twilio account and is not a secret. Found on the Twilio Console home page under Account Info. Starts with AC."
- Settings UI Test send confirmation: "Send now" is now the primary (blue) button and Cancel stays neutral. Red is reserved for Remove buttons only; no other button on the page uses it.
- Version bumped to `0.1.0-beta.3`.

### Fixed

- Settings UI content was clipped at the left edge of the settings modal: section headings, labels and help text started off-screen and the page scrolled horizontally. The iframe has no padding of its own, and the Settings section used bare Bootstrap `.row` elements whose negative gutter margins reached past the page. The page is now wrapped in a container with 16px of horizontal padding on both sides, and every two-column layout uses a gap-based grid (`.ns-grid`) with no negative margins that stacks to a single column below 600px. No element on the page has a negative margin or a width over 100%; the new smoke test enforces this.

## [0.1.0-beta.2] - 2026-09-06

### Added

- Harness tests that assert the exact URL, method, empty body and `Authorization` header of the Twilio connection test as submitted by the settings form, that pasted whitespace is trimmed, and that 401, 403, 404 and 5xx responses are classified with Twilio's code and message.

### Changed

- Release workflow: publishing now uses npm trusted publishing (GitHub OIDC) instead of the `NPM_TOKEN` secret, which is no longer referenced. The workflow upgrades npm to the latest release before publishing, because trusted publishing requires npm 11.5.1 or newer and the version bundled with Node.js 22 is older, and fails early if npm is still too old.
- Dependabot no longer opens pull requests for TypeScript major version updates.

### Fixed

- Settings UI Twilio **Test connection** failed with "Twilio rejected the API key" for valid keys. The test read the Account resource (`GET /2010-04-01/Accounts/{accountSid}.json`), which Twilio answered with 401 for a valid Standard key and which a Restricted key cannot read, and the handler dropped Twilio's error code and message on 401, so a working Standard key looked like a wrong secret. The test now lists one message (`GET /2010-04-01/Accounts/{accountSid}/Messages.json?PageSize=1`) with Basic auth of `apiKeySid:apiKeySecret`, which passes for Standard keys and for Restricted keys scoped to Messaging. Failure messages for 401, 403 and 404 now include Twilio's `code` and `message` when present, and a 403 names the missing Messaging permission.
- Settings UI password inputs use `autocomplete="new-password"` so browsers stop offering the saved Homebridge login in the API Key Secret, SMTP password and bot token fields.
- Twilio requests without a body no longer send a `Content-Type` header.
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

[Unreleased]: https://github.com/arodbuilds/homebridge-notify-switch/compare/v0.1.0-beta.3...HEAD
[0.1.0-beta.3]: https://github.com/arodbuilds/homebridge-notify-switch/compare/v0.1.0-beta.2...v0.1.0-beta.3
[0.1.0-beta.2]: https://github.com/arodbuilds/homebridge-notify-switch/compare/v0.1.0-beta.1...v0.1.0-beta.2
[0.1.0-beta.1]: https://github.com/arodbuilds/homebridge-notify-switch/releases/tag/v0.1.0-beta.1
