import fs from "node:fs";
import path from "node:path";
import { parse as parseToml } from "@iarna/toml";
import { parse as parseJsonc } from "jsonc-parser";
import type { ConfigFileFormat, LoadedConfig, VersionaryConfig } from "../types/config.js";
import { configSchema } from "./schema.js";

const SUPPORTED_FILES: Array<{ file: string; format: ConfigFileFormat }> = [
  { file: "versionary.jsonc", format: "jsonc" },
  { file: "versionary.json", format: "json" },
  { file: "versionary.toml", format: "toml" },
  { file: "versionary.js", format: "js" },
  { file: "versionary.config.jsonc", format: "jsonc" },
  { file: "versionary.config.json", format: "json" },
  { file: "versionary.config.toml", format: "toml" },
  { file: "versionary.config.js", format: "js" },
];

function parseConfig(raw: string, format: ConfigFileFormat): unknown {
  if (format === "json" || format === "jsonc") {
    return parseJsonc(raw);
  }

  if (format === "toml") {
    return parseToml(raw);
  }

  throw new Error("JavaScript config loading is not implemented yet. Use JSONC/JSON/TOML for now.");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizePluginRefs(raw: unknown): Array<{ name: string; options?: Record<string, unknown> }> | undefined {
  if (!Array.isArray(raw)) {
    return undefined;
  }

  const normalized: Array<{ name: string; options?: Record<string, unknown> }> = [];
  for (const entry of raw) {
    if (typeof entry === "string" && entry.trim().length > 0) {
      normalized.push({ name: entry.trim() });
      continue;
    }
    if (isRecord(entry) && typeof entry.name === "string" && entry.name.trim().length > 0) {
      const options = isRecord(entry.options) ? (entry.options as Record<string, unknown>) : undefined;
      normalized.push({ name: entry.name.trim(), options });
    }
  }

  return normalized.length > 0 ? normalized : undefined;
}

function normalizePackages(
  raw: unknown,
): Array<{
  path: string;
  strategy?: string;
  packageName?: string;
  excludePaths?: string[];
  artifacts?: Array<{ file: string; format: "json" | "toml" | "yaml" | "regex"; path?: string }>;
}> | undefined {
  type NormalizedArtifact = { file: string; format: "json" | "toml" | "yaml" | "regex"; path?: string };

  if (Array.isArray(raw)) {
    return undefined;
  }
  if (!isRecord(raw)) {
    return undefined;
  }

  const result: Array<{
    path: string;
    strategy?: string;
    packageName?: string;
    excludePaths?: string[];
    artifacts?: Array<{ file: string; format: "json" | "toml" | "yaml" | "regex"; path?: string }>;
  }> = [];

  for (const [pkgPath, value] of Object.entries(raw)) {
    if (!pkgPath || !isRecord(value)) {
      continue;
    }

    const excludePaths = Array.isArray(value["exclude-paths"])
      ? value["exclude-paths"].filter((item): item is string => typeof item === "string")
      : undefined;

    const extraFilesRaw = value["extra-files"];
    const artifacts: NormalizedArtifact[] = [];
    if (Array.isArray(extraFilesRaw)) {
      for (const item of extraFilesRaw) {
        if (!isRecord(item)) {
          continue;
        }
        const format =
          item.type === "json" || item.type === "toml" || item.type === "yaml" || item.type === "regex"
            ? item.type
            : undefined;
        const file = typeof item.path === "string" ? item.path : undefined;
        const jsonPath = typeof item.jsonpath === "string" ? item.jsonpath : undefined;
        if (!format || !file) {
          continue;
        }
        artifacts.push({
          file,
          format,
          path: jsonPath,
        });
      }
    }

    result.push({
      path: pkgPath,
      strategy: typeof value["release-type"] === "string" ? value["release-type"] : undefined,
      packageName: typeof value["package-name"] === "string" ? value["package-name"] : undefined,
      excludePaths: excludePaths && excludePaths.length > 0 ? excludePaths : undefined,
      artifacts: artifacts.length > 0 ? artifacts : undefined,
    });
  }

  return result.length > 0 ? result : undefined;
}

function normalizeConfigShape(parsed: unknown): unknown {
  if (!isRecord(parsed)) {
    return parsed;
  }

  const normalized: Record<string, unknown> = { ...parsed };

  const pluginConfigRaw = isRecord(parsed.pluginConfig) ? parsed.pluginConfig : {};
  const pluginConfigPlugins = normalizePluginRefs(pluginConfigRaw.plugins);
  const topLevelPlugins = normalizePluginRefs(parsed.plugins);
  if (pluginConfigPlugins) {
    normalized.pluginConfig = { ...pluginConfigRaw, plugins: pluginConfigPlugins };
  } else if (topLevelPlugins) {
    normalized.plugins = topLevelPlugins;
  }

  if (!isRecord(parsed.history) && typeof parsed["bootstrap-sha"] === "string") {
    normalized.history = { bootstrap: { sha: parsed["bootstrap-sha"] } };
  }

  if (!isRecord(parsed.defaults)) {
    normalized.defaults = {};
  }
  const defaults = isRecord(normalized.defaults) ? { ...normalized.defaults } : {};

  if (typeof parsed["bump-minor-pre-major"] === "boolean") {
    const versioning = isRecord(defaults.versioning) ? { ...defaults.versioning } : {};
    versioning.bumpMinorPreMajor = parsed["bump-minor-pre-major"];
    defaults.versioning = versioning;
  }

  if (typeof parsed["include-commit-authors"] === "boolean") {
    const changelog = isRecord(defaults.changelog) ? { ...defaults.changelog } : {};
    changelog.includeAuthors = parsed["include-commit-authors"];
    defaults.changelog = changelog;
  }

  if (typeof parsed["release-type"] === "string" && typeof defaults.strategy !== "string") {
    defaults.strategy = parsed["release-type"];
  }

  normalized.defaults = defaults;

  const normalizedPackages = normalizePackages(parsed.packages);
  if (normalizedPackages) {
    normalized.packages = normalizedPackages;
  }

  return normalized;
}

export function findConfigFile(cwd: string): { path: string; format: ConfigFileFormat } | null {
  for (const candidate of SUPPORTED_FILES) {
    const candidatePath = path.join(cwd, candidate.file);
    if (fs.existsSync(candidatePath)) {
      return { path: candidatePath, format: candidate.format };
    }
  }

  return null;
}

export function loadConfig(cwd = process.cwd()): LoadedConfig {
  const found = findConfigFile(cwd);
  if (!found) {
    throw new Error(
      "No Versionary config found. Create versionary.jsonc (preferred), .json, or .toml.",
    );
  }

  const raw = fs.readFileSync(found.path, "utf8");
  const parsed = parseConfig(raw, found.format);
  const normalized = normalizeConfigShape(parsed);
  const validated = configSchema.parse(normalized) as VersionaryConfig;

  return {
    path: found.path,
    format: found.format,
    config: validated,
  };
}
