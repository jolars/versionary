import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { parseConventionalCommitMessage } from "../src/git/commits.js";
import { renderSimpleChangelog } from "../src/release/changelog.js";
import type { SimplePlan } from "../src/release/plan.js";
import { createSimplePlan } from "../src/release/plan.js";
import { prepareSimpleReleasePr } from "../src/release/pr.js";

const tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "versionary-r-news-test-"));
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

describe("R changelog support", () => {
  it("defaults release-type r to NEWS.md + r-news format in plan", () => {
    const cwd = makeTempDir();
    git(cwd, "init");
    git(cwd, "config", "user.name", "Test User");
    git(cwd, "config", "user.email", "test@example.com");
    write(
      cwd,
      "DESCRIPTION",
      ["Package: versionary", "Version: 1.1.0", ""].join("\n"),
    );
    write(
      cwd,
      "versionary.jsonc",
      JSON.stringify({
        version: 1,
        "release-type": "r",
        "review-mode": "direct",
      }),
    );
    git(cwd, "add", ".");
    git(cwd, "commit", "-m", "chore: initial");
    git(cwd, "tag", "v1.1.0");

    write(cwd, "R/main.R", "main <- function() {}\n");
    git(cwd, "add", "R/main.R");
    git(cwd, "commit", "-m", "feat: add entrypoint");

    const plan = createSimplePlan(cwd);
    expect(plan.changelogFile).toBe("NEWS.md");
    expect(plan.changelogFormat).toBe("r-news");
  });

  it("renders r-news with top-level package version headings", () => {
    const plan: SimplePlan = {
      mode: "simple",
      releaseType: "minor",
      currentVersion: "1.1.0",
      nextVersion: "1.2.0",
      packageName: "versionary",
      versionFile: "DESCRIPTION",
      changelogFile: "NEWS.md",
      changelogFormat: "r-news",
      releaseBranchPrefix: "versionary/release",
      baselineSha: null,
      commits: [
        {
          ...parseConventionalCommitMessage("feat: add package support"),
          hash: "1111111",
        },
        {
          ...parseConventionalCommitMessage("fix: patch edge case"),
          hash: "2222222",
        },
      ],
    };

    const rendered = renderSimpleChangelog(plan);
    expect(rendered).toContain("# versionary 1.2");
    expect(rendered).toContain("## Features");
    expect(rendered).toContain("## Bug fixes");
  });

  it("writes NEWS.md in PR preparation for release-type r", () => {
    const cwd = makeTempDir();
    git(cwd, "init");
    git(cwd, "config", "user.name", "Test User");
    git(cwd, "config", "user.email", "test@example.com");
    write(
      cwd,
      "DESCRIPTION",
      ["Package: versionary", "Type: Package", "Version: 1.1.0", ""].join("\n"),
    );
    write(cwd, "NEWS.md", "# versionary 1.1\n\n## Features\n\n- bootstrap\n");
    write(
      cwd,
      "versionary.jsonc",
      JSON.stringify({
        version: 1,
        "release-type": "r",
        "review-mode": "direct",
      }),
    );
    git(cwd, "add", ".");
    git(cwd, "commit", "-m", "chore: initial");
    git(cwd, "tag", "v1.1.0");

    write(cwd, "R/new-feature.R", "new_feature <- function() TRUE\n");
    git(cwd, "add", "R/new-feature.R");
    git(cwd, "commit", "-m", "feat: add exported helper");

    const result = prepareSimpleReleasePr(cwd);
    expect(result.version).toBe("1.2.0");
    const news = fs.readFileSync(path.join(cwd, "NEWS.md"), "utf8");
    expect(news).toContain("# versionary 1.2");
    expect(news).toContain("## Features");
    expect(news).toContain("add exported helper");
  });

  it("drops development version header when prepending r-news release entry", () => {
    const cwd = makeTempDir();
    git(cwd, "init");
    git(cwd, "config", "user.name", "Test User");
    git(cwd, "config", "user.email", "test@example.com");
    write(
      cwd,
      "DESCRIPTION",
      ["Package: eulerr", "Type: Package", "Version: 7.0.4.9000", ""].join(
        "\n",
      ),
    );
    write(
      cwd,
      "NEWS.md",
      [
        "# eulerr (development version)",
        "",
        "# eulerr 7.0.4",
        "",
        "## Bug Fixes",
        "",
        "- Existing entry.",
        "",
      ].join("\n"),
    );
    write(
      cwd,
      "versionary.jsonc",
      JSON.stringify({
        version: 1,
        "release-type": "r",
        "review-mode": "direct",
      }),
    );
    git(cwd, "add", ".");
    git(cwd, "commit", "-m", "chore: initial");
    git(cwd, "tag", "v7.0.4");

    write(cwd, "R/fix.R", "fix <- function() TRUE\n");
    git(cwd, "add", "R/fix.R");
    git(cwd, "commit", "-m", "fix: patch docs");

    prepareSimpleReleasePr(cwd);

    const news = fs.readFileSync(path.join(cwd, "NEWS.md"), "utf8");
    expect(news).toContain("# eulerr 7.0");
    expect(news).not.toContain("# eulerr (development version)");
    expect(news).toContain("# eulerr 7.0.4");
  });
});
