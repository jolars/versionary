# Julia package releases

Versionary can prepare Julia release PRs while Registrator and TagBot handle
registration and the final GitHub release. Merging a release PR is the only
manual step in the normal workflow:

1. Versionary updates `Project.toml` and `CHANGELOG.md` from Conventional
   Commits and opens a release PR.
2. After merging and passing CI, a workflow requests registration on the exact
   merged commit, including Versionary's reviewed release notes.
3. Registrator opens a registry PR. Once it is accepted, TagBot creates the tag
   and GitHub release using those notes.

Registration remains a CI responsibility. Versionary does not submit registry
PRs or interpret registry approval policies.

## Configuration

Use a Versionary release that includes package-level `release-mode` and the
`external_release_targets` output. Install the
[Registrator GitHub App](https://github.com/JuliaRegistries/Registrator.jl#install-registrator)
on the package repository and configure:

```jsonc
{
  "$schema": "https://raw.githubusercontent.com/jolars/versionary/main/schemas/config.json",
  "version": 1,
  "release-type": "julia",
  "review-mode": "pr",
  "release-mode": "external"
}
```

`review-mode` chooses how version changes are reviewed. `release-mode` chooses
who creates tags and GitHub release metadata. Its default, `versionary`, keeps
the normal workflow. `external` delegates that work and also supports direct
releases. Package-level
`release-mode` values override the repository default, so a Julia client can
use Registrator and TagBot alongside Versionary-managed Python or Rust clients:

```jsonc
{
  "version": 1,
  "review-mode": "pr",
  "separate-release-prs": true,
  "packages": {
    "packages/python": { "release-type": "python" },
    "packages/julia": {
      "release-type": "julia",
      "release-mode": "external"
    }
  }
}
```

A pending external version stays fixed until its tag appears. Independent
packages can still prepare and publish releases. Packages that depend on a
pending external version wait with it; a fixed-version monorepo waits as a
whole. Versionary never recreates an external registration as a recovery PR.

For an existing package, set `bootstrap-sha` to the commit that introduced its
current manually managed version. This excludes earlier release history from
the first automated plan. Keep the existing version in `Project.toml`.

## GitHub Actions

Start from the complete [Julia workflow example](https://github.com/jolars/versionary/blob/main/examples/julia-release.yml),
or append its Versionary job to your existing CI workflow. Make that job depend
on the required tests. Fetch full history and tags, and serialize runs on each
release branch without canceling a pending registration request.

The example uses `RELEASE_TOKEN` for release PRs so their checks start
automatically. With `GITHUB_TOKEN`, those checks may require approval. Another
option is to dispatch the check workflows explicitly on the release branch,
using `actions: write` and enabling `workflow_dispatch` in each check workflow.
See [GitHub's trigger rules](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/trigger-a-workflow).

The registration step uses `github.token`, posting as `github-actions[bot]`,
which Registrator accepts. It needs `contents: write` to create a commit
comment. No separate Registrator token or Julia installation is needed.

On a merged release commit, Versionary returns `release-ready` and sets the
Action's `release_ready` output to `"true"`. Each `external_release_targets`
entry includes `sha` and `notes` alongside `path`, `version`, `tag`, and
`dependencies`.
The example posts `@JuliaRegistrator register` on `sha`, followed by a
`Release notes:` section containing `notes`.

Subdirectory packages get a `subdir` argument. Configure a separate TagBot step
for each package, with matching subdirectory and tag-prefix settings. Dependent
packages may need to wait for dependencies to be accepted before their own
registration passes registry checks.

## TagBot

Keep TagBot's registry notification and manual triggers, along with any SSH key
needed for Documenter builds. Replace its generated changelog with custom notes:

```yaml
- uses: JuliaRegistries/TagBot@v1
  with:
    token: ${{ secrets.GITHUB_TOKEN }}
    ssh: ${{ secrets.DOCUMENTER_KEY }}
    changelog: "{{ custom }}"
```

Remove `changelog_format: conventional` if configured. TagBot's default
`custom` format uses this template. See [Registrator's release notes](https://github.com/JuliaRegistries/Registrator.jl#release-notes)
and [TagBot's changelogs](https://github.com/JuliaRegistries/TagBot#changelogs).

## Waiting and retries

Versionary reports `release-waiting` when only external releases remain pending.
It resumes planning each package once its expected tag exists locally. Fetch
tags before running it. While a package waits, Versionary preserves its merged
commit and reads its notes from Git history. It does not bump that package or
create a recovery PR for it. Partially tagged cohorts are expected while
independent registrations finish.

Use `external_release_targets` for registration, including retries while an
unrelated package publishes. Mixed runs can report both `release_created` and
`release_ready` as `"true"`; only Versionary-managed releases appear in
`tag_names`. External-only runs also expose their handoff in `release_targets`
for compatibility, with `release_created: "false"` and empty `tag_names`.
Submitting registration does not mean a version was accepted or released.

The example identifies comments by package path, version, and commit to avoid
duplicate requests on reruns. If Registrator needs another request, manually
run the workflow on `main` with `retry-registration` enabled. This resubmits the
saved commit even if trunk has advanced. An API failure fails the job and can
be retried normally.

If registry review requires source changes, merge the correction and explicitly
request registration on that corrected commit with the reviewed notes.
Versionary does not silently move a pending registration to a newer commit.
TagBot's eventual version tag completes the pending release.
