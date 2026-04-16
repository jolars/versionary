#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import {
  isReleaseCommitMessage,
  openOrUpdateSimpleReviewRequest,
  prepareSimpleReleasePr,
  pushReleaseBranch,
} from "../app/release/pr.js";
import {
  runSimpleRelease,
  runSimpleReleaseDetailed,
} from "../app/release/release.js";
import { verifyProject } from "../app/release/verify.js";
import { renderSimpleChangelog } from "../domain/release/changelog.js";
import { createSimplePlan } from "../domain/release/plan.js";

function printVerifyResult(): number {
  const result = verifyProject();

  for (const check of result.checks) {
    const status = check.ok ? "OK" : "FAIL";
    console.log(`[${status}] ${check.name} - ${check.details}`);
  }

  return result.ok ? 0 : 1;
}

interface CliFlags {
  json: boolean;
}

interface RunJsonResult {
  action: "noop" | "pr-prepared" | "release-skipped" | "release-published";
  message: string;
  releaseCreated: boolean;
  tagNames: string[];
  reviewUrl?: string;
  branch?: string;
  title?: string;
}

function parseFlags(args: string[]): CliFlags {
  return {
    json: args.includes("--json"),
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
      if (flags.json) {
        const release = await runSimpleReleaseDetailed(process.cwd(), {
          logger,
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
        emitJson({
          action: "release-published",
          message: release.message,
          releaseCreated: release.releases.length > 0,
          tagNames: release.releases.map((target) => target.tag),
        });
        return 0;
      }
      const message = await runSimpleRelease(process.cwd());
      console.log(message);
      return 0;
    }

    const plan = createSimplePlan();
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

    const pr = prepareSimpleReleasePr(process.cwd(), { logger });
    pushReleaseBranch(process.cwd(), pr.branch);
    const reviewResult = await openOrUpdateSimpleReviewRequest(
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
    const plan = createSimplePlan();
    console.log(JSON.stringify(plan, null, 2));
    return 0;
  }

  if (command === "changelog") {
    const write = args.includes("--write");
    const plan = createSimplePlan();
    if (!plan.nextVersion) {
      console.log("No releasable commits found.");
      return 0;
    }

    const section = renderSimpleChangelog(plan);
    if (!write) {
      console.log(section);
      return 0;
    }

    const changelogPath = path.join(process.cwd(), plan.changelogFile);
    const existing = fs.existsSync(changelogPath)
      ? fs.readFileSync(changelogPath, "utf8")
      : "";
    const heading = "# Changelog\n\n";
    const body = existing.replace(/^# Changelog\s*/u, "");
    fs.writeFileSync(
      changelogPath,
      `${`${heading}${section}\n${body}`.trimEnd()}\n`,
      "utf8",
    );
    console.log(`Updated ${plan.changelogFile}`);
    return 0;
  }

  if (command === "pr") {
    const pr = prepareSimpleReleasePr(process.cwd(), { logger: console });
    pushReleaseBranch(process.cwd(), pr.branch);
    const reviewResult = await openOrUpdateSimpleReviewRequest(
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
    const message = await runSimpleRelease(process.cwd());
    console.log(message);
    return 0;
  }

  console.log("Usage: versionary <command>");
  console.log("Commands:");
  console.log(
    "  run [--json]  Auto-dispatch release PR/update or release publish by context",
  );
  console.log("  verify  Validate config and basic repository shape");
  console.log("  plan    Print release plan (simple mode)");
  console.log("  changelog [--write]  Print or write changelog section");
  console.log("  pr      Prepare release PR commit and branch");
  console.log("  release Publish release metadata for release commit context");
  return 1;
}

main()
  .then((code) => process.exit(code))
  .catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    process.exit(1);
  });
