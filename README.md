# versionary

Versionary is a software-agnostic automated release tool focused on SemVer,
conventional commits, release PR workflows, and extensibility.

Configuration is loaded from `versionary.jsonc` by default.

Schema URL for editor support:

- `https://raw.githubusercontent.com/jolars/versionary/main/schemas/versionary-schema.json`

## Config (manifest style)

For a quick trial, use:

- `version-file` (default `version.txt`) as version source
- `changelog-file` (default `CHANGELOG.md`) as release notes output
- `release-type: "node"` uses `package.json` as version source and updates it during release PR prep
- simple/default strategy keeps `version.txt` as source of truth and does not update `package.json`
- stable release branch (`release-branch`, default:
  `versionary/release`) so release PRs are updated in-place
- `baseline-file` (default `.versionary-manifest.json`) tracks baseline SHA for deterministic commit
  ranges independent of tags
- review mode (`review-mode`): `review` (PR/MR style) or `direct` (no
  review request)
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

For first-run bootstrapping, set `bootstrap-sha` (similar to release-please). Subsequent runs use
the baseline state file.

## Built-in plugins

Versionary ships with built-in SCM plugin support:

- `github` (default): review request + release metadata

Package publication is intentionally out of scope in the current release flow.
Use separate CI workflows for publishing after Versionary has prepared/tagged the release.

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
