import { describe, expect, it } from "vitest";
import {
  buildInitialReleaseCohorts,
  resolveSeparateReleaseBranch,
  stabilizeReleaseCohorts,
} from "../src/release/cohorts.js";
import type { ReleasePlan } from "../src/release/plan.js";

function plan(packages: NonNullable<ReleasePlan["packages"]>): ReleasePlan {
  return {
    mode: "simple",
    releaseType: "minor",
    currentVersion: "1.0.0",
    nextVersion: "1.1.0",
    packageName: "demo",
    versionFile: "version.txt",
    changelogFile: "CHANGELOG.md",
    changelogFormat: "markdown-changelog",
    releaseBranchPrefix: "versionary/release",
    baselineSha: null,
    commits: [],
    packages,
  };
}

describe("separate release cohorts", () => {
  it("keeps unrelated package releases separate", () => {
    const cohorts = buildInitialReleaseCohorts(
      plan([
        {
          path: "packages/a",
          releaseType: "minor",
          currentVersion: "1.0.0",
          nextVersion: "1.1.0",
          commits: [],
        },
        {
          path: "packages/b",
          releaseType: "patch",
          currentVersion: "2.0.0",
          nextVersion: "2.0.1",
          commits: [],
        },
      ]),
    );

    expect(cohorts).toEqual([["packages/a"], ["packages/b"]]);
  });

  it("groups packages connected by release dependencies", () => {
    const cohorts = buildInitialReleaseCohorts(
      plan([
        {
          path: "packages/a",
          releaseType: "minor",
          currentVersion: "1.0.0",
          nextVersion: "1.1.0",
          commits: [],
        },
        {
          path: "packages/b",
          releaseType: "patch",
          currentVersion: "2.0.0",
          nextVersion: "2.0.1",
          dependencySourcePaths: ["packages/a"],
          commits: [],
        },
      ]),
    );

    expect(cohorts).toEqual([["packages/a", "packages/b"]]);
  });

  it("merges cohorts whose generated files overlap until stable", () => {
    const footprints = new Map([
      ["packages/a", ["packages/a/package.json", "pnpm-lock.yaml"]],
      ["packages/b", ["packages/b/package.json", "pnpm-lock.yaml"]],
      ["packages/c", ["packages/c/package.json"]],
    ]);

    const cohorts = stabilizeReleaseCohorts(
      [["packages/a"], ["packages/b"], ["packages/c"]],
      (packagePaths) =>
        packagePaths.flatMap(
          (packagePath) => footprints.get(packagePath) ?? [],
        ),
    );

    expect(cohorts).toEqual([["packages/a", "packages/b"], ["packages/c"]]);
  });

  it("builds readable collision-resistant package branches", () => {
    const first = resolveSeparateReleaseBranch(
      "versionary/release/",
      "@scope/pkg",
      "packages/a",
    );
    const second = resolveSeparateReleaseBranch(
      "versionary/release",
      "@scope/pkg",
      "packages/b",
    );

    expect(first).toMatch(/^versionary\/release-scope-pkg-[0-9a-f]{12}$/u);
    expect(second).toMatch(/^versionary\/release-scope-pkg-[0-9a-f]{12}$/u);
    expect(first).not.toBe(second);
    // Siblings, not children: `refs/heads/versionary/release` and
    // `refs/heads/versionary/release/<name>` cannot coexist.
    expect(first.startsWith("versionary/release/")).toBe(false);
  });
});
