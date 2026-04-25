import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import TOML from "@iarna/toml";
import type { VersionaryConfig } from "../types/config.js";
import type {
  StrategyFinalizeContext,
  StrategyPackagePlanContext,
  StrategyVersionWriteContext,
  VersionStrategy,
} from "./types.js";

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

function collectAllCrateManifests(cwd: string): string[] {
  const manifests: string[] = [];
  const cargoDirs = findCargoManifestDirectories(cwd);
  for (const dir of cargoDirs) {
    const manifest =
      dir === "."
        ? "Cargo.toml"
        : normalizeSlashPath(path.posix.join(dir, "Cargo.toml"));
    const manifestPath = path.join(cwd, manifest);
    if (!fs.existsSync(manifestPath)) {
      continue;
    }
    const cargoTomlRaw = fs.readFileSync(manifestPath, "utf8");
    if (!isCrateManifest(manifest, cargoTomlRaw)) {
      continue;
    }
    manifests.push(manifest);
  }
  return manifests.sort((a, b) => a.localeCompare(b));
}

function listCargoLockFiles(cwd: string): string[] {
  const lockfiles: string[] = [];
  const queue: string[] = [cwd];

  while (queue.length > 0) {
    const currentDir = queue.shift();
    if (!currentDir) {
      continue;
    }
    const entries = fs.readdirSync(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name === ".git") {
        continue;
      }
      const fullPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        queue.push(fullPath);
        continue;
      }
      if (!entry.isFile() || entry.name !== "Cargo.lock") {
        continue;
      }
      lockfiles.push(normalizeSlashPath(path.relative(cwd, fullPath)));
    }
  }

  return lockfiles.sort((a, b) => a.localeCompare(b));
}

function ensureCargoLockUpToDate(cwd: string): string[] {
  const lockfiles = listCargoLockFiles(cwd);
  if (lockfiles.length === 0) {
    return [];
  }

  const updatedLockfiles: string[] = [];
  for (const lockfile of lockfiles) {
    const lockfilePath = path.join(cwd, lockfile);
    const before = fs.readFileSync(lockfilePath, "utf8");
    try {
      execFileSync("cargo", ["generate-lockfile"], {
        cwd: path.dirname(lockfilePath),
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(
        `Failed to refresh ${lockfile} via "cargo generate-lockfile". Ensure cargo is installed and available in PATH. Details: ${message}`,
      );
    }
    const after = fs.readFileSync(lockfilePath, "utf8");
    if (after !== before) {
      updatedLockfiles.push(lockfile);
    }
  }

  return updatedLockfiles;
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
  includeWorkspaceMembers: boolean,
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
  const augmentingMembers = includeWorkspaceMembers
    ? resolveWorkspaceMemberManifests(rootDir, parsedRoot.workspaceTable)
    : [];

  if (rootIsCrate) {
    const relRoot = normalizeSlashPath(path.relative(cwd, rootManifestPath));
    return [...new Set([relRoot, ...augmentingMembers])].sort((a, b) =>
      a.localeCompare(b),
    );
  }

  const fallbackMembers = includeWorkspaceMembers
    ? augmentingMembers
    : resolveWorkspaceMemberManifests(rootDir, parsedRoot.workspaceTable);
  if (fallbackMembers.length > 0) {
    return fallbackMembers;
  }

  const isWorkspaceOnly = parsedRoot.workspaceTable !== null;
  const detail = isWorkspaceOnly
    ? `Workspace root "${versionFile}" has no [workspace].members resolving to crate Cargo.toml files.`
    : `"${versionFile}" has neither [package] nor [workspace].`;
  throw new Error(
    `Configured rust target "${versionFile}" is not a Rust crate manifest. ${detail} Either remove the "packages" config so the workspace is auto-discovered, or point a package at a member crate path (e.g. "packages": { "crates/foo": {} }).`,
  );
}

function isWorkspaceInheritedVersion(rawVersion: unknown): boolean {
  if (!rawVersion || typeof rawVersion !== "object") {
    return false;
  }
  const versionRecord = rawVersion as Record<string, unknown>;
  return versionRecord.workspace === true;
}

function readWorkspacePackageVersion(
  cargoTomlRaw: string,
  versionFile: string,
): string {
  const { workspaceTable } = parseCargoManifest(versionFile, cargoTomlRaw);
  if (!workspaceTable || typeof workspaceTable !== "object") {
    throw new Error(
      `${versionFile} is missing [workspace.package].version required by members using version.workspace = true.`,
    );
  }
  const workspacePackage =
    workspaceTable.package && typeof workspaceTable.package === "object"
      ? (workspaceTable.package as Record<string, unknown>)
      : null;
  const rawVersion = workspacePackage?.version;
  if (typeof rawVersion !== "string" || rawVersion.trim().length === 0) {
    throw new Error(
      `${versionFile} is missing [workspace.package].version required by members using version.workspace = true.`,
    );
  }

  return rawVersion.trim();
}

function findWorkspaceManifestForMember(
  cwd: string,
  memberManifest: string,
): string {
  const cwdAbs = path.resolve(cwd);
  let currentDir = path.resolve(cwd, path.dirname(memberManifest));

  while (true) {
    const relativeDir = path.relative(cwdAbs, currentDir);
    if (relativeDir.startsWith("..")) {
      break;
    }

    const candidatePath = path.join(currentDir, "Cargo.toml");
    if (fs.existsSync(candidatePath)) {
      const relativeManifest = normalizeSlashPath(
        path.relative(cwdAbs, candidatePath),
      );
      const cargoTomlRaw = fs.readFileSync(candidatePath, "utf8");
      const parsed = parseCargoManifest(relativeManifest, cargoTomlRaw);
      if (parsed.workspaceTable) {
        return relativeManifest;
      }
    }

    if (currentDir === cwdAbs) {
      break;
    }
    const parentDir = path.dirname(currentDir);
    if (parentDir === currentDir) {
      break;
    }
    currentDir = parentDir;
  }

  throw new Error(
    `${memberManifest} uses version.workspace = true, but no workspace Cargo.toml with [workspace.package].version was found between that crate and repository root.`,
  );
}

function readResolvedCargoVersion(
  cwd: string,
  manifest: string,
  cargoTomlRaw: string,
): string {
  const { packageTable } = parseCargoManifest(manifest, cargoTomlRaw);
  if (!packageTable || typeof packageTable !== "object") {
    throw new Error(
      `${manifest} is missing [package].version. Add [package] with a SemVer version.`,
    );
  }
  const rawVersion = (packageTable as { version?: unknown }).version;
  if (rawVersion === undefined) {
    throw new Error(
      `${manifest} is missing [package].version. Add [package] with a SemVer version.`,
    );
  }
  if (typeof rawVersion === "string" && rawVersion.trim().length > 0) {
    return rawVersion.trim();
  }
  if (!isWorkspaceInheritedVersion(rawVersion)) {
    throw new Error(
      `${manifest} has invalid [package].version. Expected a non-empty SemVer string or version.workspace = true.`,
    );
  }

  const workspaceManifest = findWorkspaceManifestForMember(cwd, manifest);
  const workspaceRaw = fs.readFileSync(
    path.join(cwd, workspaceManifest),
    "utf8",
  );
  return readWorkspacePackageVersion(workspaceRaw, workspaceManifest);
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

function writeWorkspacePackageVersion(
  cargoTomlRaw: string,
  versionFile: string,
  version: string,
): string {
  const lineEnding = cargoTomlRaw.includes("\r\n") ? "\r\n" : "\n";
  const hasFinalLineEnding =
    cargoTomlRaw.endsWith("\n") || cargoTomlRaw.endsWith("\r\n");
  const lines = cargoTomlRaw.split(/\r?\n/u);
  let inWorkspacePackageSection = false;
  let foundWorkspacePackageSection = false;
  let replacedVersion = false;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    const sectionMatch = line.match(/^\s*\[([^\]]+)\]\s*(?:#.*)?$/u);
    if (sectionMatch) {
      const section = sectionMatch[1]?.trim();
      inWorkspacePackageSection = section === "workspace.package";
      if (inWorkspacePackageSection) {
        foundWorkspacePackageSection = true;
      }
      continue;
    }

    if (!inWorkspacePackageSection) {
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

  if (!foundWorkspacePackageSection || !replacedVersion) {
    throw new Error(
      `${versionFile} is missing [workspace.package].version required by members using version.workspace = true.`,
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

function usesWorkspaceInheritedVersion(
  cargoTomlRaw: string,
  versionFile: string,
): boolean {
  const { packageTable } = parseCargoManifest(versionFile, cargoTomlRaw);
  if (!packageTable || typeof packageTable !== "object") {
    return false;
  }
  const rawVersion = (packageTable as { version?: unknown }).version;
  return isWorkspaceInheritedVersion(rawVersion);
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

function rewriteCargoVersionRequirement(
  currentRequirement: string,
  nextVersion: string,
): string {
  const simpleRequirementMatch = currentRequirement.match(
    /^(\s*)(\^|~|>=|<=|>|<|=)?(\s*)([0-9A-Za-z.+-]+)(\s*)$/u,
  );
  if (!simpleRequirementMatch) {
    return nextVersion;
  }

  const [
    ,
    leadingWhitespace = "",
    operator = "",
    operatorWhitespace = "",
    ,
    trailingWhitespace = "",
  ] = simpleRequirementMatch;
  return `${leadingWhitespace}${operator}${operatorWhitespace}${nextVersion}${trailingWhitespace}`;
}

function writeInternalDependencyVersionInLine(
  line: string,
  dependencyName: string,
  versionByDependency: Map<string, string>,
): string {
  const nextVersion = versionByDependency.get(dependencyName);
  if (!nextVersion) {
    return line;
  }

  const stringVersionMatch = line.match(
    /^(\s*(?:"[^"]+"|'[^']+'|[A-Za-z0-9_-]+)\s*=\s*)(["'])([^"']*)(\2)(\s*(?:#.*)?)?$/u,
  );
  if (stringVersionMatch) {
    const [, prefix = "", quote = '"', current = "", , suffix = ""] =
      stringVersionMatch;
    const rewrittenRequirement = rewriteCargoVersionRequirement(
      current,
      nextVersion,
    );
    return `${prefix}${quote}${rewrittenRequirement}${quote}${suffix}`;
  }

  const inlineTableMatch = line.match(
    /^(\s*(?:"[^"]+"|'[^']+'|[A-Za-z0-9_-]+)\s*=\s*\{)(.*)(\}\s*(?:#.*)?)$/u,
  );
  if (inlineTableMatch) {
    const [, prefix = "", tableBody = "", suffix = ""] = inlineTableMatch;
    const updatedTableBody = tableBody.replace(
      /(\bversion\s*=\s*)(["'])([^"']*)(\2)/u,
      (_match, versionPrefix, quote, currentVersion) =>
        `${versionPrefix}${quote}${rewriteCargoVersionRequirement(
          String(currentVersion),
          nextVersion,
        )}${quote}`,
    );

    if (updatedTableBody === tableBody) {
      return line;
    }

    return `${prefix}${updatedTableBody}${suffix}`;
  }

  const updatedTableLine = line.replace(
    /(\bversion\s*=\s*)(["'])([^"']*)(\2)/u,
    (_match, versionPrefix, quote, currentVersion) =>
      `${versionPrefix}${quote}${rewriteCargoVersionRequirement(
        String(currentVersion),
        nextVersion,
      )}${quote}`,
  );
  if (updatedTableLine === line) {
    return line;
  }
  return updatedTableLine;
}

function writeInternalDependencyVersions(
  cargoTomlRaw: string,
  internalCrates: Set<string>,
  version: string,
): string {
  if (internalCrates.size === 0) {
    return cargoTomlRaw;
  }
  const versionByDependency = new Map<string, string>();
  for (const crateName of internalCrates) {
    versionByDependency.set(crateName, version);
  }
  return writeMappedDependencyVersions(cargoTomlRaw, versionByDependency);
}

function writeMappedDependencyVersions(
  cargoTomlRaw: string,
  versionByDependency: Map<string, string>,
): string {
  if (versionByDependency.size === 0) {
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
      versionByDependency,
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

function readPackageNameForManifest(cwd: string, manifest: string): string {
  const manifestPath = path.join(cwd, manifest);
  const cargoTomlRaw = fs.readFileSync(manifestPath, "utf8");
  if (!isCrateManifest(manifest, cargoTomlRaw)) {
    throw new Error(
      `Configured rust target "${manifest}" is not a Rust crate manifest to update.`,
    );
  }
  return readCargoPackageName(cargoTomlRaw, manifest);
}

export function applyRustWorkspaceDependencyUpdates(
  cwd: string,
  manifestToVersion: Record<string, string>,
): string[] {
  const versionByDependency = new Map<string, string>();
  for (const [manifest, version] of Object.entries(manifestToVersion)) {
    if (!version) {
      continue;
    }
    const crateName = readPackageNameForManifest(cwd, manifest);
    versionByDependency.set(crateName, version);
  }
  if (versionByDependency.size === 0) {
    return [];
  }

  const updatedFiles: string[] = [];
  const manifests = collectAllCrateManifests(cwd);
  for (const manifest of manifests) {
    const manifestPath = path.join(cwd, manifest);
    if (!fs.existsSync(manifestPath)) {
      continue;
    }
    const cargoTomlRaw = fs.readFileSync(manifestPath, "utf8");
    if (!isCrateManifest(manifest, cargoTomlRaw)) {
      continue;
    }
    const next = writeMappedDependencyVersions(
      cargoTomlRaw,
      versionByDependency,
    );
    if (next !== cargoTomlRaw) {
      fs.writeFileSync(manifestPath, next, "utf8");
      updatedFiles.push(manifest);
    }
  }

  return updatedFiles;
}

export function detectRustDependencyImpact(
  cwd: string,
  manifestToVersion: Record<string, string>,
  candidateManifests: string[],
): string[] {
  const versionByDependency = new Map<string, string>();
  for (const [manifest, version] of Object.entries(manifestToVersion)) {
    if (!version) {
      continue;
    }
    const crateName = readPackageNameForManifest(cwd, manifest);
    versionByDependency.set(crateName, version);
  }
  if (versionByDependency.size === 0) {
    return [];
  }

  const impacted: string[] = [];
  for (const manifest of [...new Set(candidateManifests)].sort((a, b) =>
    a.localeCompare(b),
  )) {
    const manifestPath = path.join(cwd, manifest);
    if (!fs.existsSync(manifestPath)) {
      continue;
    }
    const cargoTomlRaw = fs.readFileSync(manifestPath, "utf8");
    if (!isCrateManifest(manifest, cargoTomlRaw)) {
      continue;
    }
    const next = writeMappedDependencyVersions(
      cargoTomlRaw,
      versionByDependency,
    );
    if (next !== cargoTomlRaw) {
      impacted.push(manifest);
    }
  }

  return impacted;
}

export function toCargoManifestPath(packagePath: string): string {
  return packagePath === "."
    ? "Cargo.toml"
    : normalizeSlashPath(path.posix.join(packagePath, "Cargo.toml"));
}

export const rustVersionStrategy: VersionStrategy = {
  name: "rust",
  getVersionFile(config: VersionaryConfig): string {
    return config["version-file"] ?? "Cargo.toml";
  },
  readVersion(cwd: string, config: VersionaryConfig): string {
    const versionFile = this.getVersionFile(config);
    const manifests = collectRustTargetManifests(
      cwd,
      versionFile,
      !config.packages,
    );
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
    return readResolvedCargoVersion(cwd, selectedManifest, cargoTomlRaw);
  },
  validateProject(cwd: string, config: VersionaryConfig): string | null {
    try {
      const versionFile = this.getVersionFile(config);
      const manifests = collectRustTargetManifests(
        cwd,
        versionFile,
        !config.packages,
      );
      const selectedManifest = manifests[0];
      if (!selectedManifest) {
        return null;
      }
      const versionPath = path.join(cwd, selectedManifest);
      if (!fs.existsSync(versionPath)) {
        return null;
      }
      const cargoTomlRaw = fs.readFileSync(versionPath, "utf8");
      readResolvedCargoVersion(cwd, selectedManifest, cargoTomlRaw);
      return null;
    } catch (error: unknown) {
      return error instanceof Error ? error.message : String(error);
    }
  },
  writeVersion(
    cwd: string,
    config: VersionaryConfig,
    version: string,
  ): string[] {
    const versionFile = this.getVersionFile(config);
    const manifests = collectRustTargetManifests(
      cwd,
      versionFile,
      !config.packages,
    );
    const updatedFiles: string[] = [];
    const internalCrates = new Set<string>();
    const workspaceManifestsToUpdate = new Set<string>();

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
      readResolvedCargoVersion(cwd, manifest, cargoTomlRaw);
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
      let updatedCargoToml = cargoTomlRaw;
      if (usesWorkspaceInheritedVersion(cargoTomlRaw, manifest)) {
        workspaceManifestsToUpdate.add(
          findWorkspaceManifestForMember(cwd, manifest),
        );
      } else {
        updatedCargoToml = writeCargoVersion(
          updatedCargoToml,
          manifest,
          version,
        );
      }
      updatedCargoToml = writeInternalDependencyVersions(
        updatedCargoToml,
        internalCrates,
        version,
      );
      if (updatedCargoToml !== cargoTomlRaw) {
        fs.writeFileSync(versionPath, updatedCargoToml, "utf8");
        updatedFiles.push(manifest);
      }
    }

    for (const workspaceManifest of workspaceManifestsToUpdate) {
      const workspacePath = path.join(cwd, workspaceManifest);
      if (!fs.existsSync(workspacePath)) {
        continue;
      }
      const workspaceRaw = fs.readFileSync(workspacePath, "utf8");
      const updatedWorkspaceToml = writeInternalDependencyVersions(
        writeWorkspacePackageVersion(workspaceRaw, workspaceManifest, version),
        internalCrates,
        version,
      );
      if (updatedWorkspaceToml !== workspaceRaw) {
        fs.writeFileSync(workspacePath, updatedWorkspaceToml, "utf8");
        updatedFiles.push(workspaceManifest);
      }
    }

    if (updatedFiles.length === 0) {
      throw new Error(
        `Configured rust target "${versionFile}" did not resolve to a Rust crate manifest to update.`,
      );
    }

    return updatedFiles.sort((a, b) => a.localeCompare(b));
  },
  readPackageName(cwd: string, config: VersionaryConfig): string | null {
    const versionFile = this.getVersionFile(config);
    const manifests = collectRustTargetManifests(
      cwd,
      versionFile,
      !config.packages,
    );
    const selectedManifest = manifests[0];
    if (!selectedManifest) {
      throw new Error(
        `Configured rust target "${versionFile}" did not resolve to a Rust crate manifest.`,
      );
    }
    const versionPath = path.join(cwd, selectedManifest);
    if (!fs.existsSync(versionPath)) {
      throw new Error(`Versionary requires ${selectedManifest} to exist.`);
    }
    const cargoTomlRaw = fs.readFileSync(versionPath, "utf8");
    if (!isCrateManifest(selectedManifest, cargoTomlRaw)) {
      return null;
    }
    return readCargoPackageName(cargoTomlRaw, selectedManifest);
  },
  propagateDependentPatchImpacts(
    cwd: string,
    packages: StrategyPackagePlanContext[],
  ): string[] {
    const manifestToVersion: Record<string, string> = {};
    const candidateManifests: string[] = [];
    const manifestToPath = new Map<string, string>();
    for (const pkg of packages) {
      const manifest = pkg.versionFile;
      candidateManifests.push(manifest);
      manifestToPath.set(manifest, pkg.packagePath);
      if (pkg.nextVersion) {
        manifestToVersion[manifest] = pkg.nextVersion;
      }
    }
    const impactedManifests = detectRustDependencyImpact(
      cwd,
      manifestToVersion,
      candidateManifests,
    );
    return impactedManifests
      .map((manifest) => manifestToPath.get(manifest))
      .filter((pkgPath): pkgPath is string => Boolean(pkgPath))
      .sort((a, b) => a.localeCompare(b));
  },
  finalizeVersionWrites(
    cwd: string,
    writes: StrategyVersionWriteContext[],
    _context: StrategyFinalizeContext,
  ): string[] {
    const manifestToVersion: Record<string, string> = {};
    for (const write of writes) {
      manifestToVersion[write.versionFile] = write.version;
    }
    return [
      ...applyRustWorkspaceDependencyUpdates(cwd, manifestToVersion),
      ...ensureCargoLockUpToDate(cwd),
    ];
  },
};
