import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { loadConfig } from "../../config/load-config.js";

const MANIFEST_VERSION_KEY = "manifest-version";
const BASELINE_SHA_KEY = "baseline-sha";
const RELEASE_TARGETS_KEY = "release-targets";

interface SimpleStateFile {
  [MANIFEST_VERSION_KEY]?: number;
  [BASELINE_SHA_KEY]?: string;
  [RELEASE_TARGETS_KEY]?: ReleaseTargetState[];
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
  if (
    manifest[RELEASE_TARGETS_KEY] !== undefined &&
    !Array.isArray(manifest[RELEASE_TARGETS_KEY])
  ) {
    throw new Error(
      `Invalid release manifest at ${filePath}: ${RELEASE_TARGETS_KEY} must be an array.`,
    );
  }
  if (Array.isArray(manifest[RELEASE_TARGETS_KEY])) {
    for (const target of manifest[RELEASE_TARGETS_KEY]) {
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
          `Invalid release manifest at ${filePath}: ${RELEASE_TARGETS_KEY} must contain string path, version, and tag.`,
        );
      }
    }
  }
  return manifest as SimpleStateFile;
}

export function getBaselineStatePath(cwd: string): string {
  const loaded = loadConfig(cwd);
  const configured = loaded.config["baseline-file"];
  if (configured) {
    return path.join(cwd, configured);
  }

  const preferred = path.join(cwd, ".versionary-manifest.json");
  if (fs.existsSync(preferred)) {
    return preferred;
  }

  const legacy = path.join(cwd, "versionary.versions.json");
  if (fs.existsSync(legacy)) {
    return legacy;
  }

  return preferred;
}

export function readBaselineSha(cwd = process.cwd()): string | null {
  const filePath = getBaselineStatePath(cwd);
  if (!fs.existsSync(filePath)) {
    return null;
  }

  const parsed = parseStateFile(fs.readFileSync(filePath, "utf8"), filePath);
  return parsed[BASELINE_SHA_KEY] ?? null;
}

export function readReleaseTargets(cwd = process.cwd()): ReleaseTargetState[] {
  const filePath = getBaselineStatePath(cwd);
  if (!fs.existsSync(filePath)) {
    return [];
  }

  const parsed = parseStateFile(fs.readFileSync(filePath, "utf8"), filePath);
  return parsed[RELEASE_TARGETS_KEY] ?? [];
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
  const next: SimpleStateFile = {
    [MANIFEST_VERSION_KEY]: 1,
    [BASELINE_SHA_KEY]: baselineShaValue,
    [RELEASE_TARGETS_KEY]: nextTargets,
  };
  fs.writeFileSync(filePath, `${JSON.stringify(next, null, 2)}\n`, "utf8");
}
