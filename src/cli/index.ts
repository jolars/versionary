#!/usr/bin/env node

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
  const [, , command] = process.argv;
  if (command === "verify") {
    return printVerifyResult();
  }

  console.log("Usage: versionary <command>");
  console.log("Commands:");
  console.log("  verify  Validate config and basic repository shape");
  return 1;
}

process.exit(main());
