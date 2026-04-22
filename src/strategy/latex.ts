import fs from "node:fs";
import path from "node:path";
import type { VersionaryConfig } from "../types/config.js";
import type {
  StrategyFinalizeContext,
  StrategyVersionWriteContext,
  VersionStrategy,
} from "./types.js";

const BUILD_LUA_VERSION_PATTERN = /^(\s*version\s*=\s*")([^"]+)(")/mu;
const PROVIDES_PACKAGE_PATTERN =
  /\\ProvidesPackage\{([^}]+)\}\[\d{4}-\d{2}-\d{2} v([0-9]+\.[0-9]+\.[0-9]+) ([^\]]+)\]/gu;
const PROVIDES_EXPL_PACKAGE_PATTERN =
  /\\ProvidesExplPackage\{([^}]+)\}\{\d{4}-\d{2}-\d{2}\}\{[^}]+\}\{([^}]*)\}/gu;

function normalizeRelative(base: string, target: string): string {
  return path.relative(base, target).replaceAll("\\", "/");
}

function collectDtxFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) {
    return [];
  }
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const target = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectDtxFiles(target));
      continue;
    }
    if (entry.isFile() && target.endsWith(".dtx")) {
      files.push(target);
    }
  }
  return files.sort((a, b) => a.localeCompare(b));
}

function replaceBuildLuaVersion(
  content: string,
  version: string,
  versionFile: string,
): string {
  const match = content.match(BUILD_LUA_VERSION_PATTERN);
  if (!match) {
    throw new Error(
      `${versionFile} is missing a valid version field required by release-type "latex".`,
    );
  }
  return content.replace(BUILD_LUA_VERSION_PATTERN, `$1${version}$3`);
}

function replaceProvidesPackageMetadata(
  content: string,
  version: string,
  releaseDate: string,
  relativePath: string,
): string {
  const packageMatches = [...content.matchAll(PROVIDES_PACKAGE_PATTERN)];
  const explPackageMatches = [
    ...content.matchAll(PROVIDES_EXPL_PACKAGE_PATTERN),
  ];
  const matches = [...packageMatches, ...explPackageMatches];
  if (matches.length !== 1) {
    throw new Error(
      `${relativePath} must contain exactly one \\ProvidesPackage or \\ProvidesExplPackage metadata entry; matched ${matches.length}.`,
    );
  }
  if (explPackageMatches.length === 1) {
    return content.replace(
      PROVIDES_EXPL_PACKAGE_PATTERN,
      (_full, pkg, desc) =>
        `\\ProvidesExplPackage{${pkg}}{${releaseDate}}{${version}}{${desc}}`,
    );
  }
  return content.replace(
    PROVIDES_PACKAGE_PATTERN,
    (_full, pkg, _prevVersion, desc) =>
      `\\ProvidesPackage{${pkg}}[${releaseDate} v${version} ${desc}]`,
  );
}

export const latexVersionStrategy: VersionStrategy = {
  name: "latex",
  getVersionFile(config: VersionaryConfig): string {
    return config["version-file"] ?? "build.lua";
  },
  readVersion(cwd: string, config: VersionaryConfig): string {
    const versionFile = this.getVersionFile(config);
    const versionPath = path.join(cwd, versionFile);
    if (!fs.existsSync(versionPath)) {
      throw new Error(`Versionary requires ${versionFile} to exist.`);
    }
    const content = fs.readFileSync(versionPath, "utf8");
    const match = content.match(BUILD_LUA_VERSION_PATTERN);
    if (!match?.[2]) {
      throw new Error(
        `${versionFile} is missing a valid version field required by release-type "latex".`,
      );
    }
    return match[2].trim();
  },
  writeVersion(
    cwd: string,
    config: VersionaryConfig,
    version: string,
  ): string[] {
    const versionFile = this.getVersionFile(config);
    const versionPath = path.join(cwd, versionFile);
    if (!fs.existsSync(versionPath)) {
      throw new Error(`Versionary requires ${versionFile} to exist.`);
    }
    const next = replaceBuildLuaVersion(
      fs.readFileSync(versionPath, "utf8"),
      version,
      versionFile,
    );
    fs.writeFileSync(versionPath, next, "utf8");
    return [versionFile];
  },
  finalizeVersionWrites(
    cwd: string,
    writes: StrategyVersionWriteContext[],
    context: StrategyFinalizeContext,
  ): string[] {
    const updated = new Set<string>();
    for (const write of writes) {
      const packageRoot =
        write.packagePath === "." ? cwd : path.join(cwd, write.packagePath);
      const srcDir = path.join(packageRoot, "src");
      const dtxFiles = collectDtxFiles(srcDir);
      if (dtxFiles.length === 0) {
        throw new Error(
          `release-type "latex" requires at least one .dtx file under ${normalizeRelative(cwd, srcDir)}.`,
        );
      }
      for (const dtxPath of dtxFiles) {
        const relativePath = normalizeRelative(cwd, dtxPath);
        const existing = fs.readFileSync(dtxPath, "utf8");
        const next = replaceProvidesPackageMetadata(
          existing,
          write.version,
          context.releaseDate,
          relativePath,
        );
        if (next === existing) {
          continue;
        }
        fs.writeFileSync(dtxPath, next, "utf8");
        updated.add(relativePath);
      }
    }
    return [...updated].sort((a, b) => a.localeCompare(b));
  },
};
