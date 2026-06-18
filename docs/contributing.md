# Contributing

Contributions are welcome! Versionary is in early, alpha-stage development, so
there's plenty to do and breaking changes are still on the table before
`1.0.0`.

The authoritative contributing guide lives at the repository root:

👉 **[CONTRIBUTING.md on GitHub](https://github.com/jolars/versionary/blob/main/CONTRIBUTING.md)**

It covers the development environment, the essential commands, the Conventional
Commit conventions, the config-schema workflow, and how to add a new release
strategy.

## At a glance

```bash
pnpm install        # set up the project
pnpm build          # compile
pnpm test           # run tests
pnpm typecheck      # type-check
biome check .       # lint
biome format . --write
```

Working on the docs themselves?

```bash
pnpm docs:dev       # local preview with hot reload
pnpm docs:build     # production build (fails on dead links)
```

The docs sources live in `docs/guide/` and `docs/reference/`. When you change
Versionary's behavior, please update the relevant page in the same PR.
