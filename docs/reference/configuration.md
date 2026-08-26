# Configuration

Versionary reads configuration from **`versionary.jsonc`** (preferred) or
**`versionary.json`** at the repository root. These are the only supported
filenames. The schema is strict—unknown keys are rejected.

## Editor support

Add a `$schema` reference for autocomplete and validation:

```jsonc
{
  "$schema": "https://raw.githubusercontent.com/jolars/versionary/main/schemas/config.json",
  "version": 1,
  "release-type": "node"
}
```

The published schema is generated from Versionary's internal Zod schema, which
is the single source of truth for the config shape.

## Top-level keys

| Key                          | Type                  | Default                  | Description |
| ---------------------------- | --------------------- | ------------------------ | ----------- |
| `version`                    | `1`                   | — (required)             | Config-format version. Must be `1`. |
| `$schema`                    | string                | —                        | JSON Schema URL for editor support. |
| `release-type`               | string \| string[]    | `"simple"`               | The [strategy](/reference/strategies) (or array of strategies) used to read/write versions. |
| `review-mode`                | `"direct"` \| `"pr"`  | `"pr"`                   | Release style. `pr` opens a release PR; `direct` skips it. See [workflows](/guide/workflows). |
| `version-file`               | string                | strategy-specific        | Path to the primary version source. Default depends on `release-type` (see table below). |
| `changelog-file`             | string                | `CHANGELOG.md` / `NEWS.md` | Path to the changelog. Defaults to `NEWS.md` for the R strategy, `CHANGELOG.md` otherwise. |
| `changelog-format`           | `"markdown-changelog"` \| `"r-news"` | strategy-specific | Changelog format. Defaults to `r-news` for the R strategy, `markdown-changelog` otherwise. |
| `release-branch`             | string                | `"versionary/release"`   | Branch used for the release PR/commit. |
| `baseline-file`              | string                | `".versionary-manifest.json"` | File tracking the baseline SHA for deterministic commit ranges. |
| `bootstrap-sha`              | string                | —                        | First-run baseline commit when adopting Versionary on existing history. |
| `release-draft`              | boolean               | `false`                  | Publish GitHub Releases as drafts. |
| `release-reference-comments` | `"off"` \| `"best-effort"` \| `"strict"` | `"off"` | Whether to comment on linked issues/PRs when released. See below. |
| `monorepo-mode`              | `"independent"` \| `"fixed"` | —                 | Enables [monorepo](/guide/monorepos) planning. |
| `packages`                   | object                | —                        | Per-package configuration (see [packages](#packages)). |
| `allow-stable-major`         | boolean               | `false`                  | Allow a breaking change on `0.y.z` to bump to `1.0.0`. See [pre-1.0 policy](/guide/versioning#pre-1-0-policy). |
| `exclude-paths`              | string[]              | —                        | Glob/path prefixes whose changes don't, on their own, count toward a bump. Applies repo-wide and to every package. |
| `bump-minor-pre-major`       | boolean               | —                        | Accepted by the schema; not yet wired into release logic. Use `allow-stable-major` for pre-1.0 control. |
| `include-commit-authors`     | boolean               | —                        | Accepted by the schema; not yet wired into changelog rendering. |

### `release-reference-comments`

Controls comments posted on issues/PRs referenced by released commits:

- `off` (default) — don't post comments.
- `best-effort` — post comments, but continue if the API call fails (e.g.
  missing permissions).
- `strict` — fail the release if a comment can't be posted.

Comments require `issues: write` permission and are authored by the account that
owns the configured token. The comment body itself is signed by Versionary.

### Default version files by strategy

| `release-type` | Default `version-file` |
| -------------- | ---------------------- |
| `simple`       | `version.txt`          |
| `cmake`        | `CMakeLists.txt`        |
| `node`         | `package.json`         |
| `rust`         | `Cargo.toml`           |
| `r`            | `DESCRIPTION`          |
| `python`       | `pyproject.toml`       |
| `julia`        | `Project.toml`         |
| `latex`        | `build.lua`            |

See [Strategies](/reference/strategies) for the full behavior of each.

## `packages`

A map keyed by package path (`"."` for the repository root). Used with
`monorepo-mode`. Each entry inherits the top-level config and may override:

| Key                  | Type               | Description |
| -------------------- | ------------------ | ----------- |
| `release-type`       | string \| string[] | Strategy for this package, overriding the top-level value. |
| `package-name`       | string             | Override the release/tag name (otherwise derived from the version file or path). |
| `changelog-file`     | string             | Package-specific changelog path (written under the package directory). |
| `changelog-format`   | `"markdown-changelog"` \| `"r-news"` | Package-specific changelog format. |
| `allow-stable-major` | boolean            | Override the pre-1.0 policy for this package's own bump. |
| `exclude-paths`      | string[]           | Paths (relative to the package) to exclude; unioned with the top-level list. |
| `follows`            | string[]           | Source packages this package follows; see [follows](/guide/monorepos#follows). |
| `extra-files`        | artifact-rule[]    | Additional files to update with the new version (see below). |

See the [monorepos guide](/guide/monorepos) for tag naming, `follows`, and
filtering semantics.

## `extra-files`

`extra-files` (per package) updates additional files to the new version. Each
rule is an **artifact rule**:

| Field        | Type   | Applies to            | Description |
| ------------ | ------ | --------------------- | ----------- |
| `type`       | enum   | all                   | One of `json`, `toml`, `yaml`, `nix`, `regex`. |
| `path`       | string | all                   | Path to the file to update. |
| `field-path` | string | `json`/`toml`/`yaml`/`nix` | JSONPath-style locator of the version field (e.g. `$.version`). Required for these types. |
| `pattern`    | string | `regex`               | Regex with a capturing group (or a named `(?<version>…)` group) around the version. Required for `regex`. |
| `replacement`| string | `regex`               | Optional template for the substituted text. When set, the **entire match** is replaced with the rendered template. |
| `expected-matches` | positive integer | `regex` | Exact number of occurrences the pattern must match. Defaults to `1`. |

Validation rules enforced by the schema:

- `json`/`toml`/`yaml`/`nix` rules **require** `field-path` and **must not** use
  `pattern` or `replacement`.
- `regex` rules **require** `pattern` and **must not** use `field-path`.
- `expected-matches` is available only for `regex` rules and must be a positive
  integer.

### Regex substitution

Without a `replacement`, the first capturing group is replaced with the full
computed version, leaving the rest of the match intact. This keeps a full
`versionary@1.2.3`-style reference in sync.

By default, the pattern must match exactly once. Set `expected-matches` when a
file intentionally contains several occurrences. Versionary updates every
match and aborts if the actual count differs, guarding against missing or
overly broad matches.

With a `replacement`, the whole match is replaced by the rendered template. The
following `{{token}}` placeholders are available:

| Token            | Value                                  |
| ---------------- | -------------------------------------- |
| `{{version}}`    | the full computed version (`1.2.3`)    |
| `{{major}}`      | the major component (`1`)              |
| `{{minor}}`      | the minor component (`2`)              |
| `{{patch}}`      | the patch component (`3`)              |
| `{{prerelease}}` | dot-joined prerelease identifiers      |
| `{{build}}`      | dot-joined build-metadata identifiers  |

This is useful for major-only references such as a moving `@v1` tag, which
should only advance on a major release:

```jsonc
{
  "type": "regex",
  "path": "README.md",
  "pattern": "jolars/panache-action@v(\\d+)",
  "replacement": "jolars/panache-action@v{{major}}"
}
```

On a `2.0.0` release this rewrites `@v1` to `@v2` (not `@v2.0.0`).

Example — keep the action's pinned version in sync, plus a TOML manifest:

```jsonc
{
  "version": 1,
  "release-type": "node",
  "packages": {
    ".": {
      "extra-files": [
        {
          "type": "yaml",
          "path": "action.yml",
          "field-path": "$.inputs.versionary-version.default"
        },
        {
          "type": "regex",
          "path": "README.md",
          "pattern": "versionary@(?<version>\\d+\\.\\d+\\.\\d+)"
        }
      ]
    }
  }
}
```

## Validation errors

`packages` with `follows` are validated at load time. The following are
configuration errors:

- a package following itself
- following an unknown package path
- `follows` cycles (reported with the offending chain)
- combining `follows` with `monorepo-mode: "fixed"`

Run [`versionary verify`](/reference/cli#verify) to check your config and
version files before relying on them in CI.
