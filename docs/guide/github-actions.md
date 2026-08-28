# GitHub Actions

Versionary ships a composite GitHub Action that runs the [`run`](./workflows)
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
      - id: versionary
        uses: jolars/versionary@v1
        with:
          token: ${{ secrets.RELEASE_TOKEN }}
```

Two details matter regardless of the rest of your setup:

- **`fetch-depth: 0` and `fetch-tags: true`.** Versionary analyzes the full
  commit history and existing tags. A shallow checkout will give wrong results.
- **A token with the right permissions** (see [below](#choosing-a-token)).

Because `run` auto-dispatches, this single job handles both halves of the
release PR workflow: on a normal push it opens/updates the release PR, and on
the release commit (after the PR merges) it publishes the release.

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

The action needs a token for two things: **GitHub API calls** (PRs, releases,
comments) and **git push authentication** for the release branch and tags.
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
| `token`             | yes      | —        | GitHub token for SCM integration and git push.         |
| `versionary-version`| no       | pinned   | npm version or dist-tag of Versionary to run.          |
| `working-directory` | no       | `.`      | Directory containing `versionary.jsonc`/`.json`.       |

### Outputs

| Output            | Description                                                   |
| ----------------- | ------------------------------------------------------------- |
| `action`          | `noop`, `pr-prepared`, `release-published`, `release-skipped`, … |
| `message`         | Human-readable result summary.                                |
| `release_created` | `"true"` when at least one release was published.             |
| `tag_name`        | First published tag (single-target flows).                    |
| `tag_names`       | JSON array of all published tags.                             |
| `release_targets` | Dependency-first JSON array of released package targets.      |
| `review_url`      | Primary release PR URL when PRs were prepared.                 |
| `review_requests` | JSON array of all package/cohort release PR results.           |
| `branch`          | Primary release branch name when PRs were prepared.            |
| `title`           | Primary release PR title when PRs were prepared.               |

The primary outputs preserve compatibility with single-PR workflows. Parse
`review_requests` when
[`separate-release-prs`](/guide/monorepos#separate-release-prs) is enabled.

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
