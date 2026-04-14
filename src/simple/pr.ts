import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createSimplePlan } from "./plan.js";
import { prependChangelog, renderSimpleChangelog } from "./changelog.js";

function ensureCleanWorktree(cwd: string): void {
  const status = execFileSync("git", ["status", "--porcelain"], {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  }).trim();

  if (status.length > 0) {
    throw new Error("Working tree is not clean. Commit or stash changes before `versionary pr`.");
  }
}

export function prepareSimpleReleasePr(cwd = process.cwd()): {
  branch: string;
  title: string;
  version: string;
} {
  const plan = createSimplePlan(cwd);
  if (!plan.nextVersion) {
    throw new Error("No releasable commits found. Nothing to open a release PR for.");
  }

  ensureCleanWorktree(cwd);

  const versionPath = path.join(cwd, plan.versionFile);
  fs.writeFileSync(versionPath, `${plan.nextVersion}\n`, "utf8");
  const section = renderSimpleChangelog(plan);
  prependChangelog(cwd, plan.changelogFile, section);

  const branch = plan.releaseBranchPrefix;
  const title = `chore(release): v${plan.nextVersion}`;

  execFileSync("git", ["checkout", "-B", branch], { cwd, stdio: ["ignore", "pipe", "ignore"] });
  execFileSync("git", ["add", plan.versionFile, plan.changelogFile], {
    cwd,
    stdio: ["ignore", "pipe", "ignore"],
  });
  execFileSync("git", ["commit", "-m", title], { cwd, stdio: ["ignore", "pipe", "ignore"] });

  return {
    branch,
    title,
    version: plan.nextVersion,
  };
}
