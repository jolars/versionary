# versionary

Versionary is a software-agnostic automated release tool focused on SemVer, conventional commits, release PR workflows, and extensibility.

Configuration is loaded from `versionary.jsonc` by default.

Schema URL for editor support:

- `https://raw.githubusercontent.com/jolars/versionary/main/schemas/versionary.schema.json`

## Simple mode (MVP)

For a quick trial, use:

- `versionary.jsonc` with `"mode": "simple"`
- `version.txt` as the version source
- `CHANGELOG.md` as release notes output
- stable release branch (`simple.releaseBranchPrefix`, default: `versionary/release`) so release PRs are updated in-place
- `.versionary-manifest.json` tracks baseline SHA for deterministic commit ranges independent of tags
- release flow mode (`releaseFlow.mode`): `review` (PR/MR style) or `direct` (no review request)

Commands:

- `pnpm verify`
- `pnpm run` (default orchestration: no-op, create/update release PR, or publish release based on context)
- `pnpm plan`
- `pnpm changelog -- --write`
- `pnpm pr`
- `pnpm release`

`pnpm pr` prepares release commit + branch and opens/updates the review request via SCM plugin capability.
`pnpm run` is the recommended CI entrypoint and auto-dispatches between PR/update and release publish.

For first-run bootstrapping, you can optionally set `history.bootstrap.sha` in config (similar to release-please `bootstrap-sha` behavior). Subsequent runs use manifest state.

Versionary also accepts release-please-style aliases and normalizes them:

- `plugins: ["npm"]` (string array) -> internal plugin refs
- `bootstrap-sha` -> `history.bootstrap.sha`
- `bump-minor-pre-major` -> `defaults.versioning.bumpMinorPreMajor`
- `include-commit-authors` -> `defaults.changelog.includeAuthors`
- `release-type` -> `defaults.strategy`
- `packages` object map (manifest style) -> internal package list

## Built-in plugins

Versionary ships with built-in SCM and publish plugins:

- `github` (default): review request + release metadata
- `npm` (opt-in): publishes package to npm during `release`

Enable npm publish:

```jsonc
{
  "version": 1,
  "mode": "simple",
  "pluginConfig": {
    "plugins": [{ "name": "npm" }]
  }
}
```

Environment variables for npm plugin:

- `NPM_TOKEN` (required unless skipping publish)
- `VERSIONARY_NPM_ACCESS` (`public` default, `restricted` optional)
- `VERSIONARY_SKIP_NPM_PUBLISH` (`true/1/yes` skips actual `npm publish`, useful for dry runs)

## Install from GitHub

You can install directly from a git ref:

```json
{
  "devDependencies": {
    "versionary": "github:jolars/versionary#<commit-or-tag>"
  }
}
```

The package runs a `prepare` build during git installation so the `versionary` CLI binary is available after `pnpm install`.
