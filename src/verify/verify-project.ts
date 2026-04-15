import fs from "node:fs";
import path from "node:path";
import { loadConfig } from "../config/load-config.js";
import { resolveVersionStrategy } from "../strategies/resolve.js";

export interface VerifyResult {
  ok: boolean;
  checks: Array<{ name: string; ok: boolean; details: string }>;
}

export function verifyProject(cwd = process.cwd()): VerifyResult {
  const checks: VerifyResult["checks"] = [];

  const config = loadConfig(cwd);
  checks.push({
    name: "config-load",
    ok: true,
    details: `Loaded ${path.basename(config.path)} (${config.format})`,
  });

  const strategy = resolveVersionStrategy(config.config);
  const versionFile = strategy.getVersionFile(config.config);
  const exists = fs.existsSync(path.join(cwd, versionFile));
  checks.push({
    name: `version-file:${versionFile}`,
    ok: exists,
    details: exists ? "Version file exists" : `Missing ${versionFile}`,
  });

  if (config.config.packages) {
    for (const pkgPathRaw of Object.keys(config.config.packages)) {
      const pkgPath = path.join(cwd, pkgPathRaw);
      const exists = fs.existsSync(pkgPath);
      checks.push({
        name: `package-path:${pkgPathRaw}`,
        ok: exists,
        details: exists ? "Path exists" : `Missing path: ${pkgPathRaw}`,
      });
    }
  }

  const ok = checks.every((c) => c.ok);
  return { ok, checks };
}
