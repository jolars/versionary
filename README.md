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
