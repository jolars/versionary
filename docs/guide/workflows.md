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
- **`direct`** — the **direct workflow**. Versionary prepares/updates the
  release branch but skips creating a review request.

## The `run` command

`run` is the recommended CI entrypoint. It inspects the most recent commit and
auto-dispatches:

```
                ┌─ last commit is a release commit ─→ publish the release
versionary run ─┤
                └─ otherwise ─→ plan; if there are releasable commits,
                                prepare/update the release PR (or branch),
                                else close any stale release PR and exit
```

A commit counts as a **release commit** when its subject looks like
`chore(release): v1.2.3` (including multi-target and monorepo tag forms) or it
carries a `Versionary-Release: true` footer. This is exactly the commit
Versionary writes when preparing a release, so merging a release PR naturally
triggers the publish path on the next run.

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

In `direct` mode, steps 2–4 collapse: the release branch is prepared without a
review request, and publishing follows once the release commit is on the branch
you run against.

## Idempotency, retries, and recovery

Publishing is **idempotent by target tag**, so reruns after a partial failure
are safe:

- if a tag already exists, Versionary reuses it instead of recreating it
- if release metadata already exists for that tag, it is reused
- if a previous run created/pushed the tag but failed before creating metadata,
  a rerun creates the missing metadata and proceeds

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
