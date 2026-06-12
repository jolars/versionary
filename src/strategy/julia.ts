import fs from "node:fs";
import path from "node:path";
import { parse as parseToml } from "smol-toml";
import type { VersionaryConfig } from "../types/config.js";
import type { VersionStrategy } from "./types.js";

function parseProjectToml(
  content: string,
  versionFile: string,
): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = parseToml(content);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to parse ${versionFile}: ${message}`);
  }
  if (parsed && typeof parsed === "object") {
    return parsed as Record<string, unknown>;
  }
  throw new Error(`Failed to parse ${versionFile}: not a TOML table.`);
}

function readProjectVersion(content: string, versionFile: string): string {
  const parsed = parseProjectToml(content, versionFile);
  const version = parsed.version;
  if (typeof version === "string" && version.trim().length > 0) {
    return version.trim();
  }
  throw new Error(
    `${versionFile} is missing a valid root "version" field required by release-type "julia".`,
  );
}

function writeProjectVersion(
  rawContent: string,
  versionFile: string,
  version: string,
): string {
  const lineEnding = rawContent.includes("\r\n") ? "\r\n" : "\n";
  const hasFinalLineEnding =
    rawContent.endsWith("\n") || rawContent.endsWith("\r\n");
  const lines = rawContent.split(/\r?\n/u);
  let activeTable: string | null = null;
  let replaced = false;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    const sectionMatch = line.match(/^\s*\[([^\]]+)\]\s*(?:#.*)?$/u);
    if (sectionMatch) {
      activeTable = sectionMatch[1]?.trim() ?? null;
      continue;
    }
    // The Julia version is a root key: only match before the first table header.
    if (activeTable !== null) {
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
    replaced = true;
    break;
  }

  if (!replaced) {
    throw new Error(
      `${versionFile} is missing a valid root "version" field required by release-type "julia".`,
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

export const juliaVersionStrategy: VersionStrategy = {
  name: "julia",
  getVersionFile(config: VersionaryConfig): string {
    return config["version-file"] ?? "Project.toml";
  },
  validateProject(cwd: string, config: VersionaryConfig): string | null {
    const versionFile = this.getVersionFile(config);
    const versionPath = path.join(cwd, versionFile);
    if (!fs.existsSync(versionPath)) {
      return null;
    }
    try {
      readProjectVersion(fs.readFileSync(versionPath, "utf8"), versionFile);
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
    return readProjectVersion(
      fs.readFileSync(versionPath, "utf8"),
      versionFile,
    );
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
    const updated = writeProjectVersion(existing, versionFile, version);
    fs.writeFileSync(versionPath, updated, "utf8");
    return [versionFile];
  },
  readPackageName(cwd: string, config: VersionaryConfig): string | null {
    const versionFile = this.getVersionFile(config);
    const versionPath = path.join(cwd, versionFile);
    if (!fs.existsSync(versionPath)) {
      throw new Error(`Versionary requires ${versionFile} to exist.`);
    }
    const parsed = parseProjectToml(
      fs.readFileSync(versionPath, "utf8"),
      versionFile,
    );
    const name = parsed.name;
    if (typeof name === "string" && name.trim().length > 0) {
      return name.trim();
    }
    return null;
  },
};
