#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import {
  prependChangelog,
  renderReleasePlanChangelog,
} from "../release/changelog.js";
import { createReleasePlan } from "../release/plan.js";
import {
  isReleaseCommitMessage,
  openOrUpdateReviewRequest,
  prepareReleasePr,
  pushReleaseBranch,
} from "../release/pr.js";
import { runRelease, runReleaseDetailed } from "../release/release.js";
import { verifyProject } from "../release/verify-project.js";

function printVerifyResult(): number {
  const result = verifyProject();
  const categories: Array<{
    key: "config" | "paths" | "version-files";
    title: string;
  }> = [
    { key: "config", title: "Config" },
    { key: "paths", title: "Paths" },
    { key: "version-files", title: "Version files" },
  ];

  for (const category of categories) {
    const checks = result.checks.filter(
      (check) => check.category === category.key,
    );
    if (checks.length === 0) {
      continue;
    }
    console.log(`${category.title}:`);
    for (const check of checks) {
      const status = check.ok ? "OK" : "FAIL";
      console.log(`  [${status}] ${check.name} - ${check.details}`);
      if (!check.ok && check.remediation) {
        console.log(`         Fix: ${check.remediation}`);
      }
    }
    console.log("");
  }

  console.log(
    result.ok ? "Summary: all checks passed." : "Summary: checks failed.",
  );
  return result.ok ? 0 : 1;
}

interface CliFlags {
  json: boolean;
  "dry-run": boolean;
}

interface RunJsonResult {
  action:
    | "noop"
    | "pr-prepared"
    | "pr-up-to-date"
    | "pr-dry-run"
    | "release-skipped"
    | "release-dry-run"
    | "release-published";
  message: string;
  releaseCreated: boolean;
  tagNames: string[];
  reviewUrl?: string;
  branch?: string;
  title?: string;
  targets?: {
    tag: string;
    version: string;
  }[];
}

function parseFlags(args: string[]): CliFlags {
  return {
    json: args.includes("--json"),
    "dry-run": args.includes("--dry-run"),
  };
}

function emitJson(payload: RunJsonResult): void {
  process.stdout.write(`${JSON.stringify(payload)}\n`);
}

async function main(): Promise<number> {
  const [, , command, ...args] = process.argv;
  const flags = parseFlags(args);
  const logger = flags.json ? undefined : console;
  if (!command || command === "run") {
    const commitMessage = execFileSync("git", ["log", "-1", "--pretty=%B"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();

    if (isReleaseCommitMessage(commitMessage)) {
      if (flags["dry-run"] && !flags.json) {
        const release = await runReleaseDetailed(process.cwd(), {
          logger,
          "dry-run": true,
        });
        if (release.action === "release-dry-run") {
          console.log(release.message);
          return 0;
        }
      }
      if (flags.json) {
        const release = await runReleaseDetailed(process.cwd(), {
          logger,
          "dry-run": flags["dry-run"],
        });
        if (release.action === "release-skipped") {
          emitJson({
            action: "release-skipped",
            message: release.reason,
            releaseCreated: false,
            tagNames: [],
          });
          return 0;
        }
        if (release.action === "release-dry-run") {
          emitJson({
            action: "release-dry-run",
            message: release.message,
            releaseCreated: false,
            tagNames: release.targets.map((target) => target.tag),
            targets: release.targets,
          });
          return 0;
        }
        emitJson({
          action: "release-published",
          message: release.message,
          releaseCreated: release.releases.length > 0,
          tagNames: release.releases.map((target) => target.tag),
        });
        return 0;
      }
      const message = await runRelease(process.cwd());
      console.log(message);
      return 0;
    }

    const plan = createReleasePlan();
    if (!plan.nextVersion) {
      const message = "No releasable commits found. Nothing to do.";
      if (flags.json) {
        emitJson({
          action: "noop",
          message,
          releaseCreated: false,
          tagNames: [],
        });
        return 0;
      }
      console.log(message);
      return 0;
    }

    if (flags["dry-run"]) {
      const dryRunMessage = `Dry run: would prepare release PR branch ${plan.releaseBranchPrefix} for ${plan.nextVersion}`;
      if (flags.json) {
        emitJson({
          action: "pr-dry-run",
          message: dryRunMessage,
          releaseCreated: false,
          tagNames: [],
          branch: plan.releaseBranchPrefix,
          targets: plan.packages
            ?.filter((pkg) => pkg.nextVersion)
            .map((pkg) => ({
              tag:
                pkg.path === "."
                  ? `v${pkg.nextVersion ?? ""}`
                  : `${pkg.path}-v${pkg.nextVersion ?? ""}`,
              version: pkg.nextVersion ?? "",
            })) ?? [
            {
              tag: `v${plan.nextVersion}`,
              version: plan.nextVersion,
            },
          ],
        });
        return 0;
      }
      console.log(dryRunMessage);
      return 0;
    }

    const pr = prepareReleasePr(process.cwd(), { logger });
    if (!pr.updated) {
      const message = `Release PR branch ${pr.branch} is already up to date.`;
      if (flags.json) {
        emitJson({
          action: "pr-up-to-date",
          message,
          releaseCreated: false,
          tagNames: [],
          branch: pr.branch,
          title: pr.title,
        });
        return 0;
      }
      console.log(message);
      console.log(`Title: ${pr.title}`);
      return 0;
    }
    pushReleaseBranch(process.cwd(), pr.branch);
    const reviewResult = await openOrUpdateReviewRequest(
      process.cwd(),
      pr.branch,
      pr.title,
      pr.version,
      pr.previousVersion,
      pr.commits,
      pr.plan,
      { logger },
    );
    const message = `Prepared release PR branch ${pr.branch}`;
    if (flags.json) {
      emitJson({
        action: "pr-prepared",
        message,
        releaseCreated: false,
        tagNames: [],
        reviewUrl: reviewResult,
        branch: pr.branch,
        title: pr.title,
      });
      return 0;
    }
    console.log(message);
    console.log(`Title: ${pr.title}`);
    console.log(reviewResult);
    return 0;
  }

  if (command === "verify") {
    return printVerifyResult();
  }

  if (command === "plan") {
    const plan = createReleasePlan();
    console.log(JSON.stringify(plan, null, 2));
    return 0;
  }

  if (command === "changelog") {
    const write = args.includes("--write");
    const plan = createReleasePlan();
    if (!plan.nextVersion) {
      console.log("No releasable commits found.");
      return 0;
    }

    const section = renderReleasePlanChangelog(plan);
    if (!write) {
      console.log(section);
      return 0;
    }

    prependChangelog(
      process.cwd(),
      plan.changelogFile,
      section,
      plan.changelogFormat,
    );
    console.log(`Updated ${plan.changelogFile}`);
    return 0;
  }

  if (command === "pr") {
    if (flags["dry-run"]) {
      const plan = createReleasePlan();
      if (!plan.nextVersion) {
        console.log("No releasable commits found. Nothing to do.");
        return 0;
      }
      console.log(
        `Dry run: would prepare release PR branch ${plan.releaseBranchPrefix} for ${plan.nextVersion}`,
      );
      return 0;
    }
    const pr = prepareReleasePr(process.cwd(), { logger: console });
    if (!pr.updated) {
      console.log(`Release PR branch ${pr.branch} is already up to date.`);
      console.log(`Title: ${pr.title}`);
      return 0;
    }
    pushReleaseBranch(process.cwd(), pr.branch);
    const reviewResult = await openOrUpdateReviewRequest(
      process.cwd(),
      pr.branch,
      pr.title,
      pr.version,
      pr.previousVersion,
      pr.commits,
      pr.plan,
    );
    console.log(`Prepared release PR branch ${pr.branch}`);
    console.log(`Title: ${pr.title}`);
    console.log(reviewResult);
    return 0;
  }

  if (command === "release") {
    if (flags["dry-run"]) {
      const result = await runReleaseDetailed(process.cwd(), {
        logger,
        "dry-run": true,
      });
      if (result.action === "release-dry-run") {
        console.log(result.message);
      } else if (result.action === "release-skipped") {
        console.log(result.reason);
      } else {
        console.log(result.message);
      }
      return 0;
    }
    const message = await runRelease(process.cwd());
    console.log(message);
    return 0;
  }

  console.log("Usage: versionary <command>");
  console.log("Commands:");
  console.log(
    "  run [--json] [--dry-run]  Auto-dispatch release PR/update or release publish by context",
  );
  console.log("  verify  Validate config and basic repository shape");
  console.log("  plan    Print release plan");
  console.log("  changelog [--write]  Print or write changelog section");
  console.log("  pr [--dry-run]      Prepare release PR commit and branch");
  console.log(
    "  release [--dry-run] Publish release metadata for release commit context",
  );
  return 1;
}

main()
  .then((code) => process.exit(code))
  .catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    process.exit(1);
  });
