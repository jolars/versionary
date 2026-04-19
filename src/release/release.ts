import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { loadConfig } from "../config/load-config.js";
import { getScmClient } from "../scm/client.js";
import { resolveVersionStrategy } from "../strategy/resolve.js";
import type { VersionaryConfig } from "../types/config.js";
import type { VersionaryPluginContext } from "../types/plugins.js";
import { getChangelogDefaults } from "./plan.js";
import { isReleaseCommitMessage } from "./pr.js";
import { executeIdempotentReleaseTarget } from "./recovery.js";
import { readReleaseTargets } from "./state.js";

function escapeRegExp(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

export function extractReleaseNotes(
  content: string,
  version: string,
  changelogFormat: "markdown-changelog" | "r-news",
): string {
  const lines = content.split("\n");
  const shortVersion = version.replace(/\.\d+$/u, "");
  const start =
    changelogFormat === "r-news"
      ? lines.findIndex((line) => {
          const fullMatch = new RegExp(
            `^#\\s+.+\\s+${escapeRegExp(version)}\\s*$`,
            "u",
          );
          const shortMatch = new RegExp(
            `^#\\s+.+\\s+${escapeRegExp(shortVersion)}\\s*$`,
            "u",
          );
          return fullMatch.test(line) || shortMatch.test(line);
        })
      : lines.findIndex(
          (line) =>
            line.startsWith(`## ${version} -`) ||
            line.startsWith(`## [${version}](`) ||
            line.startsWith(`# ${shortVersion} -`) ||
            line.startsWith(`# [${shortVersion}](`) ||
            new RegExp(`^#\\s+.+\\s+${shortVersion}\\s*$`, "u").test(line),
        );
  if (start < 0) {
    return "";
  }

  let end = lines.length;
  for (let idx = start + 1; idx < lines.length; idx += 1) {
    const line = lines[idx] ?? "";
    if (changelogFormat === "r-news") {
      if (/^#(?!#)\s+/u.test(line)) {
        end = idx;
        break;
      }
      continue;
    }
    if (line.startsWith("## ")) {
      end = idx;
      break;
    }
  }

  return lines
    .slice(start + 1, end)
    .join("\n")
    .trim();
}

function getHeadCommitMessage(cwd: string): string {
  return execFileSync("git", ["log", "-1", "--pretty=%B"], {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  }).trim();
}

function readReleaseNotes(
  cwd: string,
  version: string,
  changelogFile: string,
  changelogFormat: "markdown-changelog" | "r-news",
): string {
  const changelogPath = path.join(cwd, changelogFile);
  if (!fs.existsSync(changelogPath)) {
    return `Automated release for v${version}`;
  }

  const content = fs.readFileSync(changelogPath, "utf8");
  const notes = extractReleaseNotes(content, version, changelogFormat);
  return notes.length > 0 ? notes : `Automated release for v${version}`;
}

export function extractClosingReferencesFromNotes(notes: string): number[] {
  const refs = new Set<number>();
  const linkedPattern =
    /\b(close|closes|closed|fix|fixes|fixed|resolve|resolves|resolved)\b\s+\[#(\d+)\]\([^)]+\)/giu;
  for (const match of notes.matchAll(linkedPattern)) {
    const issue = Number(match[2] ?? "");
    if (Number.isInteger(issue) && issue > 0) {
      refs.add(issue);
    }
  }
  const plainPattern =
    /\b(close|closes|closed|fix|fixes|fixed|resolve|resolves|resolved)\b\s+#(\d+)/giu;
  for (const match of notes.matchAll(plainPattern)) {
    const issue = Number(match[2] ?? "");
    if (Number.isInteger(issue) && issue > 0) {
      refs.add(issue);
    }
  }
  return [...refs].sort((a, b) => a - b);
}

export function resolveTargetChangelogFile(
  config: VersionaryConfig,
  rootChangelogFile: string,
  targetPath: string,
): string {
  if (targetPath === ".") {
    return rootChangelogFile;
  }

  const packageConfig = config.packages?.[targetPath];
  const packageStrategy = resolveVersionStrategy({
    ...config,
    "release-type": packageConfig?.["release-type"] ?? config["release-type"],
  });
  const { changelogFile: packageChangelogFile } = getChangelogDefaults({
    "release-type": packageConfig?.["release-type"] ?? config["release-type"],
    "changelog-file":
      packageConfig?.["changelog-file"] ?? config["changelog-file"],
    "changelog-format":
      packageConfig?.["changelog-format"] ?? config["changelog-format"],
    defaultChangelogFormat: packageStrategy.getDefaultChangelogFormat?.(),
  });

  return path.posix.join(targetPath, packageChangelogFile);
}

function resolveTargetChangelogFormat(
  config: VersionaryConfig,
  targetPath: string,
): "markdown-changelog" | "r-news" {
  const packageConfig = config.packages?.[targetPath];
  const packageStrategy = resolveVersionStrategy({
    ...config,
    "release-type": packageConfig?.["release-type"] ?? config["release-type"],
  });
  const { changelogFormat } = getChangelogDefaults({
    "release-type": packageConfig?.["release-type"] ?? config["release-type"],
    "changelog-file":
      packageConfig?.["changelog-file"] ?? config["changelog-file"],
    "changelog-format":
      packageConfig?.["changelog-format"] ?? config["changelog-format"],
    defaultChangelogFormat: packageStrategy.getDefaultChangelogFormat?.(),
  });
  return changelogFormat;
}

export async function runRelease(cwd = process.cwd()): Promise<string> {
  const result = await runReleaseDetailed(cwd, { logger: console });
  if (result.action === "release-skipped") {
    return result.reason;
  }
  return result.message;
}

export type RunReleaseResult =
  | {
      action: "release-skipped";
      reason: string;
    }
  | {
      action: "release-dry-run";
      message: string;
      targets: {
        tag: string;
        version: string;
      }[];
    }
  | {
      action: "release-published";
      message: string;
      releases: {
        tag: string;
        url: string;
        tagStatus: "created" | "exists";
        metadataStatus: "created" | "exists";
      }[];
    };

export interface RunReleaseOptions {
  logger?: VersionaryPluginContext["logger"];
  "dry-run"?: boolean;
}

export async function runReleaseDetailed(
  cwd = process.cwd(),
  options: RunReleaseOptions = {},
): Promise<RunReleaseResult> {
  const commitMessage = getHeadCommitMessage(cwd);
  if (!isReleaseCommitMessage(commitMessage)) {
    return {
      action: "release-skipped",
      reason: "No release commit context detected; skipping release stage.",
    };
  }

  const loaded = loadConfig(cwd);
  const strategy = resolveVersionStrategy(loaded.config);
  const { changelogFile } = getChangelogDefaults({
    ...loaded.config,
    defaultChangelogFormat: strategy.getDefaultChangelogFormat?.(),
  });
  const referenceCommentMode =
    loaded.config["release-reference-comments"] ?? "off";
  const version = strategy.readVersion(cwd, loaded.config);
  const defaultTag = `v${version}`;

  const releaseTargets = readReleaseTargets(cwd);
  const targets =
    releaseTargets.length > 0
      ? releaseTargets
      : [
          {
            path: ".",
            version,
            tag: defaultTag,
          },
        ];

  if (options["dry-run"]) {
    const targetList = targets.map(
      (target) => `${target.tag} (${target.version})`,
    );
    return {
      action: "release-dry-run",
      targets: targets.map((target) => ({
        tag: target.tag,
        version: target.version,
      })),
      message: `Dry run: would publish releases ${targetList.join(", ")}`,
    };
  }

  const scmClient = getScmClient();

  const releases: {
    tag: string;
    url: string;
    tagStatus: "created" | "exists";
    metadataStatus: "created" | "exists";
  }[] = [];
  const referencesByTag = new Map<string, number[]>();
  for (const target of targets) {
    const targetChangelogFile = resolveTargetChangelogFile(
      loaded.config,
      changelogFile,
      target.path,
    );
    const targetChangelogFormat = resolveTargetChangelogFormat(
      loaded.config,
      target.path,
    );
    const releaseNotes = readReleaseNotes(
      cwd,
      target.version,
      targetChangelogFile,
      targetChangelogFormat,
    );
    referencesByTag.set(
      target.tag,
      extractClosingReferencesFromNotes(releaseNotes),
    );
    const outcome = await executeIdempotentReleaseTarget(
      cwd,
      {
        tag: target.tag,
        version: target.version,
        notes: releaseNotes,
        draft: loaded.config["release-draft"] ?? false,
      },
      {
        createReleaseMetadata: (input) =>
          scmClient.createReleaseMetadata(input, {
            cwd,
            logger: options.logger,
          }),
        logger: options.logger,
      },
    );
    releases.push({
      tag: outcome.tag,
      url: outcome.url,
      tagStatus: outcome.tagStatus,
      metadataStatus: outcome.metadataStatus,
    });
    const references = referencesByTag.get(outcome.tag) ?? [];
    if (
      references.length > 0 &&
      referenceCommentMode !== "off" &&
      scmClient.createReleaseReferenceComments
    ) {
      await scmClient.createReleaseReferenceComments(
        {
          version: target.version,
          releaseUrl: outcome.url,
          references,
          mode: referenceCommentMode,
        },
        {
          cwd,
          logger: options.logger,
        },
      );
    }
  }

  const published = releases.map(
    (outcome) =>
      `${outcome.tag}: ${outcome.url} (tag=${outcome.tagStatus}, metadata=${outcome.metadataStatus})`,
  );
  return {
    action: "release-published",
    releases,
    message: `Published releases ${published.join(", ")}`,
  };
}

/** @deprecated Use RunReleaseResult. */
export type SimpleRunReleaseResult = RunReleaseResult;
/** @deprecated Use RunReleaseOptions. */
export type RunSimpleReleaseOptions = RunReleaseOptions;
/** @deprecated Use runRelease. */
export async function runSimpleRelease(cwd = process.cwd()): Promise<string> {
  return runRelease(cwd);
}
/** @deprecated Use runReleaseDetailed. */
export async function runSimpleReleaseDetailed(
  cwd = process.cwd(),
  options: RunSimpleReleaseOptions = {},
): Promise<SimpleRunReleaseResult> {
  return runReleaseDetailed(cwd, options);
}
