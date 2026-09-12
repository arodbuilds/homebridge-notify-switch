# Contributing

Thanks for helping with Notify Switch. This page covers the local development loop and the checks a change has to pass. Behavior, field names, copy, and security rules are defined in [SPEC.md](./SPEC.md); read it before changing anything, and read [CLAUDE.md](./CLAUDE.md) for the project conventions that apply to every change.

## Prerequisites

- Node.js 22.12 or newer (24 also works; CI runs both).
- npm 10 or newer.

## Development loop

```shell
git clone https://github.com/arodbuilds/homebridge-notify-switch.git
cd homebridge-notify-switch
npm install
npm install --no-save homebridge-config-ui-x   # once, for the settings UI in the dev instance
npm run watch
```

`npm run watch` builds the plugin and the settings UI, links the package globally, and starts Homebridge with the development configuration in `test/hbConfig`. Open http://localhost:8581; the dev config runs the Homebridge UI without a login. Whenever a file under `src` changes, nodemon recompiles and restarts Homebridge.

The settings UI has its own build. After editing anything under `homebridge-ui/src`, run:

```shell
npm run build:ui
```

then close and reopen the plugin settings modal in the browser to load the new bundle. The bundle is written to `homebridge-ui/public/index.js`, which is gitignored and built on publish. The server side of the settings UI lives in `src/ui` and is compiled with the rest of the plugin; `homebridge-ui/server.js` only loads it.

To try real providers from the dev instance, do not put credentials in `test/hbConfig/config.json`, which is committed. Point the provider's `credentialsFile` at a JSON file inside `test/hbConfig` instead; new files in that directory are ignored by git, and the dev instance uses it as the Homebridge storage directory.

## Tests

```shell
npm test
```

This builds the plugin, then runs the harness in `test/harness` with Node's built-in test runner against the compiled `dist` output. `fetch` and the nodemailer transport are mocked, so the tests never touch the network and need no credentials. Each provider's success, per-recipient failure, timeout, and rate limit paths are covered, along with startup validation, `credentialsFile`, and the settings UI server handlers (including a check that no response contains a credential). The harness is excluded from the published package.

The `test/harness/ui-*.test.mjs` files open the built settings UI in headless Chromium through `playwright-core` (shared helpers in `test/harness/browser.mjs`): the layout test checks that nothing is clipped or overflows at phone and desktop widths and that card footers never put two primary buttons side by side, and the phone, Twilio, Telegram and backup tests drive the phone entry, Look up numbers, the Telegram onboarding flow, and backup, restore and reset with a stubbed plugin server. They need a Chromium or Chrome binary: set `NOTIFY_SWITCH_CHROMIUM` (or `CHROMIUM_PATH` / `CHROME_BIN`) to one, or have Chrome installed in its usual location. Without a browser the test is skipped locally; on CI (where Chrome is present) it fails instead, so it cannot silently disappear. Nothing is downloaded.

## Before opening a pull request

```shell
npm ci
npm run lint
npm run build
npm test
```

All four must pass. `npm run lint` fails on any warning. Then:

- Open the pull request against `latest`.
- Keep one change per pull request; do not mix a feature with unrelated cleanups.
- Add an entry under Unreleased in [CHANGELOG.md](./CHANGELOG.md).
- If the change deviates from `SPEC.md`, say so in the pull request and why.
- Do not add runtime dependencies without explaining why in the pull request.
- Never log credentials, never throw from a provider, and never make TLS verification configurable.

## Releases

1. Set the new version in `package.json` and `package-lock.json` (`npm version <version> --no-git-tag-version` updates both) and in the status line at the top of `SPEC.md` ("Current as of <version>"). Nothing else carries the version: README and this file stay as they are.
2. Move the Unreleased section of `CHANGELOG.md` into an entry for that version.
3. Merge to `latest`, then publish a GitHub release whose tag is `v<version>`. Mark it as a pre-release for beta versions.
4. The release workflow lints, builds, tests, and publishes to npm under `latest`. Pre-releases are the exception: mark a GitHub release as a pre-release only when a beta is deliberately wanted, and it is published under the `beta` tag instead.
