# Versioning

Versionary follows [Semantic Versioning 2.0.0](https://semver.org/). It maps the
[Conventional Commits](./conventional-commits) since the last release to a
single version bump and renders the changelog from the same set of commits.

A copy of the SemVer specification ships in the repository at
[`assets/semver-spec.md`](https://github.com/jolars/versionary/blob/main/assets/semver-spec.md).

## Commit-to-bump mapping

Each commit is classified as `major`, `minor`, `patch`, or "no release":

| Commit                                              | Bump    |
| --------------------------------------------------- | ------- |
| `!` in the header, or a `BREAKING CHANGE` footer    | `major` |
| `feat:`                                             | `minor` |
| `fix:` or `perf:`                                   | `patch` |
| `revert:`                                           | `patch` (or `major` if the revert is breaking) |
| `chore:` and everything else                        | none    |

The release for a window is the **highest** bump across all its commits:
`major` > `minor` > `patch`. If no commit is releasable, there is no release.

The breaking check is evaluated first, so a `feat!:` or a `fix:` with a
`BREAKING CHANGE:` footer is a `major`, not a `minor`/`patch`.

## How the next version is computed

Given the current version and the resolved bump:

| Current                              | `patch` | `minor` | `major` |
| ------------------------------------ | ------- | ------- | ------- |
| `1.4.2`                              | `1.4.3` | `1.5.0` | `2.0.0` |
| `0.7.3` (default)                    | `0.7.4` | `0.8.0` | `0.8.0` |
| `0.7.3` (`allow-stable-major: true`) | `0.7.4` | `0.8.0` | `1.0.0` |

### Pre-1.0 policy

While the major version is `0`, the public API is considered unstable, so
Versionary is conservative by default:

- a **breaking** change bumps the **minor** (`0.y.z` → `0.(y+1).0`) instead of
  going to `1.0.0`.

`allow-stable-major` defaults to `false`. Set it to `true` when a breaking
change on `0.y.z` should produce `1.0.0`.

The deprecated `bump-minor-pre-major` key remains available for compatibility.
See the [configuration reference](/reference/configuration#deprecated-bump-minor-pre-major)
for migration instructions.

In a monorepo, `allow-stable-major` may be set
[per package](/reference/configuration#packages); a package-level setting
overrides the top-level policy.

> Once a project is at `1.0.0` or above, breaking changes bump the major as
> usual.

## Reverts

`revert:` commits are releasable by default (patch, or major when the revert is
itself breaking, e.g. `revert!:`).

Versionary additionally applies **window suppression** when building both the
bump and the changelog:

- If a `revert:` commit targets one or more SHAs and **all** of those SHAs are
  present in the analyzed window, the revert *and* the reverted commits are
  dropped. The net effect is nothing, so they contribute no bump and appear in
  no changelog section.
- If a revert targets a commit **outside** the window (e.g. shipped in a prior
  release), the revert is kept and contributes a bump.

A revert only appears in the **Reverts** changelog section if the thing it
reverts would itself have been releasable.

## Changelog sections

The rendered changelog groups entries into the following sections, in order,
omitting any that are empty:

1. **Breaking changes** — any commit with a breaking marker
2. **Features** — `feat` commits (and other non-breaking minor bumps)
3. **Bug Fixes** — `fix` commits (and other non-breaking patch bumps)
4. **Performance Improvements** — `perf` commits
5. **Reverts** — releasable reverts
6. **Dependencies** — in monorepos, packages bumped via a
   [`follows`](./monorepos#follows) relationship

The default Markdown format renders an `h2` version heading linking to the
compare view between the previous and next tags. The R strategy uses the
[`r-news` format](/reference/strategies#r) instead, with `NEWS.md` conventions.

## Release highlights

You can inject hand-written **highlights** at the top of a release's notes by
adding an `Unreleased` section to the top of your changelog:

```markdown
# Changelog

## Unreleased

This release rewrites the planning engine for faster monorepo runs.

## [1.2.0](https://example.com/compare/v1.1.0...v1.2.0) (2026-01-01)
```

Any heading whose text is not a version works (`Unreleased`, `Upcoming`, and so
on). For the `r-news` format, use the `(development version)` heading
convention instead. When the release is cut, the block's prose is folded into
the new version's section and the placeholder heading is removed.
