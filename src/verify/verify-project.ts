import fs from "node:fs";
import path from "node:path";
import { loadConfig } from "../config/load-config.js";

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

  if ((config.config.mode ?? "simple") === "simple") {
    const versionFile = config.config.simple?.versionFile ?? "version.txt";
    const exists = fs.existsSync(path.join(cwd, versionFile));
    checks.push({
      name: `simple-version-file:${versionFile}`,
      ok: exists,
      details: exists ? "Version file exists" : `Missing ${versionFile} for simple mode`,
    });
  }

  if (config.config.packages) {
    for (const pkg of config.config.packages) {
      const pkgPath = path.join(cwd, pkg.path);
      const exists = fs.existsSync(pkgPath);
      checks.push({
        name: `package-path:${pkg.path}`,
        ok: exists,
        details: exists ? "Path exists" : `Missing path: ${pkg.path}`,
      });
    }
  }

  const ok = checks.every((c) => c.ok);
  return { ok, checks };
}
