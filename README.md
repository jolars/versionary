# Versionary

Versionary is a software-agnostic automated release tool focused on SemVer,
conventional commits, release PR workflows, and extensibility.

## Why this exists

Versionary is designed as a practical middle ground between `semantic-release`
and `release-please`.

- Like `semantic-release`, it supports direct release execution.
- Like `release-please`, it supports a release PR workflow so maintainers can
  preview and review changes before publication.

The core idea is to keep versioning, changelog generation, tagging, and SCM
release metadata in one tool, while leaving package publication (npm, crates.io,
etc.) to dedicated CI workflows triggered by tags or releases.

## Product direction

Versionary is being built to:

- support both direct releases and release-PR-gated releases
- work across repository types (Node, Rust, docs/LaTeX, etc.)
- stay SCM-agnostic at the core with built-in integration adapters
  (GitHub first; GitLab/Codeberg later)
- keep a small, stable core with explicit extension points
- handle trunk-based development and monorepo workflows cleanly

## Scope and non-goals

In scope:

- semantic version planning from commits
- changelog generation
- release PR automation
- tags + SCM release metadata (e.g. GitHub Releases)

Out of scope (intentional):

- publishing artifacts to language registries
- replacing package-specific publish tooling
- external/user-provided plugin loading

Use your CI/CD platform for registry publishing, triggered from a created
release/tag.

## Current status vs roadmap

Current implementation focuses on:

- strategy-based version updates (`simple`, `node`, `rust`, `r`)
- release planning and changelog generation
- review-mode vs direct-mode release flow
- built-in GitHub SCM plugin capabilities

Planned/harder areas include deeper monorepo ergonomics, broader SCM coverage,
and stronger failure recovery around release steps.

## Adding a new release strategy

Versionary is set up so new language strategies can be added internally without
changing release orchestration. A new strategy should implement the
`VersionStrategy` contract in `src/domain/strategy/types.ts` and be wired in
`src/domain/strategy/resolve.ts`.

Checklist for new strategies (for example `python`):

- define strategy `name`
- define `getVersionFile(config)` defaults and config override behavior
- implement `readVersion(cwd, config)` with explicit malformed-file errors
- implement `writeVersion(cwd, config, version)` returning deterministic updated
  file paths
- add release-name extraction support if package tags should derive from
  language metadata (similar to Node/Rust/R)
- add focused strategy tests for ecosystem-specific behavior and edge cases
- add/extend strategy contract tests in `tests/strategy-contract.test.ts`
- update schema/docs for new `release-type` behavior and defaults

Current ecosystem policy defaults:

- changelog source for publish:
  - root target uses root `changelog-file`
  - package target uses `packages.<path>.changelog-file` when configured, else
    root `changelog-file`
- lockfiles:
  - Node strategy updates root `package-lock.json`/`npm-shrinkwrap.json` when
    present
  - Rust release PR prep refreshes all discovered `Cargo.lock` files
- workspace/inheritance:
  - Rust supports `version.workspace = true` via `[workspace.package].version`
  - other strategies should document equivalent inheritance behavior explicitly

## Architecture layout (current migration)

The repository is moving to explicit layered modules:

- `src/app/`: command-level application services and orchestration boundaries
- `src/domain/`: release and strategy domain logic/contracts
- `src/infra/`: platform integrations (SCM, git/runtime adapters)

Legacy `src/simple/` has been removed. Remaining compatibility paths are
`src/strategies` and `src/scm` while migration is finalized.

Configuration is loaded from `versionary.jsonc` by default (or
`versionary.json`).

Schema URL for editor support:

- `https://raw.githubusercontent.com/jolars/versionary/main/schemas/config.json`

## Config (manifest style)

For a quick trial, use:

- `version-file` (default `version.txt`) as version source
- `changelog-file` (default `CHANGELOG.md`) as release notes output
- `release-type: "node"` uses `package.json` as version source and updates it
  during release PR prep
- `release-type: "r"` uses `DESCRIPTION` as version source and updates the
  `Version:` field
- `release-type: "rust"` uses Cargo manifests (`Cargo.toml`) as version source;
  `version-file` must point to a `Cargo.toml` (default: `Cargo.toml`)
- simple/default strategy keeps `version.txt` as source of truth and does not
  update `package.json`
- stable release branch (`release-branch`, default: `versionary/release`) so
  release PRs are updated in-place
- `baseline-file` (default `.versionary-manifest.json`) tracks baseline SHA for
  deterministic commit ranges independent of tags
- pre-1.0 policy defaults to conservative major handling: for `0.y.z`, breaking
  changes bump to `0.(y+1).0`; set `allow-stable-major: true` to allow explicit
  auto-transition to `1.0.0` on a breaking release
- review mode (`review-mode`): `pr` (PR/MR style) or `direct` (no review
  request)
- optional monorepo planning with `monorepo-mode` and `packages`:
  - `independent` computes package bumps per path
  - `fixed` computes one shared bump across configured package paths
  - per-package `package-name` can override release identity (labels + tag base)
  - per-package `changelog-file` writes package release notes to
    `<package-path>/<changelog-file>`

Rust strategy examples:

```jsonc
// Single crate
{
  "release-type": "rust",
  "version-file": "Cargo.toml"
}
```

```jsonc
// Workspace root (virtual or root crate + members)
{
  "release-type": "rust",
  "version-file": "Cargo.toml"
}
```

Current rust auto-update behavior (phase scope):

- updates crate versions in each targeted crate `[package].version`
- supports targeted crates using `version.workspace = true` by updating
  `[workspace.package].version` in the owning workspace manifest
- updates internal workspace dependency versions when the dependency name
  matches another targeted crate name
- refreshes `Cargo.lock` via `cargo generate-lockfile` when `Cargo.lock` exists
  in repo root
- applies dependency version rewrites in:
  - `[dependencies]`, `[dev-dependencies]`, `[build-dependencies]`
  - `[target.*.dependencies]`, `[target.*.dev-dependencies]`,
    `[target.*.build-dependencies]`

Current rust non-goals/limits:

- does not update external dependency versions
- does not update `workspace.dependencies`
- does not add missing `version = ...` fields to dependency inline tables
- does not perform Cargo publish/release to crates.io

If `Cargo.lock` exists, `cargo` must be available in PATH during PR preparation.

### Monorepo release names and tag naming

For independent monorepo targets, Versionary derives release tags as:

- root package (`"."`): `v<version>`
- non-root package: `<release-name>-v<version>`

`release-name` precedence is:

1. `packages.<path>.package-name` (explicit override)
2. strategy-native package name from version file:
   - Node: `package.json` `name`
   - Rust: `Cargo.toml` `[package].name`
   - R: `DESCRIPTION` `Package:`
3. package path fallback

When multiple packages resolve to the same `<release-name>` and version, the run
fails fast with a duplicate-tag error and suggests setting unique
`package-name` values.

## Commit parsing and release analysis

Release planning is based on Conventional Commit parsing semantics:

- parses type/scope/description from commit headers
- exposes structured parsed fields (`header`, `body`, `footer`, `type`, `scope`,
  `description`, `notes`, `references`, `mentions`, `revert`)
- separates parser output from release policy mapping (`inferReleaseType*`)
- recognizes breaking changes from `!` and `BREAKING CHANGE` / `BREAKING-CHANGE`
  footers
- maps release impact as `feat => minor`, `fix|perf => patch`, breaking => major
- treats `revert:` commits as patch-releasable by default (and major if marked
  breaking, e.g. `revert!:` or `BREAKING CHANGE`)
- suppresses commits that are reverted within the analyzed release window so
  they do not affect bump/changelog output
- emits parser diagnostics for malformed headers/footers/references and
  ambiguous revert messages

Commands:

- `pnpm verify`
- `pnpm run` (default orchestration: no-op, create/update release PR, or publish
  release based on context)
- `pnpm run -- --json` (machine-readable orchestration result)
- `pnpm plan`
- `pnpm changelog -- --write`
- `pnpm pr`
- `pnpm release`

`pnpm pr` prepares release commit + branch and opens/updates the review request
via SCM plugin capability. `pnpm run` is the recommended CI entrypoint and
auto-dispatches between PR/update and release publish.

For first-run bootstrapping, set `bootstrap-sha` (similar to release-please).
Subsequent runs use the baseline state file.

## Release retry and recovery behavior

Release publish (`pnpm release` or the publish path in `pnpm run`) is idempotent
by target tag:

- if a tag already exists, Versionary reuses it rather than recreating it
- if release metadata already exists for the tag (e.g., GitHub Release), it is
  reused
- if a prior run created/pushed the tag but failed before metadata creation, a
  rerun creates the missing metadata and proceeds

Versionary fails fast when recovery is unsafe (for example, local and remote
tags with the same name point to different SHAs). In these cases, the error
message includes remediation guidance so CI logs are actionable.

## Built-in plugins

Versionary ships with built-in SCM plugin support:

- `github` (default): review request + release metadata

### GitHub integration: env, permissions, and flow

Required environment for the built-in GitHub plugin:

- `GITHUB_REPOSITORY` (format: `owner/repo`)
- one token env var: `VERSIONARY_PR_TOKEN` or `GH_TOKEN` or `GITHUB_TOKEN`

Token precedence is:

- `VERSIONARY_PR_TOKEN` > `GH_TOKEN` > `GITHUB_TOKEN`

Minimum GitHub token/repo permissions for Versionary-managed metadata:

- release PR create/update flow: `contents: write`, `pull-requests: write`
- release metadata flow (GitHub Release create/read): `contents: write`

`review-mode` behavior:

- `pr` (preferred; `review` is a backward-compatible alias): `pnpm run run`
  prepares/updates the release branch and creates or
  updates a release PR
- `direct`: `pnpm run run` prepares/updates the release branch and skips review
  request creation

Concise GitHub Actions examples:

```yaml
# 1) Release PR / update flow (run on push to default branch)
permissions:
  contents: write
  pull-requests: write

steps:
  - uses: actions/checkout@v6
    with:
      fetch-depth: 0
      fetch-tags: true
  - id: versionary
    uses: jolars/versionary@v1
    with:
      token: ${{ secrets.RELEASE_TOKEN }}
```

```yaml
# 2) Release publish flow after merge (release commit context)
permissions:
  contents: write

steps:
  - uses: actions/checkout@v6
    with:
      fetch-depth: 0
      fetch-tags: true
  - id: versionary
    uses: jolars/versionary@v1
    with:
      token: ${{ secrets.RELEASE_TOKEN }}
  - if: ${{ steps.versionary.outputs.release_created == 'true' }}
    run: echo "Released ${{ steps.versionary.outputs.tag_name }}"
```

`token` is used for both GitHub API calls and git push authentication in
the composite action. This means release-branch force-pushes are attributed to
that token and can trigger downstream workflows when using a PAT/App token.
(`github-token` remains as a deprecated alias for backward compatibility.)

Action outputs:

- `action`: `noop`, `pr-prepared`, `release-published`, `release-skipped`
- `message`: human-readable summary
- `release_created`: `"true"` when at least one release was published
- `tag_name`: first published tag (for single-target flows)
- `tag_names`: JSON array of published tags
- `review_url`: review request URL when PR flow runs

For GitHub Action consumers, publish immutable tags (for example `v1.2.3`) and
maintain a moving major tag (`v1`, `v2`, ...). A small release-triggered
workflow should update `v<major>` to the latest release tag so `uses:
jolars/versionary@v1` stays current without breaking major compatibility.

Package publication is intentionally out of scope in the current release flow.
Use separate CI workflows for publishing after Versionary has prepared/tagged
the release.

## Install from GitHub

You can install directly from a git ref:

```json
{
  "devDependencies": {
    "versionary": "github:jolars/versionary#<commit-or-tag>"
  }
}
```

The package runs a `prepare` build during git installation so the `versionary`
CLI binary is available after `pnpm install`.
