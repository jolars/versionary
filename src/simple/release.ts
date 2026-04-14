import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { loadConfig } from "../config/load-config.js";
import { findPluginsByCapability } from "../plugins/capabilities.js";
import { loadRuntimePlugins } from "../plugins/runtime.js";
import { isReleaseCommitMessage } from "./pr.js";

function getHeadCommitSubject(cwd: string): string {
  return execFileSync("git", ["log", "-1", "--pretty=%s"], {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  }).trim();
}

function createTagIfMissing(cwd: string, tag: string): void {
  const tagExists = execFileSync("git", ["tag", "--list", tag], {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  }).trim();
  if (tagExists.length > 0) {
    return;
  }

  execFileSync("git", ["tag", tag], { cwd, stdio: ["ignore", "pipe", "ignore"] });
  execFileSync("git", ["push", "origin", tag], { cwd, stdio: ["ignore", "pipe", "ignore"] });
}

function readReleaseNotes(cwd: string, version: string, changelogFile: string): string {
  const changelogPath = path.join(cwd, changelogFile);
  if (!fs.existsSync(changelogPath)) {
    return `Automated release for v${version}`;
  }

  const content = fs.readFileSync(changelogPath, "utf8");
  const lines = content.split("\n");
  const start = lines.findIndex((line) => line.startsWith(`## ${version} -`) || line.startsWith(`## [${version}](`));
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

  const notes = lines.slice(start + 1, end).join("\n").trim();
  return notes.length > 0 ? notes : `Automated release for v${version}`;
}

export async function runSimpleRelease(cwd = process.cwd()): Promise<string> {
  const subject = getHeadCommitSubject(cwd);
  if (!isReleaseCommitMessage(subject)) {
    return "No release commit context detected; skipping release stage.";
  }

  const loaded = loadConfig(cwd);
  const versionFile = loaded.config["version-file"] ?? "version.txt";
  const changelogFile = loaded.config["changelog-file"] ?? "CHANGELOG.md";
  const version = fs.readFileSync(path.join(cwd, versionFile), "utf8").trim();
  const tag = `v${version}`;
  createTagIfMissing(cwd, tag);

  const plugins = loadRuntimePlugins();
  const scmPlugins = findPluginsByCapability(plugins, "scm.releaseMetadata");
  if (scmPlugins.length === 0) {
    throw new Error("No scm.releaseMetadata plugin is available.");
  }

  const plugin = scmPlugins[0];
  if (!plugin?.createReleaseMetadata) {
    throw new Error(`Plugin "${plugin?.name ?? "unknown"}" does not implement createReleaseMetadata.`);
  }

  const notes = readReleaseNotes(cwd, version, changelogFile);
  const result = await plugin.createReleaseMetadata(
    { tag, version, notes },
    { cwd, logger: console },
  );
  return `Published release ${tag}: ${result.url}`;
}
