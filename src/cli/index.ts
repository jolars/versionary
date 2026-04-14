#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { createSimplePlan } from "../simple/plan.js";
import { renderSimpleChangelog } from "../simple/changelog.js";
import { prepareSimpleReleasePr } from "../simple/pr.js";
import { verifyProject } from "../verify/verify-project.js";

function printVerifyResult(): number {
  const result = verifyProject();

  for (const check of result.checks) {
    const status = check.ok ? "OK" : "FAIL";
    console.log(`[${status}] ${check.name} - ${check.details}`);
  }

  return result.ok ? 0 : 1;
}

function main(): number {
  const [, , command, ...args] = process.argv;
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
    const existing = fs.existsSync(changelogPath) ? fs.readFileSync(changelogPath, "utf8") : "";
    const heading = "# Changelog\n\n";
    const body = existing.replace(/^# Changelog\s*/u, "");
    fs.writeFileSync(changelogPath, `${heading}${section}\n${body}`.trimEnd() + "\n", "utf8");
    console.log(`Updated ${plan.changelogFile}`);
    return 0;
  }

  if (command === "pr") {
    const pr = prepareSimpleReleasePr();
    console.log(`Prepared release PR branch ${pr.branch}`);
    console.log(`Title: ${pr.title}`);
    return 0;
  }

  console.log("Usage: versionary <command>");
  console.log("Commands:");
  console.log("  verify  Validate config and basic repository shape");
  console.log("  plan    Print release plan (simple mode)");
  console.log("  changelog [--write]  Print or write changelog section");
  console.log("  pr      Prepare release PR commit and branch");
  return 1;
}

process.exit(main());
