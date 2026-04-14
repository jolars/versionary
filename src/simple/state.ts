import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { loadConfig } from "../config/load-config.js";

interface SimpleStateFile {
  baselineSha?: string;
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

  const parsed = JSON.parse(fs.readFileSync(filePath, "utf8")) as SimpleStateFile;
  return parsed.baselineSha ?? null;
}

export function writeBaselineSha(cwd = process.cwd(), sha?: string): void {
  const baselineSha =
    sha ??
    execFileSync("git", ["rev-parse", "HEAD"], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  const filePath = getBaselineStatePath(cwd);
  const next: SimpleStateFile = { baselineSha };
  fs.writeFileSync(filePath, `${JSON.stringify(next, null, 2)}\n`, "utf8");
}
