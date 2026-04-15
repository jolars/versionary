import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { loadConfig } from "../../config/load-config.js";

interface SimpleStateFile {
  manifestVersion?: number;
  baselineSha?: string;
  releaseTargets?: ReleaseTargetState[];
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
    manifest.manifestVersion !== undefined &&
    manifest.manifestVersion !== 1
  ) {
    throw new Error(
      `Unsupported manifestVersion in ${filePath}: ${String(manifest.manifestVersion)}.`,
    );
  }
  if (
    manifest.baselineSha !== undefined &&
    typeof manifest.baselineSha !== "string"
  ) {
    throw new Error(
      `Invalid release manifest at ${filePath}: baselineSha must be a string.`,
    );
  }
  if (
    manifest.releaseTargets !== undefined &&
    !Array.isArray(manifest.releaseTargets)
  ) {
    throw new Error(
      `Invalid release manifest at ${filePath}: releaseTargets must be an array.`,
    );
  }
  if (Array.isArray(manifest.releaseTargets)) {
    for (const target of manifest.releaseTargets) {
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
          `Invalid release manifest at ${filePath}: releaseTargets must contain string path, version, and tag.`,
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
  return parsed.baselineSha ?? null;
}

export function readReleaseTargets(cwd = process.cwd()): ReleaseTargetState[] {
  const filePath = getBaselineStatePath(cwd);
  if (!fs.existsSync(filePath)) {
    return [];
  }

  const parsed = parseStateFile(fs.readFileSync(filePath, "utf8"), filePath);
  return parsed.releaseTargets ?? [];
}

export function writeBaselineSha(
  cwd = process.cwd(),
  sha?: string,
  releaseTargets: ReleaseTargetState[] = [],
): void {
  const baselineSha =
    sha ??
    execFileSync("git", ["rev-parse", "HEAD"], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  const filePath = getBaselineStatePath(cwd);
  const next: SimpleStateFile = {
    manifestVersion: 1,
    baselineSha,
    releaseTargets,
  };
  fs.writeFileSync(filePath, `${JSON.stringify(next, null, 2)}\n`, "utf8");
}
