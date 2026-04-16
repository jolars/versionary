# Copilot Instructions for `versionary`

## Product intent (important context)

Versionary is intended to combine strengths from `semantic-release` and
`release-please`, while avoiding common pain points:

- keep both direct release execution and release-PR-gated workflows
- stay software/ecosystem agnostic (Node, Rust, docs, etc.)
- keep SCM integration pluggable/capability-based (GitHub first, others later)
- focus on versioning/changelog/tagging/release metadata, not package registry
  publishing
- preserve a small, stable core with clear extension points

When making design decisions, prioritize trunk-based-development compatibility,
monorepo ergonomics, and explicit failure handling over adding broad dependency
surface area.

## Development Status

The project is in early, alpha-stage development. Breaking changes are generally
just fine at this stage. Once we get to 1.0.0, we will start caring about
backwards compatibility.

## Conventional Commits and Semantic Versioning

versionary is heavily built around

- [conventional
  commits](https://raw.githubusercontent.com/conventional-commits/conventionalcommits.org/refs/heads/master/content/v1.0.0/index.md)
- [semantic
  versioning](https://raw.githubusercontent.com/semver/semver/refs/heads/master/semver.md)

To make reference easier, the specs are available at

`assets/conventional-commits-spec.md` and `assets/semver-spec.md` in this
repository.

Conventional commits drive semantic version updates, changelog generation, and
release metadata management.

## Build, test, and run commands

- Install dependencies: `pnpm install`
- Build: `pnpm build`
- Type-check only: `pnpm typecheck`
- Run full test suite: `pnpm test`
- Run a single test file: `pnpm vitest run tests/simple-git-analyze.test.ts`
- Run a single test by name: `pnpm vitest run -t "ignores chore commits"`
- Lint/format: use Biome (`biome.jsonc` is authoritative for formatting
  settings); match Biome formatting in edits so pre-commit checks stay clean.
  In final handoffs, remind users to run Biome checks for both linting and
  formatting.

CLI commands in this repo currently run from source through `tsx` scripts:

- `pnpm verify`
- `pnpm run` (default orchestration command)
- `pnpm plan`
- `pnpm changelog` (append `-- --write` to update `CHANGELOG.md`)
- `pnpm pr`
- `pnpm release`

## High-level architecture

`versionary` currently supports release planning and PR/release automation with
a strategy model:

- `src/cli/index.ts`: command router for `run`, `verify`, `plan`, `changelog`,
  `pr`, `release`
- `src/app/release/`: application-layer release modules (`pr`, `release`,
  `verify`, `state`)
- `src/domain/strategy/`: strategy contracts + implementations (`simple`,
  `node`) and resolver
- `src/domain/release/`: release-domain modules (plan/changelog/semver)
- `src/infra/git/`: git commit/range analysis and repository URL resolution
- `src/infra/scm/`: SCM integration boundary (`github` plugin + runtime loader)
- `src/config/`: config discovery/parsing/validation
  - `load-config.ts` loads `versionary.jsonc` (preferred) or `versionary.json`
  - `schema.ts` validates config via `zod`
- `src/strategies/` and `src/scm/`: compatibility-layer exports during migration
  to the app/domain/infra layout (`src/simple/` has been removed)
- `src/plugins/`: plugin capability helpers + compatibility runtime export
- `src/verify/verify-project.ts`: validates config loading, version file
  presence, and configured package paths

## Key conventions in this repository

- Supported config filenames are `versionary.jsonc` (preferred) and
  `versionary.json` only.
- Config schema is release-focused (manifest style) with keys such as
  `version-file`, `changelog-file`, `release-branch`, `baseline-file`,
  `review-mode`, `release-type`, and optional `packages`.
- Default behavior uses:
  - `version-file = "version.txt"`
  - `changelog-file = "CHANGELOG.md"`
  - `release-branch = "versionary/release"`
  - `baseline-file = ".versionary-manifest.json"`
  - pre-1.0 handling: breaking changes on `0.y.z` bump to `0.(y+1).0` by
    default; `allow-stable-major = true` permits `1.0.0` transition
- Release commit analysis currently follows conventional-commit-style defaults:
  - parser emits structured AST fields (`header/body/footer`, `notes`,
    `references`, `mentions`, `revert`) and diagnostics independently from
    release-policy mapping
  - `feat` => `minor`
  - `fix|perf` => `patch`
  - `!` / `BREAKING CHANGE` footer => `major` (any type)
  - `revert:` commits do not directly trigger releases
  - commits reverted within the analyzed release window are suppressed from
    bump/changelog impact
- `pr` command requires a clean tracked working tree (except lockfiles),
  creates/resets release branch, commits `chore(release): v*`, and writes
  baseline state.
- `run` is the primary CI entrypoint: it auto-dispatches to PR/update flow or
  release publish flow based on commit context.
- `review-mode` controls review-request behavior (`direct` skips PR creation,
  `pr` uses SCM plugin; legacy `review` alias is accepted).
- Treat package publishing as out of scope for Versionary itself; external CI
  workflows should publish artifacts based on release/tag events.
- Packaging is CLI-first:
  - binary entrypoint: `dist/cli/index.js`
  - published files are limited to `dist/` via `package.json` `files`.
