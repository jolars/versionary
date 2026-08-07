import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { parseConventionalCommitMessage } from "../src/git/commits.js";
import {
  extractUnreleasedNotes,
  renderReleasePlanChangelog,
  renderRNewsReleaseNotes,
} from "../src/release/changelog.js";
import type { ReleasePlan } from "../src/release/plan.js";
import { prepareReleasePr } from "../src/release/pr.js";
import { isVersionHeading } from "../src/release/semver.js";

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

function makePlan(): ReleasePlan {
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
    const baseline = renderReleasePlanChangelog(plan);
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

describe("isVersionHeading", () => {
  it.each([
    "## [0.28.2](https://example.com/compare/v0.28.1...v0.28.2) (2026-06-02)",
    "## 1.2.3",
    "## v1.2.3",
    "## 0.28.2.9000",
    "# demo 1.0.0",
    "# eulerr 8.0",
    "# eulerr 7.1",
    "# pkg v2.0",
  ])("recognizes %s as a version heading", (heading) => {
    expect(isVersionHeading(heading)).toBe(true);
  });

  it.each([
    "## Unreleased",
    "## Upcoming",
    "## [Unreleased]",
    "# demo (development version)",
    "## Notes for 2.0 milestone",
  ])("treats %s as a notes heading", (heading) => {
    expect(isVersionHeading(heading)).toBe(false);
  });

  it("does not misread an ISO date as a version", () => {
    expect(isVersionHeading("## Released on 2026-06-02")).toBe(false);
  });
});

describe("extractUnreleasedNotes", () => {
  it("captures prose under an Unreleased heading and removes the block", () => {
    const existing = [
      "# Changelog",
      "",
      "## Unreleased",
      "",
      "Big things this release.",
      "",
      "- One",
      "",
      "## [0.1.0](https://example.com) (2026-01-01)",
      "",
      "### Features",
      "- old ([`abc1234`](https://example.com))",
      "",
    ].join("\n");

    const { highlights, body } = extractUnreleasedNotes(existing);
    expect(highlights).toBe("Big things this release.\n\n- One");
    expect(body).not.toContain("## Unreleased");
    expect(body).not.toContain("Big things this release.");
    expect(body).toContain("## [0.1.0]");
  });

  it("accepts any heading text for the notes block", () => {
    const existing =
      "# Changelog\n\n## Upcoming\n\nWords.\n\n## 1.0.0\n\nold\n";
    expect(extractUnreleasedNotes(existing).highlights).toBe("Words.");
  });

  it("does nothing when the first heading is already a version (steady state)", () => {
    const existing = "# Changelog\n\n## 1.0.0\n\n### Features\n- a\n";
    const { highlights, body } = extractUnreleasedNotes(existing);
    expect(highlights).toBe("");
    expect(body).toBe(existing);
  });

  it("ignores a non-version heading that appears after a version", () => {
    const existing =
      "# Changelog\n\n## 1.0.0\n\n### Features\n- a\n\n## Acknowledgements\n\nThanks.\n";
    const { highlights, body } = extractUnreleasedNotes(existing);
    expect(highlights).toBe("");
    expect(body).toBe(existing);
  });

  it("handles a first-ever release with no prior version below", () => {
    const existing = "# Changelog\n\n## Unreleased\n\nFirst notes.\n";
    const { highlights, body } = extractUnreleasedNotes(existing);
    expect(highlights).toBe("First notes.");
    expect(body).not.toContain("Unreleased");
  });

  it("captures the r-news development-version body", () => {
    const existing =
      "# demo (development version)\n\n* Did a thing\n\n# demo 1.0.0\n\n* old\n";
    const { highlights, body } = extractUnreleasedNotes(existing, "r-news");
    expect(highlights).toBe("* Did a thing");
    expect(body).not.toContain("development version");
    expect(body).toContain("# demo 1.0.0");
  });

  it("stops at a two-component r-news version heading (eulerr regression)", () => {
    const existing = [
      "# eulerr (development version)",
      "",
      "# eulerr 8.0",
      "",
      "A major milestone.",
      "",
      "## Features",
      "- a thing",
      "",
      "# eulerr 7.1",
      "",
      "## Features",
      "- older thing",
      "",
      "# eulerr 7.0.4",
      "",
      "## Bug Fixes",
      "- a fix",
      "",
    ].join("\n");
    const { highlights, body } = extractUnreleasedNotes(existing, "r-news");
    // The empty development-version block yields no highlights; the released
    // 8.0 and 7.1 sections must not be swallowed.
    expect(highlights).toBe("");
    expect(body).toContain("# eulerr 8.0");
    expect(body).toContain("# eulerr 7.1");
    expect(body).toContain("A major milestone.");
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

  it("returns empty highlights when the changelog has no Unreleased section", () => {
    const cwd = setupRepo();
    git(cwd, "add", ".");
    git(cwd, "commit", "-m", "chore: initial");
    git(cwd, "tag", "v1.0.0");

    write(cwd, "src/index.ts", "export const value = 1;\n");
    git(cwd, "add", "src/index.ts");
    git(cwd, "commit", "-m", "feat: add value");

    const result = prepareReleasePr(cwd);
    expect(result.highlights).toBe("");
    const changelog = fs.readFileSync(path.join(cwd, "CHANGELOG.md"), "utf8");
    expect(changelog).toContain("### Features");
    expect(changelog).toContain("# Changelog");
  });

  it("reads highlights from an Unreleased section and strips the block", () => {
    const cwd = setupRepo();
    write(
      cwd,
      "CHANGELOG.md",
      "# Changelog\n\n## Unreleased\n\nBig release.\n\n- shiny item\n",
    );
    git(cwd, "add", ".");
    git(cwd, "commit", "-m", "chore: initial");
    git(cwd, "tag", "v1.0.0");

    write(cwd, "src/index.ts", "export const value = 1;\n");
    git(cwd, "add", "src/index.ts");
    git(cwd, "commit", "-m", "feat: add value");

    const result = prepareReleasePr(cwd);
    expect(result.version).toBe("1.1.0");
    expect(result.highlights).toBe("Big release.\n\n- shiny item");

    const changelog = fs.readFileSync(path.join(cwd, "CHANGELOG.md"), "utf8");
    // Prose appears exactly once, folded into the new version section.
    expect(changelog.match(/Big release\./gu)?.length).toBe(1);
    expect(changelog).not.toContain("## Unreleased");
    const highlightsIdx = changelog.indexOf("Big release.");
    const featuresIdx = changelog.indexOf("### Features");
    expect(highlightsIdx).toBeGreaterThan(0);
    expect(featuresIdx).toBeGreaterThan(highlightsIdx);
  });
});
