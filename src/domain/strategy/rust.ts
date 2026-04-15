import fs from "node:fs";
import path from "node:path";
import TOML from "@iarna/toml";
import type { VersionaryConfig } from "../../types/config.js";
import type { VersionStrategy } from "./types.js";

interface ParsedCargoManifest {
  packageTable: Record<string, unknown> | null;
  workspaceTable: Record<string, unknown> | null;
}

const ROOT_DEPENDENCY_SECTIONS = new Set([
  "dependencies",
  "dev-dependencies",
  "build-dependencies",
]);

function normalizeSlashPath(input: string): string {
  return input.replaceAll("\\", "/");
}

function hasGlobPattern(pattern: string): boolean {
  return /[*?]/u.test(pattern);
}

function escapeRegex(input: string): string {
  return input.replace(/[.+^${}()|\\]/gu, "\\$&");
}

function globToRegex(pattern: string): RegExp {
  const normalized = normalizeSlashPath(pattern);
  let source = "^";
  for (let index = 0; index < normalized.length; index += 1) {
    const current = normalized[index] ?? "";
    const next = normalized[index + 1] ?? "";
    if (current === "*" && next === "*") {
      source += ".*";
      index += 1;
      continue;
    }
    if (current === "*") {
      source += "[^/]*";
      continue;
    }
    if (current === "?") {
      source += "[^/]";
      continue;
    }
    source += escapeRegex(current);
  }
  source += "$";
  return new RegExp(source, "u");
}

function findCargoManifestDirectories(rootDir: string): string[] {
  const results = new Set<string>();
  const queue: string[] = [rootDir];

  while (queue.length > 0) {
    const currentDir = queue.shift();
    if (!currentDir) {
      continue;
    }

    const entries = fs.readdirSync(currentDir, {
      withFileTypes: true,
    });
    let hasCargoManifest = false;

    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);
      if (entry.isFile() && entry.name === "Cargo.toml") {
        hasCargoManifest = true;
        continue;
      }
      if (entry.isDirectory()) {
        queue.push(fullPath);
      }
    }

    if (hasCargoManifest) {
      const rel = normalizeSlashPath(path.relative(rootDir, currentDir));
      results.add(rel === "" ? "." : rel);
    }
  }

  return [...results].sort((a, b) => a.localeCompare(b));
}

function parseCargoManifest(
  versionFile: string,
  cargoTomlRaw: string,
): ParsedCargoManifest {
  let parsed: unknown;
  try {
    parsed = TOML.parse(cargoTomlRaw);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to parse ${versionFile}: ${message}`);
  }

  const parsedRecord = parsed as {
    package?: unknown;
    workspace?: unknown;
  };

  const packageTable =
    parsedRecord.package && typeof parsedRecord.package === "object"
      ? (parsedRecord.package as Record<string, unknown>)
      : null;
  const workspaceTable =
    parsedRecord.workspace && typeof parsedRecord.workspace === "object"
      ? (parsedRecord.workspace as Record<string, unknown>)
      : null;

  return { packageTable, workspaceTable };
}

function isCrateManifest(versionFile: string, cargoTomlRaw: string): boolean {
  const parsed = parseCargoManifest(versionFile, cargoTomlRaw);
  return parsed.packageTable !== null;
}

function readWorkspaceMemberPatterns(
  workspaceTable: Record<string, unknown> | null,
): string[] {
  if (!workspaceTable) {
    return [];
  }
  const members = workspaceTable.members;
  if (!Array.isArray(members)) {
    return [];
  }

  return members
    .filter((member): member is string => typeof member === "string")
    .map((member) => normalizeSlashPath(member.trim()))
    .filter((member) => member.length > 0);
}

function readWorkspaceExcludes(
  workspaceTable: Record<string, unknown> | null,
): string[] {
  if (!workspaceTable) {
    return [];
  }
  const excludes = workspaceTable.exclude;
  if (!Array.isArray(excludes)) {
    return [];
  }

  return excludes
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => normalizeSlashPath(entry.trim()))
    .filter((entry) => entry.length > 0);
}

function resolveWorkspaceMemberManifests(
  rootDir: string,
  workspaceTable: Record<string, unknown> | null,
): string[] {
  const memberPatterns = readWorkspaceMemberPatterns(workspaceTable);
  if (memberPatterns.length === 0) {
    return [];
  }

  const excludes = readWorkspaceExcludes(workspaceTable);
  const excludeRegexes = excludes.map((pattern) => globToRegex(pattern));
  const cargoDirs = findCargoManifestDirectories(rootDir);
  const manifests = new Set<string>();

  for (const pattern of memberPatterns) {
    if (hasGlobPattern(pattern)) {
      const regex = globToRegex(pattern);
      for (const dir of cargoDirs) {
        if (regex.test(dir)) {
          manifests.add(normalizeSlashPath(path.posix.join(dir, "Cargo.toml")));
        }
      }
      continue;
    }

    const candidateDir = normalizeSlashPath(pattern);
    if (excludeRegexes.some((regex) => regex.test(candidateDir))) {
      continue;
    }
    const cargoPath = path.join(rootDir, candidateDir, "Cargo.toml");
    if (fs.existsSync(cargoPath)) {
      manifests.add(
        normalizeSlashPath(path.posix.join(candidateDir, "Cargo.toml")),
      );
    }
  }

  const filtered = [...manifests].filter((manifestPath) => {
    const dir = normalizeSlashPath(path.posix.dirname(manifestPath));
    return !excludeRegexes.some((regex) => regex.test(dir));
  });

  return filtered.sort((a, b) => a.localeCompare(b));
}

function collectRustTargetManifests(
  cwd: string,
  versionFile: string,
): string[] {
  if (path.basename(versionFile) !== "Cargo.toml") {
    throw new Error(
      `Rust strategy requires "version-file" to point to a Cargo.toml manifest (received "${versionFile}").`,
    );
  }

  const rootManifestPath = path.join(cwd, versionFile);
  if (!fs.existsSync(rootManifestPath)) {
    throw new Error(`Versionary requires ${versionFile} to exist.`);
  }

  const rootRaw = fs.readFileSync(rootManifestPath, "utf8");
  const parsedRoot = parseCargoManifest(versionFile, rootRaw);
  const rootIsCrate = parsedRoot.packageTable !== null;
  const rootDir = path.dirname(rootManifestPath);
  const workspaceMembers = resolveWorkspaceMemberManifests(
    rootDir,
    parsedRoot.workspaceTable,
  );

  if (rootIsCrate) {
    const relRoot = normalizeSlashPath(path.relative(cwd, rootManifestPath));
    return [...new Set([relRoot, ...workspaceMembers])].sort((a, b) =>
      a.localeCompare(b),
    );
  }

  if (workspaceMembers.length > 0) {
    return workspaceMembers;
  }

  throw new Error(
    `Configured rust target "${versionFile}" is not a Rust crate manifest. Expected [package].version or [workspace].members with crate Cargo.toml files.`,
  );
}

function readCargoVersion(cargoTomlRaw: string, versionFile: string): string {
  const { packageTable } = parseCargoManifest(versionFile, cargoTomlRaw);
  if (!packageTable || typeof packageTable !== "object") {
    throw new Error(
      `${versionFile} is missing [package].version. Add [package] with a SemVer version.`,
    );
  }

  const rawVersion = (packageTable as { version?: unknown }).version;
  if (rawVersion === undefined) {
    throw new Error(
      `${versionFile} is missing [package].version. Add [package] with a SemVer version.`,
    );
  }
  if (typeof rawVersion !== "string" || rawVersion.trim().length === 0) {
    throw new Error(
      `${versionFile} has invalid [package].version. Expected a non-empty SemVer string.`,
    );
  }

  return rawVersion.trim();
}

function readCargoPackageName(
  cargoTomlRaw: string,
  versionFile: string,
): string {
  const { packageTable } = parseCargoManifest(versionFile, cargoTomlRaw);
  if (!packageTable || typeof packageTable !== "object") {
    throw new Error(
      `${versionFile} is missing [package].name. Add [package] with a crate name.`,
    );
  }

  const rawName = (packageTable as { name?: unknown }).name;
  if (typeof rawName !== "string" || rawName.trim().length === 0) {
    throw new Error(
      `${versionFile} has invalid [package].name. Expected a non-empty crate name.`,
    );
  }

  return rawName.trim();
}

function writeCargoVersion(
  cargoTomlRaw: string,
  versionFile: string,
  version: string,
): string {
  const lineEnding = cargoTomlRaw.includes("\r\n") ? "\r\n" : "\n";
  const hasFinalLineEnding =
    cargoTomlRaw.endsWith("\n") || cargoTomlRaw.endsWith("\r\n");
  const lines = cargoTomlRaw.split(/\r?\n/u);
  let inPackageSection = false;
  let foundPackageSection = false;
  let replacedVersion = false;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    const sectionMatch = line.match(/^\s*\[([^\]]+)\]\s*(?:#.*)?$/u);
    if (sectionMatch) {
      const section = sectionMatch[1]?.trim();
      inPackageSection = section === "package";
      if (inPackageSection) {
        foundPackageSection = true;
      }
      continue;
    }

    if (!inPackageSection) {
      continue;
    }

    const versionMatch = line.match(
      /^(\s*version\s*=\s*)(["'])([^"']*)(\2)(\s*(?:#.*)?)?$/u,
    );
    if (!versionMatch) {
      continue;
    }

    const [, prefix = "", quote = '"', , , suffix = ""] = versionMatch;
    lines[index] = `${prefix}${quote}${version}${quote}${suffix}`;
    replacedVersion = true;
    break;
  }

  if (!foundPackageSection) {
    throw new Error(
      `${versionFile} is missing [package].version. Add [package] with a SemVer version.`,
    );
  }
  if (!replacedVersion) {
    throw new Error(
      `${versionFile} is missing [package].version. Add [package] with a SemVer version.`,
    );
  }

  let updated = lines.join(lineEnding);
  if (hasFinalLineEnding && !updated.endsWith(lineEnding)) {
    updated += lineEnding;
  }
  if (!hasFinalLineEnding && updated.endsWith(lineEnding)) {
    updated = updated.slice(0, -lineEnding.length);
  }

  return updated;
}

function isDependencySection(section: string): boolean {
  if (ROOT_DEPENDENCY_SECTIONS.has(section)) {
    return true;
  }

  if (!section.startsWith("target.")) {
    return false;
  }

  return (
    section.endsWith(".dependencies") ||
    section.endsWith(".dev-dependencies") ||
    section.endsWith(".build-dependencies")
  );
}

function parseDependencyName(line: string): string | null {
  const match = line.match(/^\s*(?:"([^"]+)"|'([^']+)'|([A-Za-z0-9_-]+))\s*=/u);
  return match?.[1] ?? match?.[2] ?? match?.[3] ?? null;
}

function writeInternalDependencyVersionInLine(
  line: string,
  dependencyName: string,
  internalCrates: Set<string>,
  version: string,
): string {
  if (!internalCrates.has(dependencyName)) {
    return line;
  }

  const stringVersionMatch = line.match(
    /^(\s*(?:"[^"]+"|'[^']+'|[A-Za-z0-9_-]+)\s*=\s*)(["'])([^"']*)(\2)(\s*(?:#.*)?)?$/u,
  );
  if (stringVersionMatch) {
    const [, prefix = "", quote = '"', , , suffix = ""] = stringVersionMatch;
    return `${prefix}${quote}${version}${quote}${suffix}`;
  }

  const inlineTableMatch = line.match(
    /^(\s*(?:"[^"]+"|'[^']+'|[A-Za-z0-9_-]+)\s*=\s*\{)(.*)(\}\s*(?:#.*)?)$/u,
  );
  if (!inlineTableMatch) {
    return line;
  }

  const [, prefix = "", tableBody = "", suffix = ""] = inlineTableMatch;
  const updatedTableBody = tableBody.replace(
    /(\bversion\s*=\s*)(["'])([^"']*)(\2)/u,
    `$1$2${version}$4`,
  );

  if (updatedTableBody === tableBody) {
    return line;
  }

  return `${prefix}${updatedTableBody}${suffix}`;
}

function writeInternalDependencyVersions(
  cargoTomlRaw: string,
  internalCrates: Set<string>,
  version: string,
): string {
  if (internalCrates.size === 0) {
    return cargoTomlRaw;
  }

  const lineEnding = cargoTomlRaw.includes("\r\n") ? "\r\n" : "\n";
  const hasFinalLineEnding =
    cargoTomlRaw.endsWith("\n") || cargoTomlRaw.endsWith("\r\n");
  const lines = cargoTomlRaw.split(/\r?\n/u);

  let currentSection: string | null = null;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    const sectionMatch = line.match(/^\s*\[([^\]]+)\]\s*(?:#.*)?$/u);
    if (sectionMatch) {
      currentSection = sectionMatch[1]?.trim() ?? null;
      continue;
    }

    if (!currentSection || !isDependencySection(currentSection)) {
      continue;
    }

    const dependencyName = parseDependencyName(line);
    if (!dependencyName) {
      continue;
    }

    lines[index] = writeInternalDependencyVersionInLine(
      line,
      dependencyName,
      internalCrates,
      version,
    );
  }

  let updated = lines.join(lineEnding);
  if (hasFinalLineEnding && !updated.endsWith(lineEnding)) {
    updated += lineEnding;
  }
  if (!hasFinalLineEnding && updated.endsWith(lineEnding)) {
    updated = updated.slice(0, -lineEnding.length);
  }

  return updated;
}

export const rustVersionStrategy: VersionStrategy = {
  name: "rust",
  getVersionFile(config: VersionaryConfig): string {
    return config["version-file"] ?? "Cargo.toml";
  },
  readVersion(cwd: string, config: VersionaryConfig): string {
    const versionFile = this.getVersionFile(config);
    const manifests = collectRustTargetManifests(cwd, versionFile);
    const selectedManifest = manifests[0];
    if (!selectedManifest) {
      throw new Error(
        `Configured rust target "${versionFile}" did not resolve to a Rust crate manifest.`,
      );
    }
    const cargoTomlRaw = fs.readFileSync(
      path.join(cwd, selectedManifest),
      "utf8",
    );
    return readCargoVersion(cargoTomlRaw, selectedManifest);
  },
  writeVersion(
    cwd: string,
    config: VersionaryConfig,
    version: string,
  ): string[] {
    const versionFile = this.getVersionFile(config);
    const manifests = collectRustTargetManifests(cwd, versionFile);
    const updatedFiles: string[] = [];
    const internalCrates = new Set<string>();

    for (const manifest of manifests) {
      const versionPath = path.join(cwd, manifest);
      if (!fs.existsSync(versionPath)) {
        continue;
      }
      const cargoTomlRaw = fs.readFileSync(versionPath, "utf8");
      if (!isCrateManifest(manifest, cargoTomlRaw)) {
        continue;
      }
      internalCrates.add(readCargoPackageName(cargoTomlRaw, manifest));
    }

    for (const manifest of manifests) {
      const versionPath = path.join(cwd, manifest);
      if (!fs.existsSync(versionPath)) {
        continue;
      }
      const cargoTomlRaw = fs.readFileSync(versionPath, "utf8");
      if (!isCrateManifest(manifest, cargoTomlRaw)) {
        continue;
      }
      readCargoVersion(cargoTomlRaw, manifest);
      const updatedCargoToml = writeInternalDependencyVersions(
        writeCargoVersion(cargoTomlRaw, manifest, version),
        internalCrates,
        version,
      );
      fs.writeFileSync(versionPath, updatedCargoToml, "utf8");
      updatedFiles.push(manifest);
    }

    if (updatedFiles.length === 0) {
      throw new Error(
        `Configured rust target "${versionFile}" did not resolve to a Rust crate manifest to update.`,
      );
    }

    return updatedFiles.sort((a, b) => a.localeCompare(b));
  },
};
