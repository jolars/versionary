import { describe, expect, it } from "vitest";
import { renderSimpleChangelog } from "../src/domain/release/changelog.js";
import type { SimplePlan } from "../src/domain/release/plan.js";
import { parseConventionalCommitMessage } from "../src/infra/git/commits.js";

function makePlan(): SimplePlan {
  return {
    mode: "simple",
    releaseType: "minor",
    currentVersion: "0.1.0",
    nextVersion: "0.2.0",
    versionFile: "version.txt",
    changelogFile: "CHANGELOG.md",
    releaseBranchPrefix: "versionary/release",
    baselineSha: null,
    commits: [
      {
        ...parseConventionalCommitMessage("ci: update workflow"),
        hash: "1111111",
      },
      {
        ...parseConventionalCommitMessage("chore: bump deps"),
        hash: "2222222",
      },
      {
        ...parseConventionalCommitMessage("feat: add feature"),
        hash: "3333333",
      },
      { ...parseConventionalCommitMessage("fix: patch bug"), hash: "4444444" },
    ],
  };
}

describe("simple changelog rendering", () => {
  it("includes releasable commits and excludes ci/chore", () => {
    const prevServer = process.env.GITHUB_SERVER_URL;
    const prevRepo = process.env.GITHUB_REPOSITORY;
    let changelog = "";
    try {
      process.env.GITHUB_SERVER_URL = "https://github.com";
      process.env.GITHUB_REPOSITORY = "jolars/versionary";
      changelog = renderSimpleChangelog(makePlan());
    } finally {
      process.env.GITHUB_SERVER_URL = prevServer;
      process.env.GITHUB_REPOSITORY = prevRepo;
    }

    expect(changelog).toContain("### Features");
    expect(changelog).toContain("### Bug Fixes");
    expect(changelog).toContain("- add feature");
    expect(changelog).toContain("- patch bug");
    expect(changelog).not.toContain("ci: update workflow");
    expect(changelog).not.toContain("chore: bump deps");
    expect(changelog).toContain(
      "## [0.2.0](https://github.com/jolars/versionary/compare/v0.1.0...v0.2.0)",
    );
    expect(changelog).toContain(
      "[`3333333`](https://github.com/jolars/versionary/commit/3333333)",
    );
    expect(changelog).toContain(
      "[`4444444`](https://github.com/jolars/versionary/commit/4444444)",
    );
  });
});
