import fs from "node:fs";
import path from "node:path";
import { parse as parseToml } from "@iarna/toml";
import { parse as parseJsonc } from "jsonc-parser";
import type {
  ConfigFileFormat,
  LoadedConfig,
  VersionaryConfig,
} from "../types/config.js";
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

  throw new Error(
    "JavaScript config loading is not implemented yet. Use JSONC/JSON/TOML for now.",
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function findConfigFile(
  cwd: string,
): { path: string; format: ConfigFileFormat } | null {
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
  if (!isRecord(parsed)) {
    throw new Error("Invalid config: expected an object at the root.");
  }
  const validated = configSchema.parse(parsed) as VersionaryConfig;

  return {
    path: found.path,
    format: found.format,
    config: validated,
  };
}
