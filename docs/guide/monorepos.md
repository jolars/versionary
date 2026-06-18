# Monorepos

Versionary can version multiple packages in a single repository. You opt in with
`monorepo-mode` and a `packages` map keyed by package path (use `"."` for the
repository root).

```jsonc
{
  "version": 1,
  "release-type": "rust",
  "monorepo-mode": "independent",
  "packages": {
    ".": { "exclude-paths": ["editors"] },
    "crates/parser": {},
    "editors/code": {
      "release-type": "node",
      "package-name": "my-editor-extension",
      "follows": ["."]
    }
  }
}
```

Each package inherits the top-level config and can override most keys. See
[Configuration → packages](/reference/configuration#packages) for the full list
of per-package keys.

## Independent vs. fixed

- **`independent`** — each package gets its own version, computed from the
  commits that touch it. This is the common monorepo layout.
- **`fixed`** — all configured packages share a single version, computed from
  one combined bump across them.

## Per-package strategies

A package may use a different [strategy](/reference/strategies) than the root.
In the example above, the repository is a Rust workspace, but `editors/code` is
a Node package. Set `release-type` on the package to override.

## Tag naming

For independent monorepo targets, tags are derived as:

- root package (`"."`): `v<version>` (e.g. `v1.2.3`)
- non-root package: `<release-name>-v<version>` (e.g. `parser-v0.4.0`)

The `<release-name>` is resolved with this precedence:

1. `packages.<path>.package-name` (explicit override)
2. the strategy-native package name from the version file:
   - Node: `package.json` `name`
   - Rust: `Cargo.toml` `[package].name`
   - R: `DESCRIPTION` `Package:`
3. the package path, as a fallback

If two packages resolve to the same `<release-name>` and version, the run fails
fast with a duplicate-tag error and suggests setting unique `package-name`
values.

## Dependency follows {#follows}

`follows` declares an **asymmetric** version link from one package to one or
more source packages. When any source bumps, the follower releases too, with:

```
follower bump = max(own bump, max(source bumps))
```

The follower's changelog gains a **Dependencies** section listing the followed
sources. Use it when one package bundles another's artifact—for example, an
editor extension that ships the CLI binary built from the root crate:

```jsonc
{
  "version": 1,
  "release-type": "rust",
  "monorepo-mode": "independent",
  "packages": {
    ".": { "exclude-paths": ["editors"] },
    "editors/code": {
      "release-type": "node",
      "package-name": "my-editor-extension",
      "follows": ["."]
    }
  }
}
```

Notes and constraints:

- `follows` is **non-transitive**: if A follows B and B follows C, A does *not*
  follow C automatically.
- Self-references, unknown source paths, and cycles are configuration errors.
- `follows` cannot be combined with `monorepo-mode: "fixed"` (fixed mode already
  pins everything together).

## Path-scoped commit filtering

`exclude-paths` drops commits that **only** touch the listed paths from a
package's bump and changelog. Paths are relative to the package.

- A top-level `exclude-paths` applies to every package (and to a single-package
  repository).
- A package's effective excludes are the **union** of the top-level list and its
  own list.

This is how a root package avoids reacting to commits that only touch a
subpackage's directory (see `"."` excluding `editors` above).

## Per-package version policy

`allow-stable-major` can be set per package to override the top-level
[pre-1.0 policy](./versioning#pre-1-0-policy) for that package's own bump
(including `follows`-driven and dependency-propagation bumps). In `fixed` mode,
the single shared version is governed by the top-level `allow-stable-major`
only.
