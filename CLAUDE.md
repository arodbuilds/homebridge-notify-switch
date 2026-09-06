# homebridge-notify-switch

Project conventions for every session working in this repository.

## Before any change

- Read `SPEC.md` in full before changing anything. It is the source of truth for behavior, field names, copy, and security rules. If a change has to deviate from it, say so in the pull request and why.
- Read the existing source for the area you are touching. Phase boundaries are recorded in `CHANGELOG.md` under Unreleased.

## Branches and pull requests

- The default branch is `latest`. Open pull requests against it.
- One pull request per phase. Do not mix a phase with unrelated cleanups.
- Do not add "Generated with Claude Code" footers, session links, or `Co-Authored-By` trailers to commits or pull requests.
- Update `CHANGELOG.md` Unreleased in the same pull request as the change.
- Do not touch `config.schema.json` or `README.md` beyond what the change requires.

## Code rules

- TypeScript `strict` stays on and `npm run lint` must pass with zero warnings (`--max-warnings=0`).
- No new runtime dependencies without stating why in the pull request. Runtime dependencies today: `nodemailer` only.
- Never throw from a provider. Every failure resolves to a `RecipientResult` with a sanitized `error` string.
- Never log credentials at any level. Never log message bodies at info level (only when `debug` is on, via `PluginLogger.debug`).
- Mask addresses in info logs through `PluginLogger.address()`.
- Provider errors are reduced to a code and a short message before logging; never log raw provider error objects or request dumps.
- TLS certificate verification is never configurable.
- Provider modules are loaded lazily by type from `src/providers/index.ts`; the switch code depends only on the `Provider` interface in `src/types.ts`.

## Verification before pushing

```shell
npm ci
npm run lint
npm run build
npm test
```

The harness under `test/harness/` runs against the compiled `dist/` output with mocked `fetch` and a mocked nodemailer transport. It is excluded from the published package via `.npmignore`.
