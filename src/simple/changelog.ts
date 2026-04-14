import fs from "node:fs";
import path from "node:path";
import type { SimplePlan } from "./plan.js";
import { isReleasableCommit } from "./git.js";
import { resolveRepositoryWebBaseUrl } from "./repo-url.js";

function formatDate(): string {
  return new Date().toISOString().slice(0, 10);
}

export function renderSimpleChangelog(plan: SimplePlan): string {
  if (!plan.nextVersion) {
    return "";
  }

  const repoUrl = resolveRepositoryWebBaseUrl(process.cwd());
  const versionHeading = repoUrl
    ? `## [${plan.nextVersion}](${repoUrl}/compare/v${plan.currentVersion}...v${plan.nextVersion}) (${formatDate()})`
    : `## ${plan.nextVersion} - ${formatDate()}`;

  const lines = [
    versionHeading,
    "",
    ...plan.commits
      .filter((commit) => isReleasableCommit(commit.subject))
      .map((commit) => {
        const short = commit.hash.slice(0, 7);
        if (!repoUrl) {
          return `- ${commit.subject} (\`${short}\`)`;
        }
        return `- ${commit.subject} ([\`${short}\`](${repoUrl}/commit/${commit.hash}))`;
      }),
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
