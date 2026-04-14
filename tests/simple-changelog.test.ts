import { describe, expect, it } from "vitest";
import { renderSimpleChangelog } from "../src/simple/changelog.js";
import type { SimplePlan } from "../src/simple/plan.js";

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
      { hash: "1111111", subject: "ci: update workflow" },
      { hash: "2222222", subject: "chore: bump deps" },
      { hash: "3333333", subject: "feat: add feature" },
      { hash: "4444444", subject: "fix: patch bug" },
    ],
  };
}

describe("simple changelog rendering", () => {
  it("includes releasable commits and excludes ci/chore", () => {
    const changelog = renderSimpleChangelog(makePlan());
    expect(changelog).toContain("feat: add feature");
    expect(changelog).toContain("fix: patch bug");
    expect(changelog).not.toContain("ci: update workflow");
    expect(changelog).not.toContain("chore: bump deps");
  });
});
