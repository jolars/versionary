import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { loadConfig } from "../../config/load-config.js";
import { resolveVersionStrategy } from "../../domain/strategy/resolve.js";
import { findPluginsByCapability } from "../../plugins/capabilities.js";
import { loadRuntimePlugins } from "../../plugins/runtime.js";
import type { VersionaryPluginContext } from "../../types/plugins.js";
import { isReleaseCommitMessage } from "./pr.js";
import { executeIdempotentReleaseTarget } from "./recovery.js";
import { readReleaseTargets } from "./state.js";

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
): string {
  const changelogPath = path.join(cwd, changelogFile);
  if (!fs.existsSync(changelogPath)) {
    return `Automated release for v${version}`;
  }

  const content = fs.readFileSync(changelogPath, "utf8");
  const lines = content.split("\n");
  const start = lines.findIndex(
    (line) =>
      line.startsWith(`## ${version} -`) || line.startsWith(`## [${version}](`),
  );
  if (start < 0) {
    return `Automated release for v${version}`;
  }

  let end = lines.length;
  for (let idx = start + 1; idx < lines.length; idx += 1) {
    if (lines[idx]?.startsWith("## ")) {
      end = idx;
      break;
    }
  }

  const notes = lines
    .slice(start + 1, end)
    .join("\n")
    .trim();
  return notes.length > 0 ? notes : `Automated release for v${version}`;
}

export async function runSimpleRelease(cwd = process.cwd()): Promise<string> {
  const result = await runSimpleReleaseDetailed(cwd, { logger: console });
  if (result.action === "release-skipped") {
    return result.reason;
  }
  return result.message;
}

export type SimpleRunReleaseResult =
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

export interface RunSimpleReleaseOptions {
  logger?: VersionaryPluginContext["logger"];
  "dry-run"?: boolean;
}

export async function runSimpleReleaseDetailed(
  cwd = process.cwd(),
  options: RunSimpleReleaseOptions = {},
): Promise<SimpleRunReleaseResult> {
  const commitMessage = getHeadCommitMessage(cwd);
  if (!isReleaseCommitMessage(commitMessage)) {
    return {
      action: "release-skipped",
      reason: "No release commit context detected; skipping release stage.",
    };
  }

  const loaded = loadConfig(cwd);
  const strategy = resolveVersionStrategy(loaded.config);
  const changelogFile = loaded.config["changelog-file"] ?? "CHANGELOG.md";
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

  const plugins = loadRuntimePlugins();
  const scmPlugins = findPluginsByCapability(plugins, "scm.releaseMetadata");
  if (scmPlugins.length === 0) {
    throw new Error("No scm.releaseMetadata plugin is available.");
  }

  const plugin = scmPlugins[0];
  if (!plugin?.createReleaseMetadata) {
    throw new Error(
      `Plugin "${plugin?.name ?? "unknown"}" does not implement createReleaseMetadata.`,
    );
  }
  const createReleaseMetadata = plugin.createReleaseMetadata;

  const releases: {
    tag: string;
    url: string;
    tagStatus: "created" | "exists";
    metadataStatus: "created" | "exists";
  }[] = [];
  for (const target of targets) {
    const outcome = await executeIdempotentReleaseTarget(
      cwd,
      {
        tag: target.tag,
        version: target.version,
        notes: readReleaseNotes(cwd, target.version, changelogFile),
      },
      {
        createReleaseMetadata: (input) =>
          createReleaseMetadata(input, {
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
