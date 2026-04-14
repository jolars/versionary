# Copilot Instructions for `versionary`

## Build, test, and run commands

- Install dependencies: `pnpm install`
- Build: `pnpm build`
- Type-check only: `pnpm typecheck`
- Run full test suite: `pnpm test`
- Run a single test file: `pnpm vitest run tests/simple-git-analyze.test.ts`
- Run a single test by name: `pnpm vitest run -t "ignores chore commits"`

CLI commands in this repo currently run from source through `tsx` scripts:

- `pnpm verify`
- `pnpm plan`
- `pnpm changelog` (append `-- --write` to update `CHANGELOG.md`)
- `pnpm pr`

## High-level architecture

`versionary` is currently MVP-focused around a **simple release mode** that updates `version.txt` and `CHANGELOG.md` using conventional-commit-style commit analysis.

- `src/cli/index.ts`: command router for `verify`, `plan`, `changelog`, `pr`
- `src/config/`: config discovery/parsing/validation
  - `load-config.ts` loads `versionary.jsonc` (preferred) with compatibility fallbacks
  - `schema.ts` validates config via `zod`
- `src/simple/`: simple-mode release engine
  - `git.ts`: gets commits since the latest reachable `v*` tag and maps commit types to bump levels
  - `semver.ts`: parses and bumps `x.y.z`
  - `plan.ts`: produces deterministic plan object used by CLI
  - `changelog.ts`: renders and prepends release notes sections
  - `pr.ts`: updates files, creates `versionary/release-v*` branch, and commits `chore(release): v*`
- `src/verify/verify-project.ts`: validates config loading and simple-mode prerequisites (e.g. `version.txt`)

## Key conventions in this repository

- Canonical config filename is `versionary.jsonc`; `versionary.config.*` files are supported as compatibility fallbacks.
- Simple mode is the current default (`mode: "simple"`), with defaults:
  - `simple.versionFile = "version.txt"`
  - `simple.changelogFile = "CHANGELOG.md"`
- Release commit analysis currently follows conventional-commit-style defaults:
  - `feat` => `minor`
  - `fix|perf` => `patch`
  - `!:` / `BREAKING CHANGE` => `major`
  - `revert:`, `chore:`, and `refactor:` commits are ignored for release triggering
- `pr` command requires a clean git working tree and creates/reuses branch `versionary/release-v<nextVersion>`.
- Packaging is CLI-first:
  - binary entrypoint: `dist/cli/index.js`
  - published files are limited to `dist/` via `package.json` `files`.
