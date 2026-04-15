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
- stay SCM-agnostic at the core, with integrations via plugin capabilities
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

Use your CI/CD platform for registry publishing, triggered from a created
release/tag.

## Current status vs roadmap

Current implementation focuses on:

- strategy-based version updates (`simple`, `node`)
- release planning and changelog generation
- review-mode vs direct-mode release flow
- built-in GitHub SCM plugin capabilities

Planned/harder areas include deeper monorepo ergonomics, broader SCM coverage,
and stronger failure recovery around release steps.

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

- `https://raw.githubusercontent.com/jolars/versionary/main/schemas/versionary-schema.json`

## Config (manifest style)

For a quick trial, use:

- `version-file` (default `version.txt`) as version source
- `changelog-file` (default `CHANGELOG.md`) as release notes output
- `release-type: "node"` uses `package.json` as version source and updates it
  during release PR prep
- simple/default strategy keeps `version.txt` as source of truth and does not
  update `package.json`
- stable release branch (`release-branch`, default: `versionary/release`) so
  release PRs are updated in-place
- `baseline-file` (default `.versionary-manifest.json`) tracks baseline SHA for
  deterministic commit ranges independent of tags
- review mode (`review-mode`): `review` (PR/MR style) or `direct` (no review
  request)
- optional monorepo planning with `monorepo-mode` and `packages`:
  - `independent` computes package bumps per path
  - `fixed` computes one shared bump across configured package paths

Commands:

- `pnpm verify`
- `pnpm run` (default orchestration: no-op, create/update release PR, or publish
  release based on context)
- `pnpm plan`
- `pnpm changelog -- --write`
- `pnpm pr`
- `pnpm release`

`pnpm pr` prepares release commit + branch and opens/updates the review request
via SCM plugin capability. `pnpm run` is the recommended CI entrypoint and
auto-dispatches between PR/update and release publish.

For first-run bootstrapping, set `bootstrap-sha` (similar to release-please).
Subsequent runs use the baseline state file.

## Built-in plugins

Versionary ships with built-in SCM plugin support:

- `github` (default): review request + release metadata

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
