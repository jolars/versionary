# Versionary <picture><source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/jolars/versionary/main/assets/logo/logo-small-dark.png" /><img src="https://raw.githubusercontent.com/jolars/versionary/main/assets/logo/logo-small.png" align="right" width="189" alt="Versionary logo" /></picture>

[![ci](https://github.com/jolars/versionary/actions/workflows/ci.yml/badge.svg)](https://github.com/jolars/versionary/actions/workflows/ci.yml)
[![npm
version](https://img.shields.io/npm/v/versionary.svg)](https://www.npmjs.com/package/versionary)

Versionary is a software-agnostic automated release tool focused on SemVer,
Conventional Commits, release-PR workflows, and extensibility. Read the
documentation at <https://versionary.dev/>.

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

Then automate it in CI—see the [Getting
started](https://versionary.dev/guide/getting-started) and [GitHub
Actions](https://versionary.dev/guide/github-actions) guides.

## Documentation

The full documentation lives at <https://versionary.dev/>:

- [Getting started](https://versionary.dev/guide/getting-started)
- [GitHub Actions setup](https://versionary.dev/guide/github-actions) (including
  tokens and permissions)
- [Release workflows](https://versionary.dev/guide/workflows)
- [Julia registration with Registrator and
  TagBot](https://versionary.dev/guide/julia)
- [Monorepos](https://versionary.dev/guide/monorepos)
- [Conventional Commits](https://versionary.dev/guide/conventional-commits) and
  [Versioning](https://versionary.dev/guide/versioning)
- Reference: [CLI](https://versionary.dev/reference/cli),
  [Configuration](https://versionary.dev/reference/configuration),
  [Strategies](https://versionary.dev/reference/strategies)

## Scope and non-goals

In scope: semantic version planning from commits, changelog generation, release
PR automation, and tags + SCM release metadata (e.g. GitHub Releases).

Out of scope (intentional): publishing artifacts to language registries,
replacing package-specific publish tooling, and external/user-provided plugin
loading. Use your CI/CD platform for registry publishing, triggered from release
outputs or a created release/tag.

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

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for the development setup, commands, and
commit conventions.

## License

[MIT](LICENSE)
