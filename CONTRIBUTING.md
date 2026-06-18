# Contributing to Versionary

Thanks for your interest in improving Versionary! This guide covers the
development setup, the commands we use, and the conventions that keep the
project releasable (Versionary releases itself with Versionary).

Versionary is in early, alpha-stage development. Breaking changes are fine
before `1.0.0`—but they still go through Conventional Commits so the changelog
and version stay accurate.

## Development environment

- The repo uses [devenv](https://devenv.sh/); project tooling (and some LSP
  servers) come from the devenv shell, so make sure it is loaded.
- Package manager is **pnpm**.

```bash
pnpm install
```

## Essential commands

Run these before starting work and again before committing:

```bash
pnpm build          # compile TypeScript to dist/
pnpm test           # run the full test suite (vitest)
pnpm verify         # run `versionary verify` against this repo
pnpm typecheck      # type-check without emitting
biome check .       # lint
biome format . --write
```

Useful test invocations:

```bash
pnpm vitest run tests/simple-git-analyze.test.ts   # a single file
pnpm vitest run -t "ignores chore commits"          # a single test by name
```

`biome.jsonc` is authoritative for formatting; match it so pre-commit checks
stay clean.

### Docs

The documentation site is built with [VitePress](https://vitepress.dev/) and
lives in `docs/`:

```bash
pnpm docs:dev       # local preview with hot reload
pnpm docs:build     # production build (fails on dead links)
```

When you change behavior, update the relevant page under `docs/guide/` or
`docs/reference/`.

## Conventional Commits

Versionary computes versions and changelogs from
[Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/), so your
commit messages are part of the release. Use:

```
<type>(<optional scope>)<optional !>: <description>
```

| Type                     | Effect on the release            |
| ------------------------ | -------------------------------- |
| `feat`                   | minor bump, **Features**         |
| `fix`                    | patch bump, **Bug Fixes**        |
| `perf`                   | patch bump, **Performance Improvements** |
| `revert:`                | patch bump (major if breaking), **Reverts** |
| `!` or `BREAKING CHANGE` | major bump, **Breaking changes** |
| `chore`, `docs`, `style`, `test`, `ci`, `refactor` | no release |

Examples:

```
feat(strategies): add julia strategy
fix: handle R NEWS.md convention for manual releases
refactor: automatically generate schema
```

See the [Conventional Commits guide](docs/guide/conventional-commits.md) and
[Versioning](docs/guide/versioning.md) for the full mapping.

## Config schema

The config schema is defined in `src/config/schema.ts` and is the single source
of truth for the config shape. The editor-facing `schemas/config.json` is
**generated**—do not hand-edit it:

```bash
pnpm gen:schema
```

`tests/config-schema-sync.test.ts` fails if the committed `schemas/config.json`
drifts from the schema, so regenerate it whenever you change `schema.ts`.

## Adding a release strategy

New language strategies implement the `VersionStrategy` contract in
`src/strategy/types.ts` and are wired into `src/strategy/resolve.ts`. The README
has the full checklist under
[Adding a new release strategy](README.md#adding-a-new-release-strategy); the
[Strategies reference](docs/reference/strategies.md) documents user-facing
behavior. Add focused strategy tests and extend
`tests/strategy-contract.test.ts`.

## Project layout

`AGENTS.md` and the README describe the architecture. In short:

- `src/cli/` — command router
- `src/release/` — plan/changelog/PR/release/state/recovery
- `src/strategy/` — strategy contracts, resolver, and implementations
- `src/scm/` — SCM provider boundary (GitHub today)
- `src/config/` — config loading and schema
- `src/git/` — commit/range analysis

## Pull requests

- Keep the working tree clean (the `pr` flow expects it, aside from lockfiles).
- Make sure `pnpm build`, `pnpm test`, `pnpm typecheck`, and `biome check .`
  all pass.
- Write a clear Conventional Commit subject—it becomes the changelog entry.

Thank you for contributing! 🎉
