# GitHub Actions

Versionary ships a GitHub Action that runs the [`run`](./workflows)
command and exposes machine-readable outputs. This page covers a complete
workflow, the permissions and token you need, and how to wire downstream
registry publishing.

GitHub is currently the only built-in SCM provider.

## Quick start

```yaml
name: Release

on:
  push:
    branches: [main]

jobs:
  release:
    runs-on: ubuntu-latest
    permissions:
      contents: write
      pull-requests: write
    steps:
      - uses: actions/checkout@v6
        with:
          fetch-depth: 0
          fetch-tags: true
          token: ${{ secrets.RELEASE_TOKEN || github.token }}
      - id: versionary
        uses: jolars/versionary@v1
        with:
          token: ${{ secrets.RELEASE_TOKEN }}
```

Two details matter regardless of the rest of your setup:

- **`fetch-depth: 0` and `fetch-tags: true`.** Versionary analyzes the full
  commit history and existing tags. A shallow checkout will give wrong results.
- **A token with the right permissions** (see [below](#choosing-a-token)),
  except when [skipping an unconfigured fork](#forked-repositories).

Because `run` auto-dispatches, this single job handles both halves of the
release PR workflow: on a normal push it opens/updates the release PR, and on
the release commit (after the PR merges) it publishes the release.

With `review-mode: "direct"`, the same job commits the version bump and
changelog to the triggering branch and publishes immediately. Place it after
your build and test jobs using `needs`. Its token needs `contents: write` and
permission to push to that branch under your repository's branch rules.

For parallel release lines such as `main` and `1.x`, use the
[maintenance workflow recipe](./workflows#maintenance-releases). It gives each
line its own release PR branch and explicitly selects the base branch.

## Skipping checks on release PRs

Set [`release-pr-checks: "skip"`](/reference/configuration#release-pr-checks)
to skip expensive checks on Versionary release PRs while keeping checks and
publication running after merging. This is useful with
[`separate-release-prs`](/guide/monorepos#separate-release-prs), where each
package PR would otherwise repeat the same checks. The default is `"run"`.

```jsonc
{
  "version": 1,
  "release-pr-checks": "skip"
}
```

Wire the workflow to Versionary's decision once. A small job runs the Action
with `command: ci` and exposes its `run_checks` output. Build, test, and lint
jobs use that output in their conditions:

```yaml
jobs:
  ci:
    runs-on: ubuntu-latest
    outputs:
      run_checks: ${{ steps.policy.outputs.run_checks }}
    steps:
      - uses: actions/checkout@v7
        with:
          ref: ${{ github.event.pull_request.base.sha || github.sha }}
      - id: policy
        uses: jolars/versionary@v1
        with:
          command: ci

  test:
    needs: ci
    if: ${{ !cancelled() && needs.ci.outputs.run_checks != 'false' }}
    runs-on: ubuntu-latest
    steps:
      # Your existing test steps.
```

The decision job checks out the PR's base commit, so its configuration comes
from the branch receiving the release. It needs only `contents: read`, a
shallow checkout, and no release token. It evaluates policy without changing
Git configuration, branches, tags, or releases. Use a Versionary release that
includes `release-pr-checks` and the Action's `command: ci` mode.

Versionary recognizes the configured `release-branch` and, when
`separate-release-prs` is enabled, its generated package and cohort branches.
Reserve these names for Versionary. Custom and maintenance release branches
use their own base branch's configuration, so the workflow needs no branch
matching expressions. Checks run on ordinary PRs, fork PRs, pushes, and
events with incomplete PR metadata. Direct release mode also keeps checks
enabled.

The job condition skips checks only when Versionary explicitly returns
`"false"`. If the decision job fails, checks still run. Once the workflow is
wired, changing `release-pr-checks` in the base branch's configuration controls
the behavior.

Keep the release job on pushes to the base branch and make it depend on both
the decision job and your checks with `needs: [ci, test]`. Because checks still
run on pushes, publishing continues to wait for successful CI. The complete
[CI workflow example](https://github.com/jolars/versionary/blob/main/examples/release-pr-ci.yml)
shows this setup with a Node.js test job; replace its test steps with your own
ecosystem's checks.

For other integrations, [`versionary ci --json`](/reference/cli#ci) exposes the
same decision from the checked-out configuration.

A [conditionally skipped job](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/control-jobs-with-conditions)
satisfies its required status check. If your branch rules require individual
matrix check names, keep those jobs and apply the condition to their expensive
steps instead. Avoid adding `[skip ci]` to release commits: GitHub can then
skip the entire post-merge push workflow and leave required checks pending.
See [GitHub's skip instructions](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/skip-workflow-runs).

## Forked repositories

With the default `command: run`, the action skips release automation successfully
when the repository running the workflow is a fork and its `token` input is
empty. It reports
`action: fork-skipped`, `release_created: "false"`, and a message explaining
the skip. It does this before invoking Git or the Versionary CLI.

Use the **checkout token** fallback shown in the quick start so checkout can
succeed when the fork has no release secret. Keep the **Versionary token** set
to the `RELEASE_TOKEN` secret alone: supplying a token, including the built-in
`github.token`, enables normal release automation on the fork.

An empty token still causes an error on upstream repositories. This automatic
skip is specific to the GitHub Action. It cannot prevent failures in earlier
steps that require secrets, such as generating a GitHub App token; use a
job-level condition to skip those jobs in forks.

## Permissions

Set `permissions` at the workflow or job level to the minimum the flow needs:

| Flow                                  | Required permissions                      |
| ------------------------------------- | ----------------------------------------- |
| Release PR create/update              | `contents: write`, `pull-requests: write` |
| Release publish (tag + GitHub Release)| `contents: write`                         |
| Release-reference comments (optional) | add `issues: write`                       |

A single job that does everything (the quick-start above) needs
`contents: write` and `pull-requests: write`, plus `issues: write` if you enable
[`release-reference-comments`](/reference/configuration#release-reference-comments).

## Choosing a token

With `command: run`, the action needs a token for two things: **GitHub API calls**
(PRs, releases, comments) and **git push authentication** for the release branch
and tags.
Whatever you pass becomes the author of those actions—there is no API to set a
separate author—so pick a token based on the identity you want releases
attributed to.

::: warning The default `GITHUB_TOKEN` has a catch
Pushes and tags created with the workflow's built-in `GITHUB_TOKEN` **do not
trigger other workflows**. If you rely on a separate `release.published` (or tag
`push`) workflow to publish to a registry, that downstream workflow **will not
fire**. Use a PAT, a bot account, or a GitHub App token if you need to trigger
downstream automation.
:::

### Option 1 — built-in `GITHUB_TOKEN`

Simplest, attributed to `github-actions[bot]`. Fine when you do not need to
trigger downstream workflows.

```yaml
permissions:
  contents: write
  pull-requests: write
steps:
  - uses: actions/checkout@v6
    with:
      fetch-depth: 0
      fetch-tags: true
  - uses: jolars/versionary@v1
    with:
      token: ${{ secrets.GITHUB_TOKEN }}
```

### Option 2 — Personal Access Token (PAT)

Attributed to **your** user account, and—crucially—**does** trigger downstream
workflows.

- **Fine-grained PAT** (recommended): scope it to the repository (or org) and
  grant repository permissions **Contents: Read and write** and **Pull requests:
  Read and write** (add **Issues: Read and write** for reference comments).
- **Classic PAT**: grant the `repo` scope.

Store it as a repository or organization secret (e.g. `RELEASE_TOKEN`) and pass
it as `token`:

```yaml
with:
  token: ${{ secrets.RELEASE_TOKEN }}
```

### Option 3 — dedicated bot account

For a clean, non-personal identity (like `semantic-release`'s
`@semantic-release-bot`): create a separate GitHub user, give it write access to
the repository, generate a PAT for it, and store that as your release token.
Releases are then attributed to the bot account and trigger downstream
workflows.

### Option 4 — GitHub App installation token

Attributed to `<app-name>[bot]`, scoped per installation, and triggers
downstream workflows. Mint a short-lived token at runtime:

```yaml
steps:
  - uses: actions/create-github-app-token@v2
    id: app-token
    with:
      app-id: ${{ vars.RELEASE_APP_ID }}
      private-key: ${{ secrets.RELEASE_APP_PRIVATE_KEY }}
  - uses: actions/checkout@v6
    with:
      fetch-depth: 0
      fetch-tags: true
      token: ${{ steps.app-token.outputs.token }}
  - uses: jolars/versionary@v1
    with:
      token: ${{ steps.app-token.outputs.token }}
```

### Token resolution

When you run the CLI directly (outside the action), the GitHub provider reads
the token from environment variables, in precedence order:

```
VERSIONARY_PR_TOKEN > GH_TOKEN > GITHUB_TOKEN
```

The action wraps this for you: it takes the `token` input and exposes it to the
CLI. It also configures the `origin` remote and a default git identity if none
is set.

## Committer identity

The release commit's committer comes from git config, not the token. On a bare
runner where neither `user.name` nor `user.email` is set, the action defaults
the committer to `github-actions[bot]` so you don't need a `git config` step. An
existing identity (local, global, or one set by another action) is left
untouched.

## Action reference

### Inputs

| Input               | Required | Default  | Description                                            |
| ------------------- | -------- | -------- | ------------------------------------------------------ |
| `command`           | no       | `run`    | `run` orchestrates releases; `ci` evaluates check policy without a token. |
| `token`             | conditional | —     | GitHub token for `command: run`; omit to skip a fork. Unused by `command: ci`. |
| `versionary-version`| no       | pinned   | npm version or dist-tag of Versionary to run.          |
| `working-directory` | no       | `.`      | Directory containing `versionary.jsonc`/`.json`.       |

### Outputs

| Output            | Description                                                   |
| ----------------- | ------------------------------------------------------------- |
| `action`          | `ci-evaluated`, `noop`, `fork-skipped`, `pr-prepared`, `release-published`, `release-skipped`, … |
| `message`         | Human-readable result summary.                                |
| `run_checks`      | `"true"` or `"false"` from `command: ci`; use to gate CI jobs. |
| `is_release_pr`   | `"true"` when `command: ci` recognizes a Versionary release PR. |
| `release_created` | `"true"` when at least one release was published.             |
| `release_ready`   | `"true"` when a merged release is ready for external tooling. |
| `tag_name`        | First published tag (single-target flows).                    |
| `tag_names`       | JSON array of all published tags.                             |
| `release_targets` | Dependency-first release targets; external targets also include `sha` and `notes`. |
| `review_url`      | Primary release PR URL when PRs were prepared.                 |
| `review_requests` | JSON array of all package/cohort release PR results.           |
| `branch`          | Primary release branch name when PRs were prepared.            |
| `title`           | Primary release PR title when PRs were prepared.               |

`command: ci` sets `action`, `message`, `run_checks`, and `is_release_pr`.
The release outputs apply to `command: run`.

The primary outputs preserve compatibility with single-PR workflows. Parse
`review_requests` when
[`separate-release-prs`](/guide/monorepos#separate-release-prs) is enabled.

For registration before tagging, see [Julia packages](./julia). In external
mode, use `release_ready` to trigger downstream work. `release_created` remains
false until Versionary itself creates a release.

## Publishing to a registry

Versionary does **not** publish to npm, crates.io, PyPI, CRAN, etc. It creates
the tag and the GitHub Release; your CI performs registry publication.

For a single package, or packages without release dependencies, a separate
workflow can trigger on `release.published`:

```yaml
name: Publish

on:
  release:
    types: [published]

jobs:
  publish:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v6
      # … build and publish to your registry …
```

Remember the [`GITHUB_TOKEN` caveat](#choosing-a-token): for this workflow to
fire, Versionary must have created the release with a PAT, bot, or App token.

For a coupled package cohort, consume `release_targets` from a job that depends
on the Versionary job:

```yaml
jobs:
  versionary:
    runs-on: ubuntu-latest
    outputs:
      release_created: ${{ steps.versionary.outputs.release_created }}
      release_targets: ${{ steps.versionary.outputs.release_targets }}
    steps:
      - uses: actions/checkout@v6
        with:
          fetch-depth: 0
          token: ${{ secrets.RELEASE_TOKEN || github.token }}
      - id: versionary
        uses: jolars/versionary@v1
        with:
          token: ${{ secrets.RELEASE_TOKEN }}

  publish:
    needs: versionary
    if: needs.versionary.outputs.release_created == 'true'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v6
      - name: Publish dependency-first targets
        env:
          RELEASE_TARGETS: ${{ needs.versionary.outputs.release_targets }}
        run: ./scripts/publish-release-targets "$RELEASE_TARGETS"
```

Each target has `path`, `version`, `tag`, and `dependencies` fields. Entries are
ordered dependencies first; `dependencies` contains configured package paths
from the same release. Dependency cycles cannot be ordered dependencies first,
so those targets fall back to package-path order. The publishing script or specialized ecosystem action
remains responsible for registry authentication, selecting publishable
packages, publishing them, and waiting until each dependency is available
before publishing its dependents.

`tag_name` and `tag_names` retain their historical target order for
compatibility. Use `release_targets`, not those tag projections, when dependency
order matters.

Do not use one independently triggered workflow per target when publication
order matters. GitHub Actions does not serialize separate workflow runs merely
because Versionary created their releases in a particular order.

## Keeping `@v1` current

Publish immutable tags (`v1.2.3`) and maintain a moving major tag (`v1`) that
points at the latest `v1.x.y`. A small release-triggered workflow can update
`v1` so `uses: jolars/versionary@v1` stays current without breaking major
compatibility.
