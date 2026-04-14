# versionary

Versionary is a software-agnostic automated release tool focused on SemVer, conventional commits, release PR workflows, and extensibility.

Configuration is loaded from `versionary.jsonc` by default.

## Simple mode (MVP)

For a quick trial, use:

- `versionary.jsonc` with `"mode": "simple"`
- `version.txt` as the version source
- `CHANGELOG.md` as release notes output
- stable release branch (`simple.releaseBranchPrefix`, default: `versionary/release`) so release PRs are updated in-place
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
