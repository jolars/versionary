# What is Versionary?

Versionary is a software-agnostic, automated release tool. It reads your
[Conventional Commits](./conventional-commits), computes the next
[Semantic Version](./versioning), generates a changelog, updates your version
files, creates tags, and publishes release metadata to your source-control
provider (GitHub today).

It is designed as a practical middle ground between
[`semantic-release`](https://github.com/semantic-release/semantic-release) and
[`release-please`](https://github.com/googleapis/release-please):

- Like `semantic-release`, it supports **direct release execution**—merge to
  your trunk and a release goes out.
- Like `release-please`, it supports a **release PR workflow**, so maintainers
  can preview and review the version bump and changelog before anything is
  published.

You choose which behavior you want with the [`review-mode`](./workflows) config
key.

## What it does

The core keeps versioning, changelog generation, tagging, and release metadata
in one tool:

- semantic version planning from commits
- changelog generation
- release PR automation
- tags and SCM release metadata (e.g., GitHub Releases)

## What it does not do (by design)

- **Publishing artifacts to language registries** (npm, crates.io, PyPI, CRAN,
  …). Versionary creates the tag and the release; your CI publishes from that
  event.
- **Replacing package-specific publish tooling.**
- **Loading external/user-provided plugins** at runtime. Extension points exist,
  but they are internal.

Use your CI/CD platform for registry publishing, triggered from the
release/tag that Versionary creates. See [GitHub Actions](./github-actions) for
the wiring.

## Design priorities

When in doubt, Versionary favors:

- **trunk-based-development compatibility**
- **monorepo ergonomics**
- **explicit failure handling** over a broad dependency surface
- a **small, stable core** with clear extension points
- staying **SCM-agnostic at the core** with built-in provider integration
  (GitHub first; others later)

## Status

Versionary is in early, alpha-stage development. Breaking changes are expected
before `1.0.0`. The
[changelog](https://github.com/jolars/versionary/blob/main/CHANGELOG.md) tracks
what has shipped.

## Next steps

- [Getting started](./getting-started) — install, configure, and run your first
  release.
- [Conventional Commits](./conventional-commits) — how commits are parsed and
  filtered.
- [Versioning](./versioning) — how the next version is computed.
- [GitHub Actions](./github-actions) — automate the whole thing in CI.
