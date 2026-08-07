import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { loadConfig } from "../config/load-config.js";

const MANIFEST_VERSION_KEY = "manifest-version";
const BASELINE_SHA_KEY = "baseline-sha";
const RELEASE_TARGETS_KEY = "release-targets";
const PENDING_RELEASE_TARGETS_KEY = "pending-release-targets";

interface SimpleStateFile {
  [MANIFEST_VERSION_KEY]?: number;
  [BASELINE_SHA_KEY]?: string;
  [RELEASE_TARGETS_KEY]?: ReleaseTargetState[];
  [PENDING_RELEASE_TARGETS_KEY]?: ReleaseTargetState[];
}

export interface ReleaseTargetState {
  path: string;
  version: string;
  tag: string;
}

function parseStateFile(raw: string, filePath: string): SimpleStateFile {
  const parsed = JSON.parse(raw) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(
      `Invalid release manifest at ${filePath}: expected an object.`,
    );
  }
  const manifest = parsed as Record<string, unknown>;
  if (
    manifest[MANIFEST_VERSION_KEY] !== undefined &&
    manifest[MANIFEST_VERSION_KEY] !== 1
  ) {
    throw new Error(
      `Unsupported ${MANIFEST_VERSION_KEY} in ${filePath}: ${String(manifest[MANIFEST_VERSION_KEY])}.`,
    );
  }
  if (
    manifest[BASELINE_SHA_KEY] !== undefined &&
    typeof manifest[BASELINE_SHA_KEY] !== "string"
  ) {
    throw new Error(
      `Invalid release manifest at ${filePath}: ${BASELINE_SHA_KEY} must be a string.`,
    );
  }
  validateReleaseTargets(
    manifest[RELEASE_TARGETS_KEY],
    RELEASE_TARGETS_KEY,
    filePath,
  );
  validateReleaseTargets(
    manifest[PENDING_RELEASE_TARGETS_KEY],
    PENDING_RELEASE_TARGETS_KEY,
    filePath,
  );
  return manifest as SimpleStateFile;
}

function validateReleaseTargets(
  value: unknown,
  key: string,
  filePath: string,
): void {
  if (value === undefined) {
    return;
  }
  if (!Array.isArray(value)) {
    throw new Error(
      `Invalid release manifest at ${filePath}: ${key} must be an array.`,
    );
  }
  for (const target of value) {
    if (!target || typeof target !== "object" || Array.isArray(target)) {
      throw new Error(
        `Invalid release manifest at ${filePath}: each release target must be an object.`,
      );
    }
    const record = target as Record<string, unknown>;
    if (
      typeof record.path !== "string" ||
      typeof record.version !== "string" ||
      typeof record.tag !== "string"
    ) {
      throw new Error(
        `Invalid release manifest at ${filePath}: ${key} must contain string path, version, and tag.`,
      );
    }
  }
}

export function getBaselineStatePath(cwd: string): string {
  const loaded = loadConfig(cwd);
  const configured = loaded.config["baseline-file"];
  if (configured) {
    return path.join(cwd, configured);
  }

  return path.join(cwd, ".versionary-manifest.json");
}

export function readBaselineSha(cwd = process.cwd()): string | null {
  const filePath = getBaselineStatePath(cwd);
  if (!fs.existsSync(filePath)) {
    return null;
  }

  const parsed = parseStateFile(fs.readFileSync(filePath, "utf8"), filePath);
  return parsed[BASELINE_SHA_KEY] ?? null;
}

// Accumulated per-package baseline: the latest released tag for every package
// ever released. `plan` uses these tags as the commit-range floor per package,
// so this list must persist entries across releases rather than be replaced.
export function readReleaseTargets(cwd = process.cwd()): ReleaseTargetState[] {
  const filePath = getBaselineStatePath(cwd);
  if (!fs.existsSync(filePath)) {
    return [];
  }

  const parsed = parseStateFile(fs.readFileSync(filePath, "utf8"), filePath);
  return parsed[RELEASE_TARGETS_KEY] ?? [];
}

// The publish set introduced by the current release PR. `release` consumes this
// so it only publishes/announces what this PR bumped, not every package in the
// accumulated baseline.
export function readPendingReleaseTargets(
  cwd = process.cwd(),
): ReleaseTargetState[] {
  const filePath = getBaselineStatePath(cwd);
  if (!fs.existsSync(filePath)) {
    return [];
  }

  const parsed = parseStateFile(fs.readFileSync(filePath, "utf8"), filePath);
  return parsed[PENDING_RELEASE_TARGETS_KEY] ?? [];
}

export function writeBaselineSha(
  cwd = process.cwd(),
  sha?: string,
  releaseTargets?: ReleaseTargetState[],
): void {
  const baselineShaValue =
    sha ??
    execFileSync("git", ["rev-parse", "HEAD"], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  const filePath = getBaselineStatePath(cwd);
  const existing = fs.existsSync(filePath)
    ? parseStateFile(fs.readFileSync(filePath, "utf8"), filePath)
    : {};
  const existingTargets = existing[RELEASE_TARGETS_KEY] ?? [];
  // Merge the current targets into the accumulated baseline (latest tag per
  // path wins, since `releaseTargets` is appended last), but record the current
  // targets verbatim as the pending publish set.
  const nextTargets =
    releaseTargets === undefined
      ? existingTargets
      : [
          ...new Map(
            [...existingTargets, ...releaseTargets].map((target) => [
              target.path,
              target,
            ]),
          ).values(),
        ].sort((a, b) => a.path.localeCompare(b.path));
  const nextPending =
    releaseTargets === undefined
      ? (existing[PENDING_RELEASE_TARGETS_KEY] ?? [])
      : [...releaseTargets].sort((a, b) => a.path.localeCompare(b.path));
  const next: SimpleStateFile = {
    [MANIFEST_VERSION_KEY]: 1,
    [BASELINE_SHA_KEY]: baselineShaValue,
    [RELEASE_TARGETS_KEY]: nextTargets,
    [PENDING_RELEASE_TARGETS_KEY]: nextPending,
  };
  fs.writeFileSync(filePath, `${JSON.stringify(next, null, 2)}\n`, "utf8");
}
