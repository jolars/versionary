# Release workflows

Versionary supports two release styles, selected with the `review-mode` config
key, and a single `run` entrypoint that does the right thing based on context.

## Review modes

```jsonc
{
  "version": 1,
  "release-type": "node",
  "review-mode": "pr" // "pr" (default) | "direct"
}
```

- **`pr`** (default) — the **release PR workflow**. Versionary prepares or
  updates a dedicated release branch with the version bump and changelog, then
  opens or updates a release PR through the SCM provider. A maintainer reviews
  and merges; the merge produces a release commit, and the next `run` publishes
  the release.
- **`direct`** — the **direct workflow**. Versionary commits the version bump,
  changelog, and release state to the triggering branch, pushes that commit,
  and publishes the tags and releases in the same run.

## The `run` command

`run` is the recommended CI entrypoint. In `pr` mode, it inspects the most recent
commit and auto-dispatches:

```
                ┌─ last commit is a release commit ─→ publish the release
versionary run ─┤
                └─ otherwise ─→ plan; if there are releasable commits,
                                prepare/update the release PR,
                                else close any stale release PR and exit
```

A commit counts as a **release commit** when its subject looks like
`chore(release): v1.2.3` (including multi-target and monorepo tag forms) or it
carries a `Versionary-Release: true` footer. This is exactly the commit
Versionary writes when preparing a release, so merging a release PR naturally
triggers the publish path on the next run.

With [`separate-release-prs`](/guide/monorepos#separate-release-prs), `run`
also recognizes a merged package-state sidecar as release context. It publishes
only the untagged package cohorts represented in the merged tree, then updates
or closes the remaining package release PRs against the new trunk state.

`run` supports:

- `--json` — emit a machine-readable result (used by the
  [GitHub Action](./github-actions)). The `action` field is one of `noop`,
  `pr-prepared`, `pr-up-to-date`, `pr-dry-run`, `release-skipped`,
  `release-dry-run`, or `release-published`.
- `--dry-run` — compute and report what would happen without pushing branches,
  opening PRs, or creating tags/releases.

See the [CLI reference](/reference/cli) for the full output shape and the other
commands (`verify`, `plan`, `changelog`, `pr`, `release`).

## A typical CI lifecycle

1. A `feat:`/`fix:` commit lands on `main`.
2. CI runs `versionary run`. No release commit is present, so it opens a release
   PR: *"chore(release): v1.3.0"* with the changelog.
3. More commits land; each `run` updates the same release PR in place.
4. A maintainer merges the release PR. The merge commit is a release commit.
5. The next `versionary run` takes the publish path: it creates the tag and the
   GitHub Release.
6. A separate, release-triggered workflow publishes to your registry.

In a separate-PR monorepo, steps 2–5 happen independently for each package or
coupled cohort. Merging one package PR does not require merging the others.

In `direct` mode, steps 2–5 happen in one invocation. Versionary writes the
release commit to the triggering branch and publishes it immediately after the
push succeeds. The token must be allowed to push to that branch. A rejected
push stops publishing; Versionary never force-pushes the base branch. Run it
after your required CI checks pass.

Outside GitHub Actions, Versionary uses the checked-out branch.
`VERSIONARY_BASE_BRANCH` can specify the target branch explicitly, including
when running from a detached checkout. A direct-mode `--dry-run` reports the
planned releases without creating a commit or changing any files.

The GitHub Action skips an outdated ordinary push run after the branch advances,
which prevents an older run from overwriting release planning based on a newer
commit. A commit with the explicit `Versionary-Release: true` marker is an
exception: if it remains an ancestor of the current branch tip, its run may
publish that exact commit. An unrelated commit can therefore land while the
release checks are running without forcing a recovery PR. If the release commit
is no longer on the branch—for example, after a force-push—the Action still
skips it.

## Maintenance releases

Each maintained base branch owns an independent release line. For example, after
shipping 2.0.0 from `main`, you can continue releasing backported fixes from `1.x`:

| Base branch | Versions | `VERSIONARY_BASE_BRANCH` | Generated `release-branch` | `release-latest` |
| --- | --- | --- | --- | --- |
| `main` | 2.x | `main` | `versionary/release` | `true` |
| `1.x` | 1.x | `1.x` | `versionary/release-1.x` | `false` |

Create `1.x` from the last 1.x release you want to maintain, before adding breaking
changes on `main`. For example, `git switch -c 1.x v1.15.0` starts the maintenance
branch at that release. Keep each branch's package versions, changelog, and
`.versionary-manifest.json` on that branch. Versionary reads the checked-out tree
and analyzes its release history independently.

On `main`, a Rust project's `versionary.jsonc` can contain:

```jsonc
{
  "version": 1,
  "release-type": "rust",
  "release-branch": "versionary/release",
  "release-latest": true
}
```

On `1.x`, use:

```jsonc
{
  "version": 1,
  "release-type": "rust",
  "release-branch": "versionary/release-1.x",
  "release-latest": false
}
```

`release-branch` names the generated release PR branch. `VERSIONARY_BASE_BRANCH`
selects the base branch that receives the PR. Give each line a distinct generated
branch: sharing one would let a run overwrite the other line's release PR branch.

While 2.0 is under development, keep its release PR open until you are ready to
ship. If 1.x remains the current stable line during that period, keep its
`release-latest` value `true`. Switch it to `false` when 2.0 becomes the current
stable release, before publishing further maintenance releases. Published beta or
RC releases require a separate prerelease policy; disabling Latest promotion does
not make a release a prerelease.

### GitHub Actions recipe

Commit this workflow on both base branches, adapting the test job to your Rust
project's toolchain and required checks. Configure a `RELEASE_TOKEN` as described
in [Choosing a token](./github-actions#choosing-a-token). Use a Versionary release
that includes `release-latest`; older versions reject the unknown configuration
key.

```yaml
name: CI and release

on:
  push:
    branches: [main, '1.x']
  pull_request:
    branches: [main, '1.x']

permissions:
  contents: read

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v6
      - run: cargo test --workspace

  release:
    needs: test
    if: >-
      github.event_name == 'push' &&
      (github.ref == 'refs/heads/main' || github.ref == 'refs/heads/1.x')
    runs-on: ubuntu-latest
    concurrency:
      group: versionary-${{ github.ref }}
      cancel-in-progress: false
    permissions:
      contents: write
      pull-requests: write
    env:
      VERSIONARY_BASE_BRANCH: ${{ github.ref_name }}
    steps:
      - uses: actions/checkout@v6
        with:
          fetch-depth: 0
          fetch-tags: true
          token: ${{ secrets.RELEASE_TOKEN || github.token }}
      - uses: jolars/versionary@v1
        with:
          token: ${{ secrets.RELEASE_TOKEN }}
```

CI tests pushes and PRs targeting either base branch. The release job runs only
on base-branch pushes after tests pass, so `github.ref_name` is the intended base
branch. Full history and tags let Versionary resolve the branch's release
baseline. Concurrency is separate for each line and does not cancel an active
release when a new push arrives.

Both lines can also use `review-mode: "direct"`. Versionary then pushes release
commits to the selected base branch and publishes in the same run; the token must
be allowed to push to that branch.

### Backporting a fix

Select the fix on `main`, then cherry-pick or adapt it in a PR targeting `1.x`.
Keep an appropriate conventional commit message, such as `fix: repair convergence`.
After that PR merges, Versionary plans a patch from the maintenance branch's own
version—for example, `1.15.0` to `1.15.1`. Merging its release PR creates `v1.15.1`
and a GitHub Release without promoting it to Latest. Main-only commits do not
enter the maintenance changelog.

Backport the source changes and let each branch generate its own release
bookkeeping. Do not copy release commits, version bumps, changelogs, or baseline
manifests between lines. Backport selection, cherry-picking, and conflict
resolution remain manual.

Versionary does not enforce a version range based on the branch name. A `feat:`
commit can produce a minor release, and a breaking commit or `Release-As:` override
can move a `1.x` branch to 2.0.0. Review the planned version before merging its
release PR, or enforce your maintenance policy in CI when using direct releases.

Registry publishing remains a separate workflow triggered by a tag or release.
Website deployment also needs its own stable/prerelease and maintenance policy:
a workflow that deploys every `v*` tag can replace the 2.x website with a later 1.x
backport. `release-latest: false` does not suppress tag or release events. Select
the line allowed to deploy the main site, or publish each line under its own URL.

## Idempotency, retries, and recovery

Publishing is **idempotent by target tag**, so reruns after a partial failure
are safe:

- if a tag already exists, Versionary reuses it instead of recreating it
- if release metadata already exists for that tag, it is reused
- if a previous run created/pushed the tag but failed before creating metadata,
  a rerun creates the missing metadata and proceeds

If CI fails before Versionary reaches the publish job and a corrective commit
must land on the base branch, Versionary preserves the untagged pending version.
The next `run` recreates the release PR with an empty release-marker commit on
top of the corrected base. It does not plan a later version—even when the
corrective commit would ordinarily cause a semantic-version bump. After that PR
merges and CI succeeds, Versionary publishes the original pending tags.

In direct mode, recovery writes the release-marker commit to the triggering
branch and publishes the pending version in the same run, without a recovery PR.

Separate package releases recover on their original cohort branches. A tag
created for one independent cohort does not block recovery of another. A
partially tagged multi-package cohort cannot move to a corrected commit; rerun
the original release workflow so its idempotent publish path can finish the
remaining targets.

Versionary **fails fast** when recovery would be unsafe—for example, when a
local and a remote tag of the same name point to different commits. The error
message includes remediation guidance so CI logs stay actionable.

## Author and committer identity

Two distinct identities are involved when releasing through a provider:

- **The token's account** owns the GitHub Release, the tag/branch push, and any
  release-reference comments. There is no API to set these independently of the
  token.
- **The release commit's committer** comes from git's `user.name`/`user.email`.
  When neither is set (a bare CI runner), Versionary defaults it to
  `github-actions[bot]`, so no `git config` step is required.

The [GitHub Actions guide](./github-actions#choosing-a-token) explains how to
choose a token so releases are attributed the way you want.
