# Versionary

Versionary is a software-agnostic automated release tool focused on SemVer,
Conventional Commits, release-PR workflows, and extensibility.

📖 **Documentation: <https://versionary.dev/>**

## Why this exists

Versionary is a practical middle ground between
[`semantic-release`](https://github.com/semantic-release/semantic-release) and
[`release-please`](https://github.com/googleapis/release-please):

- like `semantic-release`, it supports **direct release execution**;
- like `release-please`, it supports a **release PR workflow** so maintainers
  can preview and review changes before publication.

It keeps versioning, changelog generation, tagging, and SCM release metadata in
one tool, while leaving package publication (npm, crates.io, etc.) to dedicated
CI workflows triggered by tags or releases.

It is built to:

- support both direct releases and release-PR-gated releases
- work across ecosystems (Node, Rust, Python, R, Julia, LaTeX, …)
- stay SCM-agnostic at the core with built-in integration (GitHub first)
- keep a small, stable core with clear extension points
- handle trunk-based development and monorepo workflows cleanly

> **Status:** early, alpha-stage development. Breaking changes are expected
> before `1.0.0`.

## Quick start

Install:

```bash
pnpm add -D versionary    # or npm install --save-dev versionary
```

Add a `versionary.jsonc` at the repo root:

```jsonc
{
  "$schema": "https://raw.githubusercontent.com/jolars/versionary/main/schemas/config.json",
  "version": 1,
  "release-type": "node"
}
```

Check it and preview the next release:

```bash
npx versionary verify
npx versionary plan
```

Then automate it in CI—see the
[Getting started](https://versionary.dev/guide/getting-started) and
[GitHub Actions](https://versionary.dev/guide/github-actions)
guides.

## Documentation

The full documentation lives at <https://versionary.dev/>:

- [Getting started](https://versionary.dev/guide/getting-started)
- [GitHub Actions setup](https://versionary.dev/guide/github-actions)
  (including tokens and permissions)
- [Release workflows](https://versionary.dev/guide/workflows)
- [Monorepos](https://versionary.dev/guide/monorepos)
- [Conventional Commits](https://versionary.dev/guide/conventional-commits)
  and [Versioning](https://versionary.dev/guide/versioning)
- Reference:
  [CLI](https://versionary.dev/reference/cli),
  [Configuration](https://versionary.dev/reference/configuration),
  [Strategies](https://versionary.dev/reference/strategies)

## Scope and non-goals

In scope: semantic version planning from commits, changelog generation, release
PR automation, and tags + SCM release metadata (e.g. GitHub Releases).

Out of scope (intentional): publishing artifacts to language registries,
replacing package-specific publish tooling, and external/user-provided plugin
loading. Use your CI/CD platform for registry publishing, triggered from a
created release/tag.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for the development setup, commands, and
commit conventions.

## Architecture layout (canonical)

Runtime code uses a flat `src/` layout with clear module boundaries:

- `src/cli/`: command router (`run`, `verify`, `plan`, `changelog`, `pr`, `release`)
- `src/release/`: release orchestration (plan/changelog/PR/release/state/recovery)
- `src/strategy/`: strategy contracts, resolver, and built-in implementations
  (`simple`, `node`, `rust`, `r`, `latex`, `python`, `julia`)
- `src/scm/`: SCM client contracts and provider implementation(s)
- `src/config/`: config loading and schema validation
- `src/git/`: git commit/range and repository URL helpers
- `src/types/`: shared config/plugin-facing types

Configuration is loaded from `versionary.jsonc` by default (or
`versionary.json`). The config schema lives in `src/config/schema.ts`; the
editor-facing `schemas/config.json` is generated via `pnpm gen:schema`.

## Adding a new release strategy

New language strategies can be added internally without changing release
orchestration. A new strategy should implement the `VersionStrategy` contract in
`src/strategy/types.ts` and be wired in `src/strategy/resolve.ts`.

Checklist for new strategies:

- define strategy `name`
- define `getVersionFile(config)` defaults and config override behavior
- implement `readVersion(cwd, config)` with explicit malformed-file errors
- implement `writeVersion(cwd, config, version)` returning deterministic updated
  file paths
- optionally implement `readPackageName(cwd, config)` so monorepo release tags
  can derive from language metadata (similar to Node/Rust/R)
- optionally implement `propagateDependentPatchImpacts(cwd, packages)` if
  dependency updates in this ecosystem should trigger dependent package patch
  bumps
- optionally implement `finalizeVersionWrites(cwd, writes, context)` for
  ecosystem post-processing after all target version files are written
- add focused strategy tests for ecosystem-specific behavior and edge cases
- add/extend strategy contract tests in `tests/strategy-contract.test.ts`
- update schema/docs for new `release-type` behavior and defaults

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
CLI binary is available after install.

## License

[MIT](LICENSE)
