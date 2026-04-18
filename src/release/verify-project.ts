import fs from "node:fs";
import path from "node:path";
import { loadConfig } from "../config/load-config.js";
import { resolvePackageStrategyContext } from "../strategy/package-context.js";
import { resolveVersionStrategy } from "../strategy/resolve.js";

export interface VerifyResult {
  ok: boolean;
  checks: Array<{
    name: string;
    ok: boolean;
    details: string;
    category: "config" | "paths" | "version-files";
    remediation?: string;
  }>;
}

export function verifyProject(cwd = process.cwd()): VerifyResult {
  const checks: VerifyResult["checks"] = [];

  const config = loadConfig(cwd);
  checks.push({
    name: "config-load",
    ok: true,
    details: `Loaded ${path.basename(config.path)} (${config.format})`,
    category: "config",
  });

  const strategy = resolveVersionStrategy(config.config);
  const versionFile = strategy.getVersionFile(config.config);
  const exists = fs.existsSync(path.join(cwd, versionFile));
  checks.push({
    name: `version-file:${versionFile}`,
    ok: exists,
    details: exists ? "Version file exists" : `Missing ${versionFile}`,
    category: "version-files",
    remediation: exists
      ? undefined
      : `Create ${versionFile} or set "version-file" to the correct path for your release strategy.`,
  });
  if (exists) {
    const validationError = strategy.validateProject?.(cwd, config.config);
    checks.push({
      name: `strategy-validate:${strategy.name}`,
      ok: !validationError,
      details: validationError ?? "Strategy-level validation passed",
      category: "version-files",
      remediation: validationError
        ? `Fix strategy-specific version metadata in ${versionFile} for release-type "${strategy.name}".`
        : undefined,
    });
  }

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
        category: "paths",
        remediation: exists
          ? undefined
          : `Create ${pkgPathRaw} or remove/rename this entry under "packages" in versionary config.`,
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
          category: "version-files",
          remediation: packageVersionExists
            ? undefined
            : `Create ${packageVersionFile} or adjust package release settings ("release-type"/"version-file") for ${pkgPathRaw}.`,
        });
        if (packageVersionExists) {
          const packageValidationError =
            packageContext.strategy.validateProject?.(
              cwd,
              packageContext.config,
            );
          checks.push({
            name: `strategy-validate:${packageContext.strategy.name}:${pkgPathRaw}`,
            ok: !packageValidationError,
            details:
              packageValidationError ?? "Strategy-level validation passed",
            category: "version-files",
            remediation: packageValidationError
              ? `Fix strategy-specific version metadata in ${packageVersionFile} for package "${pkgPathRaw}".`
              : undefined,
          });
        }
      }
    }
  }

  const ok = checks.every((c) => c.ok);
  return { ok, checks };
}
