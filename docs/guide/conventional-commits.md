# Conventional Commits

Versionary decides what to release by parsing your commit messages as
[Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/). The
commit type drives the [version bump](./versioning) and which changelog section
an entry lands in.

A copy of the Conventional Commits specification ships in the repository at
[`assets/conventional-commits-spec.md`](https://github.com/jolars/versionary/blob/main/assets/conventional-commits-spec.md).

## Commit format

```
<type>(<optional scope>)<optional !>: <description>

<optional body>

<optional footers>
```

Examples:

```
feat: add julia strategy
fix(parser): handle empty footer lines
feat(api)!: drop the v1 endpoints
perf: cache the commit range lookup
chore: bump dev dependencies
```

## How commits are parsed

The parser produces a structured representation of each commit, independent of
release policy. It exposes:

- `header`, `body`, and `footer`
- `type`, `scope`, `description`, and an `isBreakingHeader` flag (the `!`
  marker)
- `notes` — parsed `BREAKING CHANGE:` / `BREAKING-CHANGE:` footer entries
- `references` — issue/PR references such as `#123`, `GH-456`, and action forms
  like `closes #123` or `fixes owner/repo#789`
- `mentions` — `@username` mentions
- `revert` — revert metadata, including the SHAs a `revert:` commit targets
- `diagnostics` — non-fatal warnings (see below)

Keeping parsing separate from policy means the changelog can render rich
references and scopes even though the version bump only depends on the type and
breaking markers.

### Diagnostics

When a commit is *almost* conventional, Versionary emits diagnostics rather than
silently dropping information. These include:

- invalid/malformed headers
- malformed `BREAKING CHANGE` footers (e.g. wrong casing or separators)
- malformed issue references
- ambiguous reverts (a `revert:` with no resolvable target SHA)

## Which commits trigger a release

Only a subset of commit types affect the version and changelog:

| Type                  | Releasable? | Effect                          |
| --------------------- | ----------- | ------------------------------- |
| `feat`                | ✅          | minor bump → **Features**       |
| `fix`                 | ✅          | patch bump → **Bug Fixes**      |
| `perf`                | ✅          | patch bump → **Performance Improvements** |
| `revert:`             | ✅          | patch bump → **Reverts** (major if breaking) |
| anything `!` / `BREAKING CHANGE` | ✅ | major bump → **Breaking changes** |
| `chore`, `docs`, `style`, `test`, `ci`, `refactor`, … | ❌ | ignored: no bump, no changelog entry |

The mapping itself is documented in detail under [Versioning](./versioning).

Two things worth highlighting:

- **A breaking marker wins regardless of type.** Even a `docs!:` commit or a
  `docs:` commit with a `BREAKING CHANGE:` footer triggers a major bump.
- **Unrecognized types are ignored** unless they carry a breaking marker.

## Correcting commits before release

If a merged commit has the wrong type, record a replacement message:

```bash
versionary correct a1b2c3d --message "perf: cache commit lookups"
```

Versionary uses the corrected message for both the version bump and changelog.
For example, changing `feat` to `perf` changes that commit's contribution from
minor to patch. Other commits still contribute their normal bumps.

To exclude a commit entirely from release analysis and notes:

```bash
versionary exclude e4f5a6b --reason "Fixes an unreleased regression"
```

This is useful when a `fix` corrects a bug introduced after the previous
release. If a preceding `feat` introduced the affected feature, that feature
still drives the release, without a redundant bug-fix entry. Excluding the only
releasable commit can leave no release to prepare. Exclusion changes release
metadata; the code still ships.

Both commands update your configuration. Commit that change, then run
`versionary plan` or `versionary changelog` to inspect the result. See
[commit overrides](/reference/configuration#commit-overrides) for the config
format and monorepo behavior.

## Scopes and references in the changelog

When a commit has a scope, it is emphasized in the changelog entry as
`**scope:** description`. Issue references are grouped by action and linked back
to your repository, e.g. an entry may read:

```
- **parser:** handle empty footer lines ([`a1b2c3d`](…/commit/a1b2c3d)), closes #123
```

## Reverts

`revert:` commits are releasable (patch by default, major if the revert itself
is breaking). Versionary also performs **window suppression**: if a commit and
its revert both fall within the analyzed release window, both are removed from
the bump and the changelog—the net change is nothing, so nothing is reported. A
revert of a commit from a *previous* release is kept and triggers its own bump.
See [Versioning → Reverts](./versioning#reverts) for the details.

## Why this matters for contributors

Because Versionary releases itself and any project that adopts it, commit
messages are part of the public contract: they become the changelog and decide
the version. The [contributing guide](/contributing) covers the commit
conventions expected when working on Versionary itself.
