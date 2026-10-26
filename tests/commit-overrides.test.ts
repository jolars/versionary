import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadConfig } from "../src/config/load-config.js";
import { renderReleasePlanChangelog } from "../src/release/changelog.js";
import { createReleasePlan } from "../src/release/plan.js";
import {
  prepareReleasePr,
  prepareSeparateReleasePrs,
} from "../src/release/pr.js";
import type {
  VersionaryCommitOverride,
  VersionaryConfig,
} from "../src/types/config.js";
import { runCli } from "./helpers/cli.js";

const directories: string[] = [];

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function write(cwd: string, file: string, content: string): void {
  const target = path.join(cwd, file);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
}

function commit(
  cwd: string,
  message: string,
  files: Record<string, string> = {},
  body?: string,
): string {
  for (const [file, content] of Object.entries(files)) {
    write(cwd, file, content);
  }
  git(cwd, "add", ".");
  git(
    cwd,
    "commit",
    "--allow-empty",
    "-m",
    message,
    ...(body ? ["-m", body] : []),
  );
  return git(cwd, "rev-parse", "HEAD");
}

function initRepo(config: Partial<VersionaryConfig> = {}): string {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "versionary-overrides-"));
  directories.push(cwd);
  git(cwd, "init", "-b", "main");
  git(cwd, "config", "user.name", "Test User");
  git(cwd, "config", "user.email", "test@example.com");
  write(
    cwd,
    "versionary.jsonc",
    `${JSON.stringify({ version: 1, ...config }, null, 2)}\n`,
  );
  write(cwd, "version.txt", "1.0.0\n");
  for (const packagePath of Object.keys(config.packages ?? {})) {
    write(cwd, path.posix.join(packagePath, "version.txt"), "1.0.0\n");
  }
  commit(cwd, "chore: initial");
  git(cwd, "tag", "v1.0.0");
  return cwd;
}

function configureOverrides(
  cwd: string,
  overrides: Record<string, VersionaryCommitOverride>,
): void {
  const loaded = loadConfig(cwd);
  write(
    cwd,
    path.basename(loaded.path),
    `${JSON.stringify({ ...loaded.config, "commit-overrides": overrides }, null, 2)}\n`,
  );
}

afterEach(() => {
  for (const directory of directories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe("commit exclusions and corrections", () => {
  it("excludes an unreleased fix while retaining its feature and JSONC comments", () => {
    const cwd = initRepo();
    const feature = commit(cwd, "feat: add search", {
      "search.ts": "export const search = 1;\n",
    });
    const fix = commit(cwd, "fix: handle empty search results", {
      "search.ts": "export const search = 2;\n",
    });
    write(
      cwd,
      "versionary.jsonc",
      '{\n  // Keep this explanation.\n  "version": 1,\n}\n',
    );
    const head = git(cwd, "rev-parse", "HEAD");

    expect(
      runCli(
        cwd,
        "exclude",
        fix.slice(0, 7),
        "--reason",
        "Fixes an unreleased regression",
      ),
    ).toContain(fix);
    expect(loadConfig(cwd).config["commit-overrides"]).toEqual({
      [fix]: { skip: true, reason: "Fixes an unreleased regression" },
    });
    expect(
      fs.readFileSync(path.join(cwd, "versionary.jsonc"), "utf8"),
    ).toContain("// Keep this explanation.");
    expect(git(cwd, "rev-parse", "HEAD")).toBe(head);
    expect(git(cwd, "diff", "--name-only")).toBe("versionary.jsonc");

    const plan = JSON.parse(runCli(cwd, "plan"));
    expect(plan.nextVersion).toBe("1.1.0");
    expect(plan.commits.map((entry: { hash: string }) => entry.hash)).toEqual([
      feature,
    ]);
    expect(plan.commitOverrides).toEqual([
      {
        hash: fix,
        originalMessage: "fix: handle empty search results",
        override: { skip: true, reason: "Fixes an unreleased regression" },
        packages: ["."],
      },
    ]);
    expect(runCli(cwd, "changelog")).toContain("add search");
    expect(runCli(cwd, "changelog")).not.toContain(
      "handle empty search results",
    );
    expect(fs.readFileSync(path.join(cwd, "search.ts"), "utf8")).toContain(
      "search = 2",
    );
  });

  it("produces no release when the only releasable commit is excluded", () => {
    const cwd = initRepo();
    const fix = commit(cwd, "fix: repair an unreleased refactor");
    runCli(cwd, "exclude", fix);

    expect(createReleasePlan(cwd).nextVersion).toBeNull();
    expect(JSON.parse(runCli(cwd, "run", "--json", "--dry-run"))).toMatchObject(
      { action: "noop", releaseCreated: false },
    );
    expect(runCli(cwd, "changelog")).toBe("No releasable commits found.");
  });

  it("corrects the type, title, body, and references while preserving the original SHA", () => {
    const cwd = initRepo();
    const feature = commit(
      cwd,
      "feat!: speed up search",
      { "search.ts": "export const search = 1;\n" },
      "BREAKING CHANGE: mistaken breaking marker",
    );
    const message =
      "perf(search): cache lookups\n\nAvoid repeating the lookup.\n\nCloses #23";
    runCli(cwd, "correct", feature.slice(0, 8), "--message", message);

    const plan = createReleasePlan(cwd);
    expect(plan.nextVersion).toBe("1.0.1");
    expect(plan.commits).toMatchObject([
      {
        hash: feature,
        type: "perf",
        scope: "search",
        isBreaking: false,
        references: [{ issue: "23" }],
      },
    ]);
    const notes = renderReleasePlanChangelog(plan, { cwd });
    expect(notes).toContain("### Performance Improvements");
    expect(notes).toContain("cache lookups");
    expect(notes).toContain(feature.slice(0, 7));
    expect(notes).not.toContain("### Features");
    expect(plan.commitOverrides?.[0].originalMessage).toContain("feat!:");
    expect(git(cwd, "show", "-s", "--format=%B", feature)).toContain(
      "BREAKING CHANGE: mistaken breaking marker",
    );
  });

  it("can correct a feature to a chore without forcing a release", () => {
    const cwd = initRepo();
    const feature = commit(cwd, "feat: reorganize fixtures");
    runCli(cwd, "correct", feature, "--message", "chore: reorganize fixtures");
    expect(createReleasePlan(cwd).nextVersion).toBeNull();
  });

  it("does not hide a legitimate feature when another feature is corrected", () => {
    const cwd = initRepo();
    const mistaken = commit(cwd, "feat: speed up lookups");
    commit(cwd, "feat: add search");
    runCli(cwd, "correct", mistaken, "--message", "perf: speed up lookups");
    expect(createReleasePlan(cwd).nextVersion).toBe("1.1.0");
  });

  it("excludes Release-As footers and Other changes fallback entries", () => {
    const cwd = initRepo();
    const skipped = commit(
      cwd,
      "fix!: repair an unreleased regression",
      {},
      "Release-As: invalid",
    );
    configureOverrides(cwd, { [skipped]: { skip: true } });
    commit(cwd, "docs: publish updated documentation", {}, "Release-As: 1.0.1");

    const plan = createReleasePlan(cwd);
    expect(plan.nextVersion).toBe("1.0.1");
    const notes = renderReleasePlanChangelog(plan, { cwd });
    expect(notes).toContain("### Other changes");
    expect(notes).toContain("publish updated documentation");
    expect(notes).not.toContain("repair an unreleased regression");
  });

  it.each(["original", "revert"])(
    "preserves revert suppression when excluding the %s commit",
    (target) => {
      const cwd = initRepo();
      const original = commit(cwd, "feat: add search", {
        "search.ts": "export const search = 1;\n",
      });
      git(cwd, "revert", "--no-commit", original);
      const revert = commit(
        cwd,
        'revert: "feat: add search"',
        {},
        `This reverts commit ${original}.`,
      );
      runCli(cwd, "exclude", target === "original" ? original : revert);

      expect(createReleasePlan(cwd)).toMatchObject({
        releaseType: null,
        nextVersion: null,
        commits: [],
      });
    },
  );

  it.each(["independent", "fixed"] as const)(
    "applies root-stored overrides using original paths in %s monorepos",
    (mode) => {
      const cwd = initRepo({
        "monorepo-mode": mode,
        packages: {
          ...(mode === "fixed" ? { ".": {} } : {}),
          "packages/a": { "release-type": "simple" },
          "packages/b": { "release-type": "simple" },
        },
      });
      const mistaken = commit(cwd, "feat: speed up a", {
        "packages/a/index.ts": "export const a = 1;\n",
      });
      commit(cwd, "fix: repair b", {
        "packages/b/index.ts": "export const b = 1;\n",
      });
      runCli(cwd, "correct", mistaken, "--message", "perf: speed up a");
      commit(cwd, "chore: correct release metadata");

      const plan = createReleasePlan(cwd);
      expect(plan.nextVersion).toBe("1.0.1");
      expect(plan.packages?.every((pkg) => pkg.nextVersion === "1.0.1")).toBe(
        true,
      );
      expect(
        plan.packages?.find((pkg) => pkg.path === "packages/a")?.commits,
      ).toMatchObject([{ hash: mistaken, type: "perf" }]);
      expect(plan.commitOverrides?.[0].packages).toEqual(
        mode === "fixed" ? [".", "packages/a"] : ["packages/a"],
      );
    },
  );

  it("retains shared exclusions until every affected package advances, then prunes during release preparation", () => {
    const cwd = initRepo({
      "separate-release-prs": true,
      packages: {
        "packages/a": { "release-type": "simple" },
        "packages/b": { "release-type": "simple" },
      },
    });
    const shared = commit(cwd, "fix: repair an unreleased regression", {
      "packages/a/index.ts": "a\n",
      "packages/b/index.ts": "b\n",
    });
    runCli(cwd, "exclude", shared);
    commit(cwd, "chore: exclude unreleased fix");
    commit(cwd, "feat: improve a", { "packages/a/feature.ts": "a\n" });
    const [releaseA] = prepareSeparateReleasePrs(cwd);
    git(cwd, "merge", "--ff-only", releaseA.branch);
    git(cwd, "tag", releaseA.targets[0].tag);

    expect(createReleasePlan(cwd).commitOverrides?.[0].packages).toEqual([
      "packages/b",
    ]);
    expect(loadConfig(cwd).config["commit-overrides"]).toHaveProperty(shared);
    commit(cwd, "feat: improve b", { "packages/b/feature.ts": "b\n" });
    const [releaseB] = prepareSeparateReleasePrs(cwd);
    git(cwd, "merge", "--ff-only", releaseB.branch);
    git(cwd, "tag", releaseB.targets[0].tag);
    expect(createReleasePlan(cwd).commitOverrides?.[0].packages).toEqual([]);

    commit(cwd, "feat: improve a again", { "packages/a/feature.ts": "a2\n" });
    const [nextRelease] = prepareSeparateReleasePrs(cwd);
    expect(
      JSON.parse(git(cwd, "show", `${nextRelease.branch}:versionary.jsonc`)),
    ).not.toHaveProperty("commit-overrides");
    expect(loadConfig(cwd).config["commit-overrides"]).toHaveProperty(shared);
  });

  it("prunes consumed corrections in a later unified release without resurrecting the original feature", () => {
    const cwd = initRepo();
    const mistaken = commit(cwd, "feat: speed up search");
    runCli(cwd, "correct", mistaken, "--message", "perf: speed up search");
    commit(cwd, "chore: correct release metadata");
    const first = prepareReleasePr(cwd, { branch: "main" });
    git(cwd, "tag", `v${first.version}`);
    expect(loadConfig(cwd).config["commit-overrides"]).toHaveProperty(mistaken);

    commit(cwd, "fix: repair another bug");
    expect(createReleasePlan(cwd).commitOverrides?.[0].packages).toEqual([]);
    expect(loadConfig(cwd).config["commit-overrides"]).toHaveProperty(mistaken);
    expect(prepareReleasePr(cwd, { branch: "main" }).version).toBe("1.0.2");
    expect(loadConfig(cwd).config).not.toHaveProperty("commit-overrides");
    expect(git(cwd, "status", "--short")).toBe("");
  });

  it("keeps unrelated separate release PRs independent when pruning shared configuration", () => {
    const cwd = initRepo({
      "separate-release-prs": true,
      packages: {
        "packages/a": { "release-type": "simple" },
        "packages/b": { "release-type": "simple" },
      },
    });
    const consumed = git(cwd, "rev-parse", "HEAD");
    configureOverrides(cwd, { [consumed]: { skip: true } });
    commit(cwd, "chore: record past exclusion");
    commit(cwd, "feat: improve a", { "packages/a/index.ts": "a\n" });
    commit(cwd, "feat: improve b", { "packages/b/index.ts": "b\n" });

    const releases = prepareSeparateReleasePrs(cwd);
    expect(releases.map((release) => release.packagePaths)).toEqual([
      ["packages/a"],
      ["packages/b"],
    ]);
    expect(
      JSON.parse(git(cwd, "show", `${releases[0].branch}:versionary.jsonc`)),
    ).not.toHaveProperty("commit-overrides");
    expect(
      JSON.parse(git(cwd, "show", `${releases[1].branch}:versionary.jsonc`))[
        "commit-overrides"
      ],
    ).toHaveProperty(consumed);
    expect(git(cwd, "status", "--short")).toBe("");
  });

  it("edits versionary.json when no JSONC configuration exists", () => {
    const cwd = initRepo();
    fs.renameSync(
      path.join(cwd, "versionary.jsonc"),
      path.join(cwd, "versionary.json"),
    );
    const fix = commit(cwd, "fix: unreleased regression");
    runCli(cwd, "exclude", fix);
    expect(
      JSON.parse(fs.readFileSync(path.join(cwd, "versionary.json"), "utf8"))[
        "commit-overrides"
      ][fix],
    ).toEqual({ skip: true });
    expect(fs.existsSync(path.join(cwd, "versionary.jsonc"))).toBe(false);
  });

  it.each(
    [
      ["exclude"],
      ["exclude", "$released"],
      ["exclude", "deadbeefdeadbeefdeadbeefdeadbeefdeadbeef"],
      ["exclude", "$unreachable"],
      ["exclude", "HEAD"],
      ["exclude", "$fix", "--reason", "   "],
      ["exclude", "$fix", "--unknown"],
      ["correct", "$fix"],
      ["correct", "$fix", "--message", "not conventional"],
    ].map((args) => ({ args })),
  )(
    "rejects invalid command $args without editing configuration",
    ({ args }) => {
      const cwd = initRepo();
      const released = git(cwd, "rev-parse", "HEAD");
      const fix = commit(cwd, "fix: unreleased regression");
      const unreachable = git(
        cwd,
        "commit-tree",
        "HEAD^{tree}",
        "-p",
        "HEAD",
        "-m",
        "fix: on another branch",
      );
      const original = fs.readFileSync(
        path.join(cwd, "versionary.jsonc"),
        "utf8",
      );
      const commits: Record<string, string> = {
        $released: released,
        $fix: fix,
        $unreachable: unreachable,
      };
      expect(() =>
        runCli(cwd, ...args.map((arg) => commits[arg] ?? arg)),
      ).toThrow();
      expect(fs.readFileSync(path.join(cwd, "versionary.jsonc"), "utf8")).toBe(
        original,
      );
    },
  );

  it.each([
    {},
    { skip: false },
    { skip: true, message: "perf: cache lookups" },
    { skip: true, reason: "" },
    { message: "" },
    { message: "not conventional" },
    { message: "fix: repair a bug\n\nBREAKING CHANGE malformed footer" },
    { skip: true, unexpected: true },
  ])("rejects malformed override %j", (override) => {
    const cwd = initRepo();
    write(
      cwd,
      "versionary.jsonc",
      JSON.stringify({
        version: 1,
        "commit-overrides": { ["a".repeat(40)]: override },
      }),
    );
    expect(() => loadConfig(cwd)).toThrow();
  });

  it("rejects abbreviated config keys and unknown configured commits", () => {
    const cwd = initRepo();
    write(
      cwd,
      "versionary.jsonc",
      JSON.stringify({
        version: 1,
        "commit-overrides": { abc1234: { skip: true } },
      }),
    );
    expect(() => loadConfig(cwd)).toThrow(/full.*commit SHA/u);
    write(
      cwd,
      "versionary.jsonc",
      JSON.stringify({
        version: 1,
        "commit-overrides": { ["a".repeat(40)]: { skip: true } },
      }),
    );
    expect(() => createReleasePlan(cwd)).toThrow(/unknown or ambiguous/u);
  });
});
