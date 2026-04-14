import fs from "node:fs";
import path from "node:path";
import type { SimplePlan } from "./plan.js";

function formatDate(): string {
  return new Date().toISOString().slice(0, 10);
}

export function renderSimpleChangelog(plan: SimplePlan): string {
  if (!plan.nextVersion) {
    return "";
  }

  const lines = [
    `## ${plan.nextVersion} - ${formatDate()}`,
    "",
    ...plan.commits.map((commit) => `- ${commit.subject} (${commit.hash.slice(0, 7)})`),
    "",
  ];

  return lines.join("\n");
}

export function prependChangelog(cwd: string, changelogFile: string, section: string): void {
  const changelogPath = path.join(cwd, changelogFile);
  const existing = fs.existsSync(changelogPath) ? fs.readFileSync(changelogPath, "utf8") : "";
  const heading = existing.startsWith("# Changelog") ? "" : "# Changelog\n\n";
  const separator = existing.length > 0 ? "\n" : "";
  const next = `${heading}${section}${separator}${existing.replace(/^# Changelog\s*/u, "")}`.trimEnd() + "\n";
  fs.writeFileSync(changelogPath, next, "utf8");
}
