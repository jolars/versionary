import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { loadConfig } from "../../config/load-config.js";
import { resolveVersionStrategy } from "../../domain/strategy/resolve.js";
import { findPluginsByCapability } from "../../plugins/capabilities.js";
import { loadRuntimePlugins } from "../../plugins/runtime.js";
import { isReleaseCommitMessage } from "./pr.js";
import { executeIdempotentReleaseTarget } from "./recovery.js";
import { readReleaseTargets } from "./state.js";

function getHeadCommitSubject(cwd: string): string {
  return execFileSync("git", ["log", "-1", "--pretty=%s"], {
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
  const subject = getHeadCommitSubject(cwd);
  if (!isReleaseCommitMessage(subject)) {
    return "No release commit context detected; skipping release stage.";
  }

  const loaded = loadConfig(cwd);
  const strategy = resolveVersionStrategy(loaded.config);
  const changelogFile = loaded.config["changelog-file"] ?? "CHANGELOG.md";
  const version = strategy.readVersion(cwd, loaded.config);
  const defaultTag = `v${version}`;

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

  const releaseTargets = readReleaseTargets(cwd);
  const targets =
    releaseTargets.length > 0
      ? releaseTargets
      : [
          {
            path: ".",
            version,
            tag: defaultTag,
            notes: readReleaseNotes(cwd, version, changelogFile),
          },
        ];

  const published: string[] = [];
  for (const target of targets) {
    const outcome = await executeIdempotentReleaseTarget(
      cwd,
      {
        tag: target.tag,
        version: target.version,
        notes:
          target.notes ?? readReleaseNotes(cwd, target.version, changelogFile),
      },
      {
        createReleaseMetadata: (input) =>
          plugin.createReleaseMetadata!(input, { cwd, logger: console }),
      },
    );
    published.push(
      `${outcome.tag}: ${outcome.url} (tag=${outcome.tagStatus}, metadata=${outcome.metadataStatus})`,
    );
  }
  return `Published releases ${published.join(", ")}`;
}
