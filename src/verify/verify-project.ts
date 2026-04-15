import fs from "node:fs";
import path from "node:path";
import { loadConfig } from "../config/load-config.js";
import { resolvePackageStrategyContext } from "../domain/strategy/package-context.js";
import { resolveVersionStrategy } from "../domain/strategy/resolve.js";

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
    for (const [pkgPathRaw, packageConfig] of Object.entries(
      config.config.packages,
    )) {
      const pkgPath = path.join(cwd, pkgPathRaw);
      const exists = fs.existsSync(pkgPath);
      checks.push({
        name: `package-path:${pkgPathRaw}`,
        ok: exists,
        details: exists ? "Path exists" : `Missing path: ${pkgPathRaw}`,
      });

      if (exists) {
        const packageContext = resolvePackageStrategyContext(
          config.config,
          pkgPathRaw,
          packageConfig,
        );
        const packageVersionFile = packageContext.versionFile;
        const packageVersionExists = fs.existsSync(
          path.join(cwd, packageVersionFile),
        );
        checks.push({
          name: `version-file:${packageVersionFile}`,
          ok: packageVersionExists,
          details: packageVersionExists
            ? "Version file exists"
            : `Missing ${packageVersionFile}`,
        });
      }
    }
  }

  const ok = checks.every((c) => c.ok);
  return { ok, checks };
}
