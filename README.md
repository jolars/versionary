# versionary

Versionary is a software-agnostic automated release tool focused on SemVer, conventional commits, release PR workflows, and extensibility.

Configuration is loaded from `versionary.jsonc` by default.

## Simple mode (MVP)

For a quick trial, use:

- `versionary.jsonc` with `"mode": "simple"`
- `version.txt` as the version source
- `CHANGELOG.md` as release notes output

Commands:

- `pnpm verify`
- `pnpm plan`
- `pnpm changelog -- --write`
- `pnpm pr`

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
