import { describe, expect, it } from "vitest";
import { parseConventionalCommitMessage } from "../src/git/commits.js";
import { renderSimpleChangelog } from "../src/release/changelog.js";
import type { SimplePlan } from "../src/release/plan.js";

function makePlan(): SimplePlan {
  return {
    mode: "simple",
    releaseType: "minor",
    currentVersion: "0.1.0",
    nextVersion: "0.2.0",
    packageName: "versionary",
    versionFile: "version.txt",
    changelogFile: "CHANGELOG.md",
    changelogFormat: "markdown-changelog",
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

  it("renders perf commits under Performance Improvements, not Bug Fixes", () => {
    const prevServer = process.env.GITHUB_SERVER_URL;
    const prevRepo = process.env.GITHUB_REPOSITORY;
    let changelog = "";
    try {
      process.env.GITHUB_SERVER_URL = "https://github.com";
      process.env.GITHUB_REPOSITORY = "jolars/versionary";
      const plan = makePlan();
      plan.commits.push({
        ...parseConventionalCommitMessage("perf: speed up parser"),
        hash: "9999999",
      });
      changelog = renderSimpleChangelog(plan);
    } finally {
      process.env.GITHUB_SERVER_URL = prevServer;
      process.env.GITHUB_REPOSITORY = prevRepo;
    }

    expect(changelog).toContain("### Performance Improvements");
    const perfIdx = changelog.indexOf("### Performance Improvements");
    expect(changelog.indexOf("- speed up parser")).toBeGreaterThan(perfIdx);
    const fixesSection = changelog.slice(
      changelog.indexOf("### Bug Fixes"),
      perfIdx,
    );
    expect(fixesSection).not.toContain("speed up parser");
  });

  it("includes revert commits in a dedicated section", () => {
    const prevServer = process.env.GITHUB_SERVER_URL;
    const prevRepo = process.env.GITHUB_REPOSITORY;
    let changelog = "";
    try {
      process.env.GITHUB_SERVER_URL = "https://github.com";
      process.env.GITHUB_REPOSITORY = "jolars/versionary";
      const plan = makePlan();
      plan.commits.push({
        ...parseConventionalCommitMessage("revert: feat: add feature"),
        hash: "5555555",
      });
      changelog = renderSimpleChangelog(plan);
    } finally {
      process.env.GITHUB_SERVER_URL = prevServer;
      process.env.GITHUB_REPOSITORY = prevRepo;
    }

    expect(changelog).toContain("### Reverts");
    expect(changelog).toContain("- feat: add feature");
    expect(changelog).toContain(
      "[`5555555`](https://github.com/jolars/versionary/commit/5555555)",
    );
  });

  it("omits reverts of non-releasable commits from Reverts section", () => {
    const prevServer = process.env.GITHUB_SERVER_URL;
    const prevRepo = process.env.GITHUB_REPOSITORY;
    let changelog = "";
    try {
      process.env.GITHUB_SERVER_URL = "https://github.com";
      process.env.GITHUB_REPOSITORY = "jolars/versionary";
      const plan = makePlan();
      plan.commits = [
        {
          ...parseConventionalCommitMessage('revert: "chore(release): v1.2.3"'),
          hash: "6666666",
        },
      ];
      changelog = renderSimpleChangelog(plan);
    } finally {
      process.env.GITHUB_SERVER_URL = prevServer;
      process.env.GITHUB_REPOSITORY = prevRepo;
    }

    expect(changelog).not.toContain("### Reverts");
    expect(changelog).not.toContain("chore(release): v1.2.3");
  });

  it("omits revert pairs that cancel out within the same release window", () => {
    const prevServer = process.env.GITHUB_SERVER_URL;
    const prevRepo = process.env.GITHUB_REPOSITORY;
    let changelog = "";
    try {
      process.env.GITHUB_SERVER_URL = "https://github.com";
      process.env.GITHUB_REPOSITORY = "jolars/versionary";
      const feature = {
        ...parseConventionalCommitMessage("feat: add feature"),
        hash: "7777771",
      };
      const revert = {
        ...parseConventionalCommitMessage(
          "revert: feat: add feature",
          "This reverts commit 7777771.",
        ),
        hash: "7777772",
      };
      const plan = makePlan();
      plan.commits = [feature, revert];
      changelog = renderSimpleChangelog(plan);
    } finally {
      process.env.GITHUB_SERVER_URL = prevServer;
      process.env.GITHUB_REPOSITORY = prevRepo;
    }

    expect(changelog).not.toContain("### Features");
    expect(changelog).not.toContain("### Reverts");
    expect(changelog).not.toContain("add feature");
  });

  it("adds Dependencies section for dependency-propagated root bumps", () => {
    const prevServer = process.env.GITHUB_SERVER_URL;
    const prevRepo = process.env.GITHUB_REPOSITORY;
    let changelog = "";
    try {
      process.env.GITHUB_SERVER_URL = "https://github.com";
      process.env.GITHUB_REPOSITORY = "jolars/versionary";
      const plan = makePlan();
      plan.packages = [
        {
          path: ".",
          releaseType: "patch",
          currentVersion: "0.1.0",
          nextVersion: "0.1.1",
          bumpReason: "dependency-propagation",
          commits: [],
        },
        {
          path: "crates/panache-parser",
          releaseType: "patch",
          currentVersion: "0.3.1",
          nextVersion: "0.3.2",
          bumpReason: "direct",
          commits: [
            {
              ...parseConventionalCommitMessage("fix(parser): bug"),
              hash: "6666666",
            },
          ],
        },
      ];
      changelog = renderSimpleChangelog(plan);
    } finally {
      process.env.GITHUB_SERVER_URL = prevServer;
      process.env.GITHUB_REPOSITORY = prevRepo;
    }

    expect(changelog).toContain("### Dependencies");
    expect(changelog).toContain("- updated crates/panache-parser to v0.3.2");
  });

  it("adds Dependencies section for direct root bumps with dependency impacts", () => {
    const prevServer = process.env.GITHUB_SERVER_URL;
    const prevRepo = process.env.GITHUB_REPOSITORY;
    let changelog = "";
    try {
      process.env.GITHUB_SERVER_URL = "https://github.com";
      process.env.GITHUB_REPOSITORY = "jolars/panache";
      const plan = makePlan();
      plan.currentVersion = "2.37.0";
      plan.nextVersion = "2.38.0";
      plan.packages = [
        {
          path: ".",
          releaseType: "minor",
          currentVersion: "2.37.0",
          nextVersion: "2.38.0",
          bumpReason: "direct",
          dependencySourcePaths: [
            "crates/panache-formatter",
            "crates/panache-parser",
          ],
          commits: [
            {
              ...parseConventionalCommitMessage(
                "feat(cli): default to global cache dir",
              ),
              hash: "ccccccc3",
            },
          ],
        },
        {
          path: "crates/panache-formatter",
          releaseType: "patch",
          currentVersion: "0.2.0",
          nextVersion: "0.2.1",
          bumpReason: "direct",
          commits: [
            {
              ...parseConventionalCommitMessage(
                "fix(formatter): allow Rcpp as language",
              ),
              hash: "ddddddd4",
            },
          ],
        },
        {
          path: "crates/panache-parser",
          releaseType: "patch",
          currentVersion: "0.4.1",
          nextVersion: "0.4.2",
          bumpReason: "direct",
          commits: [
            {
              ...parseConventionalCommitMessage(
                "fix(parser): allow Rcpp in hashpipe parse",
              ),
              hash: "eeeeeee5",
            },
          ],
        },
      ];
      changelog = renderSimpleChangelog(plan);
    } finally {
      process.env.GITHUB_SERVER_URL = prevServer;
      process.env.GITHUB_REPOSITORY = prevRepo;
    }

    expect(changelog).toContain("### Features");
    expect(changelog).toContain("### Dependencies");
    expect(changelog).toContain("- updated crates/panache-formatter to v0.2.1");
    expect(changelog).toContain("- updated crates/panache-parser to v0.4.2");
  });

  it("deduplicates root changelog commits by hash when commit ranges overlap", () => {
    const prevServer = process.env.GITHUB_SERVER_URL;
    const prevRepo = process.env.GITHUB_REPOSITORY;
    let changelog = "";
    try {
      process.env.GITHUB_SERVER_URL = "https://github.com";
      process.env.GITHUB_REPOSITORY = "jolars/panache";
      const duplicate = {
        ...parseConventionalCommitMessage("feat: support smart punctuation"),
        hash: "926a4c80ed854f5a0afdfdae4d512adf91840525",
      };
      const plan = makePlan();
      plan.currentVersion = "2.35.0";
      plan.nextVersion = "2.36.0";
      plan.commits = [duplicate, duplicate];
      changelog = renderSimpleChangelog(plan);
    } finally {
      process.env.GITHUB_SERVER_URL = prevServer;
      process.env.GITHUB_REPOSITORY = prevRepo;
    }

    const matches = changelog.match(/support smart punctuation/gu) ?? [];
    expect(matches).toHaveLength(1);
  });

  it("groups same-action references with natural language for two issues", () => {
    const prevServer = process.env.GITHUB_SERVER_URL;
    const prevRepo = process.env.GITHUB_REPOSITORY;
    let changelog = "";
    try {
      process.env.GITHUB_SERVER_URL = "https://github.com";
      process.env.GITHUB_REPOSITORY = "jolars/panache";
      const plan = makePlan();
      plan.commits = [
        {
          ...parseConventionalCommitMessage(
            "fix(parser): handle bare #| comments",
            "Fixes #188, fixes #190",
          ),
          hash: "1a7d009",
        },
      ];
      changelog = renderSimpleChangelog(plan);
    } finally {
      process.env.GITHUB_SERVER_URL = prevServer;
      process.env.GITHUB_REPOSITORY = prevRepo;
    }

    expect(changelog).toContain(
      "fixes [#188](https://github.com/jolars/panache/issues/188) and [#190](https://github.com/jolars/panache/issues/190)",
    );
    expect(changelog).not.toContain(", fixes [#190]");
  });

  it("groups same-action references with Oxford comma for three+ issues", () => {
    const prevServer = process.env.GITHUB_SERVER_URL;
    const prevRepo = process.env.GITHUB_REPOSITORY;
    let changelog = "";
    try {
      process.env.GITHUB_SERVER_URL = "https://github.com";
      process.env.GITHUB_REPOSITORY = "jolars/panache";
      const plan = makePlan();
      plan.commits = [
        {
          ...parseConventionalCommitMessage(
            "fix(parser): handle bare #| comments",
            "Fixes #188, fixes #190, and fixes #201",
          ),
          hash: "1a7d009",
        },
      ];
      changelog = renderSimpleChangelog(plan);
    } finally {
      process.env.GITHUB_SERVER_URL = prevServer;
      process.env.GITHUB_REPOSITORY = prevRepo;
    }

    expect(changelog).toContain(
      "fixes [#188](https://github.com/jolars/panache/issues/188), [#190](https://github.com/jolars/panache/issues/190), and [#201](https://github.com/jolars/panache/issues/201)",
    );
  });
});
