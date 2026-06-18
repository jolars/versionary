# CLI commands

Versionary exposes a single `versionary` binary. All commands operate on the
current repository and read configuration from `versionary.jsonc` (preferred) or
`versionary.json`.

```
versionary <command> [flags]
```

If no command is given, `run` is used.

| Command     | Purpose                                                        |
| ----------- | -------------------------------------------------------------- |
| `run`       | Auto-dispatch: prepare/update a release PR, or publish a release. |
| `verify`    | Validate config and repository shape.                          |
| `plan`      | Print the computed release plan as JSON.                       |
| `changelog` | Print or write the next release's changelog section.           |
| `pr`        | Prepare the release PR commit and branch.                      |
| `release`   | Publish release metadata for a release commit.                 |

## `run`

The recommended CI entrypoint. It reads the last commit and dispatches:

- if the last commit is a **release commit**, it publishes the release;
- otherwise it computes a plan and, if there are releasable commits, prepares or
  updates the release PR/branch; if there are none, it closes any stale release
  PR and exits.

See [Release workflows](/guide/workflows) for what counts as a release commit.

**Flags**

- `--json` — emit a machine-readable result instead of human text.
- `--dry-run` — report what would happen without pushing, opening PRs, or
  creating tags/releases.

**JSON output**

```jsonc
{
  "action": "pr-prepared",       // see table below
  "message": "Prepared release PR branch versionary/release",
  "releaseCreated": false,
  "tagNames": [],
  "reviewUrl": "https://github.com/owner/repo/pull/42", // when a PR is opened
  "branch": "versionary/release",
  "title": "chore(release): v1.3.0",
  "targets": [                    // present for dry-run / multi-target flows
    { "tag": "v1.3.0", "version": "1.3.0" }
  ]
}
```

`action` is one of:

| Value               | Meaning                                            |
| ------------------- | -------------------------------------------------- |
| `noop`              | No releasable commits; nothing to do.              |
| `pr-prepared`       | Release PR branch prepared and pushed.             |
| `pr-up-to-date`     | Release PR branch already current.                 |
| `pr-dry-run`        | Would prepare a release PR (dry run).              |
| `release-skipped`   | Release skipped (e.g. nothing to publish).         |
| `release-dry-run`   | Would publish a release (dry run).                 |
| `release-published` | Release published.                                 |

## `verify`

Validates configuration and basic repository shape. Checks are grouped into
**Config**, **Paths**, and **Version files**, each printed as `OK`/`FAIL` with
details and remediation hints.

Exits `0` when all checks pass and `1` otherwise—use it as a CI gate.

```bash
versionary verify
```

## `plan`

Computes the release plan and prints it as pretty JSON, without changing
anything. The plan includes the next version, the release branch prefix, the
changelog file and format, any per-package targets, and the grouped commits.

```bash
versionary plan
```

If there are no releasable commits, the plan's `nextVersion` is absent.

## `changelog`

Renders the next release's changelog section.

- Without flags, prints the section to stdout.
- With `--write`, prepends the section to the configured changelog file and
  consumes any [next-release highlights](/reference/configuration#next-release-file).

```bash
versionary changelog            # preview
versionary changelog --write    # update CHANGELOG.md (or NEWS.md)
```

## `pr`

Prepares the release PR: it computes the plan, updates version files, changelog,
and any [extra files](/reference/configuration#extra-files), commits a
`chore(release): v*` commit on the release branch, pushes it, and opens or
updates the review request through the SCM provider.

**Flags**

- `--dry-run` — report what would happen without pushing or opening a request.

```bash
versionary pr
```

If there are no releasable commits, it closes any stale release PR and exits.

## `release`

Publishes release metadata (tags and the GitHub Release) for a release commit.
This is the publish path that `run` dispatches to automatically; you rarely need
to call it directly.

**Flags**

- `--dry-run` — report what would be published without creating tags or
  releases.

```bash
versionary release
```

Publishing is idempotent by tag and recovers from partial failures; see
[Idempotency, retries, and recovery](/guide/workflows#idempotency-retries-and-recovery).
