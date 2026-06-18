# Getting started

This guide walks through installing Versionary, writing a minimal config, and
running your first release plan. For unattended CI usage, see
[GitHub Actions](./github-actions).

## Requirements

- Node.js 20+ (the CLI is published as an ESM package).
- A git repository with a full history (`fetch-depth: 0` in CI), so Versionary
  can analyze commits since the last release.
- For some strategies, the matching toolchain must be on `PATH` (e.g. `cargo`
  for Rust lockfile refresh, `poetry`/`uv`/`pdm` for Python lockfiles). See
  [Strategies](/reference/strategies).

## Installation

Versionary is distributed on npm and exposes a `versionary` binary.

::: code-group

```bash [pnpm]
pnpm add -D versionary
```

```bash [npm]
npm install --save-dev versionary
```

```bash [yarn]
yarn add -D versionary
```

:::

You can also run it without installing:

```bash
npx versionary <command>
```

Or install directly from a git ref (a `prepare` build runs on install so the
binary is available):

```json
{
  "devDependencies": {
    "versionary": "github:jolars/versionary#<commit-or-tag>"
  }
}
```

## Create a config

Versionary is configured with a `versionary.jsonc` (preferred) or
`versionary.json` file at the root of your repository. These are the **only**
supported filenames.

A minimal config picks a [release strategy](/reference/strategies) for your
ecosystem. For a Node project:

```jsonc
{
  "$schema": "https://raw.githubusercontent.com/jolars/versionary/main/schemas/config.json",
  "version": 1,
  "release-type": "node"
}
```

The `$schema` line is optional but gives you autocomplete and validation in
editors. `version` is the config-format version and must be `1`.

If you omit `release-type`, Versionary uses the `simple` strategy, which tracks
the version in a plain `version.txt` file. See
[Configuration](/reference/configuration) for every available key and its
default.

## Verify your setup

`verify` validates your config and checks that the configured version files
exist and parse:

```bash
npx versionary verify
```

It prints `OK`/`FAIL` for each check and exits non-zero if anything fails—handy
as a CI gate.

## Preview the next release

`plan` computes the next version and the changelog **without changing
anything**, printing JSON:

```bash
npx versionary plan
```

To preview just the rendered changelog section:

```bash
npx versionary changelog
```

If there are no releasable commits since the last release, both commands report
that there is nothing to do.

## Your first release

How you cut a release depends on your [`review-mode`](./workflows):

- **Release PR workflow (default):** run `versionary run` (or the
  [GitHub Action](./github-actions)) on pushes to your default branch. It opens
  or updates a release PR containing the version bump and changelog. Merging
  that PR, then running `versionary run` again, publishes the release.
- **Direct workflow:** set `"review-mode": "direct"` to skip the PR and prepare
  the release branch directly.

In almost all cases you will drive this from CI rather than locally. Continue to
[Release workflows](./workflows) to understand the `run` dispatch, and
[GitHub Actions](./github-actions) to set up the automation and a suitable
token.

## Bootstrapping an existing project

When adopting Versionary in a repository with existing history, set
[`bootstrap-sha`](/reference/configuration#bootstrap-sha) to the commit to start
analyzing from (similar to `release-please`). After the first run, Versionary
tracks a baseline state file (`.versionary-manifest.json` by default) so
subsequent ranges are deterministic and independent of tags.
