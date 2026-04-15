# Versionary TODO

This roadmap focuses on making Versionary a strong alternative to
`semantic-release` and `release-please`, with a small core and reliable release
workflows.

## Core reliability

- [ ] Make release steps transactional/idempotent where possible (safe retry
      after partial failure).
- [ ] Add explicit recovery flow for "tag exists, release metadata missing" and
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
- [ ] Add fixtures for Rust cargo workspaces and mixed-language repos.
- [x] Support clearer per-package release previews in `plan` output.
- [ ] Handle complex inter-package dependency scenarios (e.g. A depends on B,
      both updated in same release). Like Cargo workspaces.

## Plugin and extension model

- [ ] Define stable internal release-step lifecycle hooks (plan, mutate files,
      review request, release metadata).
- [ ] Decide whether external plugin loading remains internal-only or becomes
      public API.
- [ ] Add built-in artifact update rules for json/toml/yaml/regex with strong
      validation.
- [ ] Add comprehensive plugin-capability tests and failure-mode tests.

## SCM integrations

- [ ] Stabilize GitHub integration end-to-end (PR update, labels, release
      metadata, auth edge cases).
- [ ] Add abstraction tests so SCM behavior is platform-neutral at the core.
- [ ] Prototype GitLab SCM plugin capability parity.
- [ ] Prototype Codeberg/Gitea-compatible SCM plugin capability parity.
- [ ] Add issue-commenting capability for issues related to releases (e.g.
      "Issue solved in [v2.1.2](link)").

## CLI and UX

- [ ] Improve `verify` output with grouped checks and suggested fixes.
- [ ] Add machine-readable output mode(s) for CI orchestration.
- [ ] Add dry-run guarantees for `pr` and `release` paths with deterministic
      output.
- [ ] Ensure all commands have crisp help text and examples.

## Docs and examples

- [ ] Add comparison matrix: Versionary vs semantic-release vs release-please.
- [ ] Add cookbook examples for Node, Rust, and generic `version.txt` projects.
- [ ] Add CI templates showing "release PR mode" and "direct release mode".
- [ ] Document non-goals clearly (no registry publishing).

## Short-term priority (suggested)

1. [x] SCM failure recovery and idempotency.
2. [x] GitHub integration hardening and docs/examples.
3. [ ] Monorepo cargo-workspace and mixed-language fixtures.
4. [ ] CLI machine-readable output + dry-run guarantees.
