import fs from "node:fs";
import path from "node:path";
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
];

function parseConfig(raw: string, format: ConfigFileFormat): unknown {
  if (format === "json" || format === "jsonc") {
    return parseJsonc(raw);
  }

  throw new Error(
    "Unsupported config format. Use versionary.jsonc or versionary.json.",
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
      "No Versionary config found. Create versionary.jsonc (preferred) or versionary.json.",
    );
  }

  const raw = fs.readFileSync(found.path, "utf8");
  const parsed = parseConfig(raw, found.format);
  if (!isRecord(parsed)) {
    throw new Error("Invalid config: expected an object at the root.");
  }
  if (Object.hasOwn(parsed, "plugins")) {
    throw new Error(
      'The "plugins" config key is no longer supported. Versionary uses built-in integrations only.',
    );
  }
  const validated = configSchema.parse(parsed) as VersionaryConfig;

  return {
    path: found.path,
    format: found.format,
    config: validated,
  };
}
