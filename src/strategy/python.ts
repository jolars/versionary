import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import TOML from "@iarna/toml";
import type { VersionaryConfig } from "../types/config.js";
import type {
  StrategyFinalizeContext,
  StrategyVersionWriteContext,
  VersionStrategy,
} from "./types.js";

const SOURCE_FILE_VERSION_PATTERN =
  /^(\s*__version__\s*=\s*)(["'])([^"']+)(\2)(\s*(?:#.*)?)?$/mu;

interface PyProjectVersionLookup {
  projectVersion: string | null;
  poetryVersion: string | null;
}

interface ParsedPyProject {
  project: Record<string, unknown> | null;
  toolPoetry: Record<string, unknown> | null;
}

function isSourceFileMode(versionFile: string): boolean {
  return versionFile.toLowerCase().endsWith(".py");
}

function parsePyProject(content: string, versionFile: string): ParsedPyProject {
  let parsed: unknown;
  try {
    parsed = TOML.parse(content);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to parse ${versionFile}: ${message}`);
  }
  const root = parsed as {
    project?: unknown;
    tool?: { poetry?: unknown } | undefined;
  };
  const project =
    root.project && typeof root.project === "object"
      ? (root.project as Record<string, unknown>)
      : null;
  const toolPoetry =
    root.tool &&
    typeof root.tool === "object" &&
    "poetry" in root.tool &&
    typeof (root.tool as { poetry?: unknown }).poetry === "object" &&
    (root.tool as { poetry?: unknown }).poetry !== null
      ? ((root.tool as { poetry: Record<string, unknown> }).poetry as Record<
          string,
          unknown
        >)
      : null;
  return { project, toolPoetry };
}

function lookupPyProjectVersions(
  parsed: ParsedPyProject,
): PyProjectVersionLookup {
  const projectVersionRaw = parsed.project?.version;
  const poetryVersionRaw = parsed.toolPoetry?.version;
  return {
    projectVersion:
      typeof projectVersionRaw === "string" &&
      projectVersionRaw.trim().length > 0
        ? projectVersionRaw.trim()
        : null,
    poetryVersion:
      typeof poetryVersionRaw === "string" && poetryVersionRaw.trim().length > 0
        ? poetryVersionRaw.trim()
        : null,
  };
}

function readPyProjectVersion(content: string, versionFile: string): string {
  const parsed = parsePyProject(content, versionFile);
  const { projectVersion, poetryVersion } = lookupPyProjectVersions(parsed);
  const version = projectVersion ?? poetryVersion;
  if (!version) {
    throw new Error(
      `${versionFile} is missing a valid "[project].version" or "[tool.poetry].version" field required by release-type "python".`,
    );
  }
  return version;
}

function replaceVersionInTable(
  rawContent: string,
  targetTables: ReadonlySet<string>,
  version: string,
): { content: string; replaced: Set<string> } {
  const lineEnding = rawContent.includes("\r\n") ? "\r\n" : "\n";
  const hasFinalLineEnding =
    rawContent.endsWith("\n") || rawContent.endsWith("\r\n");
  const lines = rawContent.split(/\r?\n/u);
  const replaced = new Set<string>();
  let activeTable: string | null = null;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    const sectionMatch = line.match(/^\s*\[([^\]]+)\]\s*(?:#.*)?$/u);
    if (sectionMatch) {
      activeTable = sectionMatch[1]?.trim() ?? null;
      continue;
    }
    if (!activeTable || !targetTables.has(activeTable)) {
      continue;
    }
    if (replaced.has(activeTable)) {
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
    replaced.add(activeTable);
  }

  let updated = lines.join(lineEnding);
  if (hasFinalLineEnding && !updated.endsWith(lineEnding)) {
    updated += lineEnding;
  }
  if (!hasFinalLineEnding && updated.endsWith(lineEnding)) {
    updated = updated.slice(0, -lineEnding.length);
  }
  return { content: updated, replaced };
}

function writePyProjectVersion(
  rawContent: string,
  versionFile: string,
  version: string,
): string {
  const parsed = parsePyProject(rawContent, versionFile);
  const { projectVersion, poetryVersion } = lookupPyProjectVersions(parsed);
  if (!projectVersion && !poetryVersion) {
    throw new Error(
      `${versionFile} is missing a valid "[project].version" or "[tool.poetry].version" field required by release-type "python".`,
    );
  }
  const targets = new Set<string>();
  if (projectVersion) {
    targets.add("project");
  }
  if (poetryVersion) {
    targets.add("tool.poetry");
  }
  const { content, replaced } = replaceVersionInTable(
    rawContent,
    targets,
    version,
  );
  for (const target of targets) {
    if (!replaced.has(target)) {
      throw new Error(
        `Failed to update [${target}].version in ${versionFile}; ensure the version line uses the form \`version = "X.Y.Z"\`.`,
      );
    }
  }
  return content;
}

function readSourceFileVersion(content: string, versionFile: string): string {
  const match = content.match(SOURCE_FILE_VERSION_PATTERN);
  if (!match?.[3]) {
    throw new Error(
      `${versionFile} is missing a valid \`__version__ = "X.Y.Z"\` assignment required by release-type "python".`,
    );
  }
  return match[3].trim();
}

function writeSourceFileVersion(
  content: string,
  versionFile: string,
  version: string,
): string {
  if (!SOURCE_FILE_VERSION_PATTERN.test(content)) {
    throw new Error(
      `${versionFile} is missing a valid \`__version__ = "X.Y.Z"\` assignment required by release-type "python".`,
    );
  }
  return content.replace(
    SOURCE_FILE_VERSION_PATTERN,
    (
      _full,
      prefix: string,
      quote: string,
      _value: string,
      _close: string,
      suffix = "",
    ) => `${prefix}${quote}${version}${quote}${suffix ?? ""}`,
  );
}

interface LockfileSpec {
  lockfile: string;
  command: string;
  args: readonly string[];
  installHint: string;
}

const LOCKFILE_SPECS: readonly LockfileSpec[] = [
  {
    lockfile: "poetry.lock",
    command: "poetry",
    args: ["lock", "--no-update"],
    installHint: "install Poetry (https://python-poetry.org/)",
  },
  {
    lockfile: "uv.lock",
    command: "uv",
    args: ["lock"],
    installHint: "install uv (https://docs.astral.sh/uv/)",
  },
  {
    lockfile: "pdm.lock",
    command: "pdm",
    args: ["lock", "--update-reuse"],
    installHint: "install PDM (https://pdm-project.org/)",
  },
];

function refreshLockfile(cwd: string, spec: LockfileSpec): void {
  try {
    execFileSync(spec.command, [...spec.args], {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Failed to refresh ${spec.lockfile} via "${spec.command} ${spec.args.join(" ")}". Ensure ${spec.command} is on PATH (${spec.installHint}) or remove ${spec.lockfile} from the working tree. Details: ${message}`,
    );
  }
}

function readPyProjectFromCwd(
  cwd: string,
): { parsed: ParsedPyProject; rawPath: string } | null {
  const target = path.join(cwd, "pyproject.toml");
  if (!fs.existsSync(target)) {
    return null;
  }
  const content = fs.readFileSync(target, "utf8");
  return { parsed: parsePyProject(content, "pyproject.toml"), rawPath: target };
}

export const pythonVersionStrategy: VersionStrategy = {
  name: "python",
  getVersionFile(config: VersionaryConfig): string {
    return config["version-file"] ?? "pyproject.toml";
  },
  validateProject(cwd: string, config: VersionaryConfig): string | null {
    const versionFile = this.getVersionFile(config);
    const versionPath = path.join(cwd, versionFile);
    if (!fs.existsSync(versionPath)) {
      return null;
    }
    try {
      const content = fs.readFileSync(versionPath, "utf8");
      if (isSourceFileMode(versionFile)) {
        readSourceFileVersion(content, versionFile);
      } else {
        readPyProjectVersion(content, versionFile);
      }
      return null;
    } catch (error: unknown) {
      return error instanceof Error ? error.message : String(error);
    }
  },
  readVersion(cwd: string, config: VersionaryConfig): string {
    const versionFile = this.getVersionFile(config);
    const versionPath = path.join(cwd, versionFile);
    if (!fs.existsSync(versionPath)) {
      throw new Error(`Versionary requires ${versionFile} to exist.`);
    }
    const content = fs.readFileSync(versionPath, "utf8");
    return isSourceFileMode(versionFile)
      ? readSourceFileVersion(content, versionFile)
      : readPyProjectVersion(content, versionFile);
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
    const existing = fs.readFileSync(versionPath, "utf8");
    const updated = isSourceFileMode(versionFile)
      ? writeSourceFileVersion(existing, versionFile, version)
      : writePyProjectVersion(existing, versionFile, version);
    fs.writeFileSync(versionPath, updated, "utf8");
    return [versionFile];
  },
  readPackageName(cwd: string, _config: VersionaryConfig): string | null {
    const found = readPyProjectFromCwd(cwd);
    if (!found) {
      return null;
    }
    const projectName = found.parsed.project?.name;
    if (typeof projectName === "string" && projectName.trim().length > 0) {
      return projectName.trim();
    }
    const poetryName = found.parsed.toolPoetry?.name;
    if (typeof poetryName === "string" && poetryName.trim().length > 0) {
      return poetryName.trim();
    }
    return null;
  },
  finalizeVersionWrites(
    cwd: string,
    _writes: StrategyVersionWriteContext[],
    _context: StrategyFinalizeContext,
  ): string[] {
    const refreshed: string[] = [];
    for (const spec of LOCKFILE_SPECS) {
      const lockPath = path.join(cwd, spec.lockfile);
      if (!fs.existsSync(lockPath)) {
        continue;
      }
      refreshLockfile(cwd, spec);
      refreshed.push(spec.lockfile);
    }
    return refreshed.sort((a, b) => a.localeCompare(b));
  },
};
