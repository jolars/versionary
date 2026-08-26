# Strategies

A **strategy** (the `release-type` config key) tells Versionary how to read and
write a project's version, what to validate, and which changelog format to
prefer. The version bump itself comes from
[Conventional Commits](/guide/conventional-commits) and is the same across all
strategies—the strategy only governs *where* the version lives and which files
get updated.

| `release-type` | Version source     | Default changelog | Notes |
| -------------- | ------------------ | ----------------- | ----- |
| `simple`       | `version.txt`      | `CHANGELOG.md`    | Plain text. The default. |
| `cmake`        | `CMakeLists.txt`    | `CHANGELOG.md`    | Literal `project(... VERSION X.Y.Z ...)`. |
| `node`         | `package.json`     | `CHANGELOG.md`    | Syncs npm lockfiles. |
| `rust`         | `Cargo.toml`       | `CHANGELOG.md`    | Workspace inheritance, internal deps, `Cargo.lock`. |
| `python`       | `pyproject.toml`   | `CHANGELOG.md`    | Or a `.py` `__version__` file; refreshes lockfiles. |
| `r`            | `DESCRIPTION`      | `NEWS.md`         | Uses the `r-news` changelog format. |
| `julia`        | `Project.toml`     | `CHANGELOG.md`    | Root-level `version`. |
| `latex`        | `build.lua`        | `CHANGELOG.md`    | Also updates `.dtx` package metadata. |

For polyglot projects, `release-type` can be an **array** to
[compose strategies](#composite-strategies).

The version file can be overridden per project (or per package) with the
`version-file` config key, with the strategy-specific exceptions noted below.

## simple

The default when `release-type` is omitted.

- **Version source:** `version.txt` (override with `version-file`).
- **Reads/writes:** the trimmed contents of the file; writes `version\n`.
- No dependency management, no lockfiles. Ideal for docs sites, non-standard
  projects, or anything without a language manifest.

## cmake

- **Version source:** `CMakeLists.txt` by default. Versionary reads and updates
  the literal `VERSION` argument in `project()`.
- **Supported versions:** `X.Y.Z` and CMake's four-component `X.Y.Z.W` form.
  Variable expansion, prerelease identifiers, and build metadata are not
  supported because Versionary does not evaluate CMake code and CMake's
  `project(VERSION)` syntax accepts only numeric components.
- **Package name:** the first literal argument to the same `project()` call.
- The parser accepts multiline declarations, comments, case-insensitive command
  names, and flexible keyword ordering. The write preserves surrounding
  formatting and comments.
- The version file must contain exactly one `project()` declaration with a
  `VERSION` argument.
- **Changelog:** `markdown-changelog`.

## node

- **Version source:** `package.json` `version` field.
- **Package name:** `package.json` `name` (used for monorepo tag naming).
- **Lockfiles:** when present, `package-lock.json` and `npm-shrinkwrap.json` are
  updated to the new version in the same write.
- **Changelog:** `markdown-changelog`.

## rust

- **Version source:** `Cargo.toml` `[package].version`. `version-file` must
  point at a `Cargo.toml`.
- **Package name:** `Cargo.toml` `[package].name`.
- **Workspaces:** virtual/workspace manifests expand to their members.
  Crates using `version.workspace = true` resolve and update
  `[workspace.package].version` in the owning workspace manifest.
- **Internal dependencies:** when a dependency name matches another targeted
  crate, its version requirement is rewritten across `[dependencies]`,
  `[dev-dependencies]`, `[build-dependencies]`, and their `[target.*]` variants.
  Operators (`^`, `~`, `>=`, …) and table vs. string forms are preserved.
- **Lockfiles:** `Cargo.lock` files are refreshed via `cargo generate-lockfile`.
  `cargo` must be on `PATH` during PR preparation when a `Cargo.lock` exists.
- **Publishability:** crates with `publish = false`, an empty registry list, or
  either inherited via `publish.workspace = true`, are exempt from
  [published dependency freshness](../guide/monorepos#stale-dependencies).
- **Changelog:** `markdown-changelog`.

**Not done (by design):** external dependency updates, `workspace.dependencies`
updates, adding missing `version` fields to dependency tables, or publishing to
crates.io.

### Keep `cargo publish` verification on

Workspace crates carry dual-spec dependencies
(`{ path = "...", version = "0.1.1" }`). In-repo builds resolve through `path`,
so the `version` requirement is never exercised until someone installs from the
registry—a green CI run says nothing about whether the published manifest set is
coherent.

`cargo publish` builds each crate against its *registry* dependencies, which is
the one place an incoherent published graph surfaces before users hit it.
Publishing with `--no-verify` skips that build. Leave it on in the workflow that
publishes on tag or release events, so a bad set fails to publish rather than
shipping.

## python

- **Version source:** `pyproject.toml` by default. Versionary updates
  `[project].version` and/or `[tool.poetry].version`—whichever are present.
- **Source-file mode:** point `version-file` at a Python file (e.g.
  `src/<pkg>/__init__.py`) to update a `__version__ = "X.Y.Z"` assignment
  instead of the TOML.
- **`__init__.py` discovery:** when using `pyproject.toml`, a matching
  `__init__.py` with `__version__` in standard locations is also updated.
- **Package name:** `[project].name`, falling back to `[tool.poetry].name`.
- **Lockfiles:** `poetry.lock`, `uv.lock`, and `pdm.lock` at the package root
  are refreshed by shelling out to the matching tool (`poetry lock --no-update`,
  `uv lock`, `pdm lock --update-reuse`). The corresponding binary must be on
  `PATH`.
- **Changelog:** `markdown-changelog`.

## r

- **Version source:** `DESCRIPTION` `Version:` field.
- **Package name:** `DESCRIPTION` `Package:` field.
- **Changelog:** defaults to **`NEWS.md`** with the **`r-news` format**, which
  follows R package conventions (single-`#` version headings, abbreviated
  `major.minor` headings, and extraction of an "unreleased"/development notes
  block at the top of `NEWS.md`).
- Updates are performed by targeted replacement of the `Version:` line.

## julia

- **Version source:** `Project.toml`, the root-level `version` field (Julia
  keeps `name`/`version` as root keys, not under a `[table]`).
- The update is line-based to preserve formatting, comments, quote style, and
  line endings; it stops searching at the first table header.
- **Changelog:** `markdown-changelog`.

## latex

- **Version source:** `build.lua` (the `version = "X.Y.Z"` assignment).
- **`.dtx` metadata:** during finalization, every `.dtx` file under `src/` is
  updated. Versionary rewrites the package metadata using the **release commit
  date**:
  - `\ProvidesPackage{name}[YYYY-MM-DD vX.Y.Z description]`
  - `\ProvidesExplPackage{name}{YYYY-MM-DD}{X.Y.Z}{description}`
  Each `.dtx` must contain exactly one such entry, and `src/` must contain at
  least one `.dtx` file.
- **Changelog:** `markdown-changelog`.

## Composite strategies

Set `release-type` to an array to update multiple manifests with the same
version—useful for projects that carry more than one language manifest:

```jsonc
{
  "version": 1,
  "release-type": ["python", "rust"]
}
```

Semantics:

- The **first** entry is the **primary**. It drives `readVersion`,
  `readPackageName`, and consumes any `version-file` override.
- Each subsequent entry is a **secondary** and writes its own default manifest
  to the same target version (secondaries do not see the primary's
  `version-file` override).
- Validation, dependency-impact propagation, and finalization run across all
  strategies; the changelog format comes from the primary.

Common combinations:

- `["python", "rust"]` — PyO3/maturin (`pyproject.toml` + `Cargo.toml` +
  `Cargo.lock`)
- `["node", "rust"]` — napi-rs (`package.json` + `Cargo.toml` + `Cargo.lock`)
- `["r", "rust"]` — R packages with embedded Rust crates

::: warning
The array form does not yet support nested manifests at non-default paths (e.g.
an R package's `src/rust/Cargo.toml`). Until per-strategy `version-file`
overrides land, use a single strategy for those layouts.
:::

## Auto-detection

Strategies are selected explicitly via `release-type`; there is no silent
auto-detection by language. However, [`versionary verify`](/reference/cli#verify)
validates that the configured strategy's version file exists and parses, so a
misconfigured `release-type` is caught early.
