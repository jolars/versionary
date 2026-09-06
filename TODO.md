# Versionary TODO

This roadmap focuses on making Versionary a strong alternative to
`semantic-release` and `release-please`, with a small core and reliable release
workflows.

## Core reliability

- [x] Make release steps transactional/idempotent where possible (safe retry
      after partial failure).
- [x] Add explicit recovery flow for "tag exists, release metadata missing" and
      similar drift states.
- [ ] Improve error surfaces with actionable remediation messages per failed
      step.
- [ ] Add integration tests for failed SCM operations and rerun behavior.
- [x] Harden semantic version computation around the semver and conventional
      commits specs.

## Commit analysis and SemVer behavior

- [x] Improve revert handling so reverted features/fixes do not trigger
      incorrect bumps.
- [x] Add first-class pre-1.0.0 behavior controls (including conventional-commit
      expectations).
- [x] Retain `bump-minor-pre-major` as a deprecated input alias for
      `allow-stable-major`, and normalize it at the config boundary.
- [ ] Wire `include-commit-authors` into Git commit ingestion and changelog
      rendering, including identity fallbacks when no SCM login is available.
- [x] Add tests for edge-case commit parsing across scopes, breaking markers,
      and multi-line bodies.

## Trunk-based development support

- [ ] Harden baseline/range computation to avoid duplicate releases in
      fast-moving default branches.
- [ ] Document recommended CI patterns for trunk-based teams using `pnpm run`.
- [ ] Add tests for concurrent merges and repeated CI runs on the same release
      window.

## Monorepo ergonomics

- [x] Expand `packages` path handling and exclusion semantics for large
      monorepos.
- [x] Improve fixed vs independent mode UX and diagnostics.
- [x] Add fixtures for Rust cargo workspaces and mixed-language repos.
- [x] Support clearer per-package release previews in `plan` output.
- [x] Handle complex inter-package dependency scenarios (e.g. A depends on B,
      both updated in same release). Like Cargo workspaces.
- [ ] Normalize package paths in config and `.versionary-manifest.json` so
      equivalent forms (e.g. `"ts/"` vs `"ts"`) don't accumulate stale
      release-target entries when a config key is renamed
      (`src/release/state.ts:133-143`).
- [ ] Update `pnpm-lock.yaml` (and `yarn.lock`) on node version bumps. Shell
      out to `pnpm install --lockfile-only --ignore-scripts`, mirroring the
      cargo precedent in `src/strategy/rust.ts:146-167`. Otherwise pnpm
      workspaces fail `pnpm install --frozen-lockfile` after a release.

## Strategy expansion readiness

- [x] Add a documented "new strategy" checklist (required contract + wiring +
      tests + docs).
- [x] Add reusable cross-strategy contract tests for
      read/write/missing/malformed behavior.
- [x] Document ecosystem policy defaults (lockfiles, changelog source,
      workspace/inheritance rules) to guide Python and future strategies.
- [x] Add first Python strategy (`release-type: "python"`) with pyproject and
      fallback support.

## SCM integrations

- [ ] Stabilize GitHub integration end-to-end (PR update, labels, release
      metadata, auth edge cases).
- [ ] Add abstraction tests so SCM behavior is platform-neutral at the core.
- [ ] Prototype GitLab SCM capability parity.
- [ ] Prototype Codeberg/Gitea-compatible SCM capability parity.
- [ ] Add issue-commenting capability for issues related to releases (e.g.
      "Issue solved in [v2.1.2](link)").

## CLI and UX

- [ ] Improve `verify` output with grouped checks and suggested fixes.
- [x] Add machine-readable output mode(s) for CI orchestration.
- [x] Add dry-run guarantees for `pr` and `release` paths with deterministic
      output.
- [ ] Ensure all commands have crisp help text and examples.
