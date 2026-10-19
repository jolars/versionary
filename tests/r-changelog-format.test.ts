import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { parseConventionalCommitMessage } from "../src/git/commits.js";
import { renderReleasePlanChangelog } from "../src/release/changelog.js";
import type { ReleasePlan } from "../src/release/plan.js";
import { createReleasePlan } from "../src/release/plan.js";
import {
  prepareReleasePr,
  prepareSeparateReleasePrs,
} from "../src/release/pr.js";
import { readReleaseTargets } from "../src/release/state.js";

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

    const plan = createReleasePlan(cwd);
    expect(plan.changelogFile).toBe("NEWS.md");
    expect(plan.changelogFormat).toBe("r-news");
  });

  it("renders r-news with top-level package version headings", () => {
    const plan: ReleasePlan = {
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

    const rendered = renderReleasePlanChangelog(plan);
    expect(rendered).toContain("# versionary 1.2.0");
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

    const result = prepareReleasePr(cwd);
    expect(result.version).toBe("1.2.0");
    const news = fs.readFileSync(path.join(cwd, "NEWS.md"), "utf8");
    expect(news).toContain("# versionary 1.2.0");
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

    prepareReleasePr(cwd);

    const news = fs.readFileSync(path.join(cwd, "NEWS.md"), "utf8");
    expect(news).toMatch(/^# eulerr 7\.0\.5$/mu);
    expect(news).not.toContain("# eulerr (development version)");
    expect(news).toContain("# eulerr 7.0.4");
  });

  describe.each([
    { flow: "combined", separateReleasePrs: false },
    { flow: "separate", separateReleasePrs: true },
  ])("$flow release PRs", ({ separateReleasePrs }) => {
    it.each([
      {
        name: "R package",
        releaseType: "r",
        versionFile: "DESCRIPTION",
        manifest: "Package: datamonger\nVersion: 1.0.0\n",
        expectedPackageName: "datamonger",
      },
      {
        name: "Node package using r-news",
        releaseType: "node",
        versionFile: "package.json",
        manifest: JSON.stringify({ name: "datamonger", version: "1.0.0" }),
        expectedPackageName: "datamonger",
      },
      {
        name: "Python package using r-news",
        releaseType: "python",
        versionFile: "pyproject.toml",
        manifest: '[project]\nname = "datamonger"\nversion = "1.0.0"\n',
        expectedPackageName: "datamonger",
      },
      {
        name: "R package without a Package field",
        releaseType: "r",
        versionFile: "DESCRIPTION",
        manifest: "Version: 1.0.0\n",
        expectedPackageName: "datamonger-client",
      },
      {
        name: "strategy without package name metadata",
        releaseType: "simple",
        versionFile: "version.txt",
        manifest: "1.0.0\n",
        expectedPackageName: "datamonger-client",
      },
    ])(
      "resolves NEWS headings independently from release names for $name",
      ({ releaseType, versionFile, manifest, expectedPackageName }) => {
        const cwd = makeTempDir();
        git(cwd, "init", "-b", "main");
        git(cwd, "config", "user.name", "Test User");
        git(cwd, "config", "user.email", "test@example.com");
        write(
          cwd,
          "versionary.jsonc",
          JSON.stringify({
            version: 1,
            "release-type": "simple",
            "review-mode": "pr",
            "monorepo-mode": "independent",
            "separate-release-prs": separateReleasePrs,
            packages: {
              "packages/client": {
                "release-type": releaseType,
                "package-name": "datamonger-client",
                "changelog-format": releaseType === "r" ? undefined : "r-news",
              },
            },
          }),
        );
        write(cwd, `packages/client/${versionFile}`, manifest);
        write(cwd, "packages/client/feature.txt", "before\n");
        git(cwd, "add", ".");
        git(cwd, "commit", "-m", "chore: initial");
        git(cwd, "tag", "datamonger-client-v1.0.0");
        write(cwd, "packages/client/feature.txt", "after\n");
        git(cwd, "add", ".");
        git(cwd, "commit", "-m", "feat: improve client");

        const prepared = separateReleasePrs
          ? prepareSeparateReleasePrs(cwd)
          : [prepareReleasePr(cwd)];

        expect(prepared).toHaveLength(1);
        const release = prepared[0];
        git(cwd, "checkout", release.branch);
        const news = fs.readFileSync(
          path.join(cwd, "packages/client/NEWS.md"),
          "utf8",
        );
        expect(news.split("\n")[0]).toBe(`# ${expectedPackageName} 1.1.0`);
        expect(readReleaseTargets(cwd)).toEqual([
          {
            path: "packages/client",
            version: "1.1.0",
            tag: "datamonger-client-v1.1.0",
          },
        ]);
        expect(release.title).toBe("chore(release): datamonger-client-v1.1.0");
        if (separateReleasePrs) {
          expect(release.branch).toMatch(
            /^versionary\/release-datamonger-client-/u,
          );
        }
      },
    );
  });
});
