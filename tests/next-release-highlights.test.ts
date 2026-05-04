import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { parseConventionalCommitMessage } from "../src/git/commits.js";
import {
  renderReleasePlanChangelog,
  renderRNewsReleaseNotes,
  renderSimpleChangelog,
} from "../src/release/changelog.js";
import type { SimplePlan } from "../src/release/plan.js";
import { prepareSimpleReleasePr } from "../src/release/pr.js";

const tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = fs.mkdtempSync(
    path.join(os.tmpdir(), "versionary-next-release-test-"),
  );
  tempDirs.push(dir);
  return dir;
}

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  }).trim();
}

function write(cwd: string, relative: string, content: string): void {
  const target = path.join(cwd, relative);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content, "utf8");
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
});

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
        ...parseConventionalCommitMessage("feat: add feature"),
        hash: "3333333",
      },
      {
        ...parseConventionalCommitMessage("fix: patch bug"),
        hash: "4444444",
      },
    ],
  };
}

describe("next-release highlights rendering", () => {
  it("inserts highlights between header and first section in markdown", () => {
    const plan = makePlan();
    const baseline = renderSimpleChangelog(plan);
    expect(baseline).not.toContain("Big things this release");

    const withHighlights = renderReleasePlanChangelog(plan, {
      highlights: "## Highlights\n\nBig things this release.",
    });

    const headerIdx = withHighlights.search(/## (?:\[0\.2\.0\]|0\.2\.0)/u);
    const highlightsIdx = withHighlights.indexOf("Big things this release");
    const featuresIdx = withHighlights.indexOf("### Features");
    expect(headerIdx).toBeGreaterThanOrEqual(0);
    expect(highlightsIdx).toBeGreaterThan(headerIdx);
    expect(featuresIdx).toBeGreaterThan(highlightsIdx);
  });

  it("treats empty highlights as absent", () => {
    const plan = makePlan();
    const rendered = renderReleasePlanChangelog(plan, {
      highlights: "   \n\n  ",
    });
    expect(rendered).not.toContain("Highlights");
    expect(rendered).toMatch(
      /## (?:\[0\.2\.0\][^\n]*|0\.2\.0[^\n]*)\n\n### Features/u,
    );
  });

  it("inserts highlights in r-news output", () => {
    const rendered = renderRNewsReleaseNotes({
      packageName: "demo",
      nextVersion: "0.2.0",
      commits: [
        {
          ...parseConventionalCommitMessage("feat: add feature"),
          hash: "abc1234",
        },
      ],
      highlights: "Notable: rewrote the engine.",
    });
    const headerIdx = rendered.indexOf("# demo 0.2");
    const highlightsIdx = rendered.indexOf("Notable: rewrote the engine.");
    const featuresIdx = rendered.indexOf("## Features");
    expect(headerIdx).toBeGreaterThanOrEqual(0);
    expect(highlightsIdx).toBeGreaterThan(headerIdx);
    expect(featuresIdx).toBeGreaterThan(highlightsIdx);
  });
});

describe("prepareReleasePr highlights consumption", () => {
  function setupRepo(): string {
    const cwd = makeTempDir();
    git(cwd, "init");
    git(cwd, "config", "user.name", "Test User");
    git(cwd, "config", "user.email", "test@example.com");
    write(cwd, "version.txt", "1.0.0\n");
    write(cwd, "CHANGELOG.md", "# Changelog\n\n");
    write(
      cwd,
      "versionary.jsonc",
      JSON.stringify({
        version: 1,
        "review-mode": "direct",
        "version-file": "version.txt",
        "changelog-file": "CHANGELOG.md",
      }),
    );
    return cwd;
  }

  it("prepends highlights to changelog and deletes tracked NEXT_RELEASE.md", () => {
    const cwd = setupRepo();
    write(cwd, "NEXT_RELEASE.md", "## Highlights\n\nMajor refactor.\n");
    git(cwd, "add", ".");
    git(cwd, "commit", "-m", "chore: initial");
    git(cwd, "tag", "v1.0.0");

    write(cwd, "src/index.ts", "export const value = 1;\n");
    git(cwd, "add", "src/index.ts");
    git(cwd, "commit", "-m", "feat: add value");

    const result = prepareSimpleReleasePr(cwd);
    expect(result.version).toBe("1.1.0");
    expect(result.highlights).toBe("## Highlights\n\nMajor refactor.");

    const changelog = fs.readFileSync(path.join(cwd, "CHANGELOG.md"), "utf8");
    expect(changelog).toContain("Major refactor.");
    const highlightsIdx = changelog.indexOf("Major refactor.");
    const featuresIdx = changelog.indexOf("### Features");
    expect(highlightsIdx).toBeGreaterThan(0);
    expect(featuresIdx).toBeGreaterThan(highlightsIdx);

    expect(fs.existsSync(path.join(cwd, "NEXT_RELEASE.md"))).toBe(false);

    // Tracked file deletion should be staged in the release commit.
    const showOutput = git(cwd, "show", "--name-status", "--pretty=", "HEAD");
    expect(showOutput).toMatch(/^D\s+NEXT_RELEASE\.md$/mu);
  });

  it("handles untracked NEXT_RELEASE.md by deleting locally without staging", () => {
    const cwd = setupRepo();
    git(cwd, "add", ".");
    git(cwd, "commit", "-m", "chore: initial");
    git(cwd, "tag", "v1.0.0");

    write(cwd, "src/index.ts", "export const value = 1;\n");
    git(cwd, "add", "src/index.ts");
    git(cwd, "commit", "-m", "feat: add value");

    write(cwd, "NEXT_RELEASE.md", "Untracked highlights here.\n");

    const result = prepareSimpleReleasePr(cwd);
    expect(result.version).toBe("1.1.0");
    expect(result.highlights).toBe("Untracked highlights here.");

    const changelog = fs.readFileSync(path.join(cwd, "CHANGELOG.md"), "utf8");
    expect(changelog).toContain("Untracked highlights here.");
    expect(fs.existsSync(path.join(cwd, "NEXT_RELEASE.md"))).toBe(false);

    const showOutput = git(cwd, "show", "--name-status", "--pretty=", "HEAD");
    expect(showOutput).not.toMatch(/NEXT_RELEASE\.md/u);
  });

  it("returns empty highlights when no NEXT_RELEASE.md exists", () => {
    const cwd = setupRepo();
    git(cwd, "add", ".");
    git(cwd, "commit", "-m", "chore: initial");
    git(cwd, "tag", "v1.0.0");

    write(cwd, "src/index.ts", "export const value = 1;\n");
    git(cwd, "add", "src/index.ts");
    git(cwd, "commit", "-m", "feat: add value");

    const result = prepareSimpleReleasePr(cwd);
    expect(result.highlights).toBe("");
    const changelog = fs.readFileSync(path.join(cwd, "CHANGELOG.md"), "utf8");
    expect(changelog).toContain("### Features");
    expect(changelog).toContain("# Changelog");
  });

  it("respects custom next-release-file config", () => {
    const cwd = setupRepo();
    write(
      cwd,
      "versionary.jsonc",
      JSON.stringify({
        version: 1,
        "review-mode": "direct",
        "version-file": "version.txt",
        "changelog-file": "CHANGELOG.md",
        "next-release-file": "RELEASE_DRAFT.md",
      }),
    );
    write(cwd, "RELEASE_DRAFT.md", "Custom path highlights.\n");
    git(cwd, "add", ".");
    git(cwd, "commit", "-m", "chore: initial");
    git(cwd, "tag", "v1.0.0");

    write(cwd, "src/index.ts", "export const value = 1;\n");
    git(cwd, "add", "src/index.ts");
    git(cwd, "commit", "-m", "feat: add value");

    const result = prepareSimpleReleasePr(cwd);
    expect(result.highlights).toBe("Custom path highlights.");
    expect(fs.existsSync(path.join(cwd, "RELEASE_DRAFT.md"))).toBe(false);
    const showOutput = git(cwd, "show", "--name-status", "--pretty=", "HEAD");
    expect(showOutput).toMatch(/^D\s+RELEASE_DRAFT\.md$/mu);
  });
});
