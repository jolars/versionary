import fs from "node:fs";
import path from "node:path";
import TOML from "@iarna/toml";
import YAML from "yaml";
import type { SimplePlan } from "../../domain/release/plan.js";
import type {
  VersionaryArtifactRule,
  VersionaryConfig,
  VersionaryPackage,
} from "../../types/config.js";

type JsonPathToken = string | number;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function parseJsonPath(jsonpath: string): JsonPathToken[] {
  if (!jsonpath.startsWith("$")) {
    throw new Error(`Invalid jsonpath "${jsonpath}". Must start with "$".`);
  }
  const tokens: JsonPathToken[] = [];
  let index = 1;

  while (index < jsonpath.length) {
    const current = jsonpath[index];
    if (current === ".") {
      const keyMatch = jsonpath.slice(index + 1).match(/^[A-Za-z0-9_-]+/u);
      if (!keyMatch) {
        throw new Error(`Invalid jsonpath "${jsonpath}" near index ${index}.`);
      }
      tokens.push(keyMatch[0]);
      index += 1 + keyMatch[0].length;
      continue;
    }
    if (current === "[") {
      const rest = jsonpath.slice(index + 1);
      const numberMatch = rest.match(/^(\d+)\]/u);
      if (numberMatch) {
        tokens.push(Number(numberMatch[1]));
        index += 2 + numberMatch[1]!.length;
        continue;
      }
      const keyMatch = rest.match(/^"([^"]+)"\]/u);
      if (keyMatch) {
        tokens.push(keyMatch[1]!);
        index += 4 + keyMatch[1]!.length;
        continue;
      }
      throw new Error(`Invalid jsonpath "${jsonpath}" near index ${index}.`);
    }
    throw new Error(`Invalid jsonpath "${jsonpath}" near index ${index}.`);
  }

  if (tokens.length === 0) {
    throw new Error(
      `Invalid jsonpath "${jsonpath}". Path must target a field.`,
    );
  }
  return tokens;
}

function setVersionAtJsonPath(
  document: unknown,
  jsonpath: string,
  version: string,
): void {
  const tokens = parseJsonPath(jsonpath);
  let cursor: unknown = document;

  for (let index = 0; index < tokens.length - 1; index += 1) {
    const token = tokens[index]!;
    if (typeof token === "number") {
      if (!Array.isArray(cursor) || token >= cursor.length) {
        throw new Error(
          `jsonpath "${jsonpath}" does not resolve to an existing field.`,
        );
      }
      cursor = cursor[token];
      continue;
    }
    if (!isRecord(cursor) || !(token in cursor)) {
      throw new Error(
        `jsonpath "${jsonpath}" does not resolve to an existing field.`,
      );
    }
    cursor = cursor[token];
  }

  const leaf = tokens.at(-1)!;
  if (typeof leaf === "number") {
    if (!Array.isArray(cursor) || leaf >= cursor.length) {
      throw new Error(
        `jsonpath "${jsonpath}" does not resolve to an existing field.`,
      );
    }
    const current = cursor[leaf];
    if (typeof current !== "string" && typeof current !== "number") {
      throw new Error(
        `jsonpath "${jsonpath}" must point to a string or number field for version updates.`,
      );
    }
    cursor[leaf] = version;
    return;
  }

  if (!isRecord(cursor) || !(leaf in cursor)) {
    throw new Error(
      `jsonpath "${jsonpath}" does not resolve to an existing field.`,
    );
  }
  const current = cursor[leaf];
  if (typeof current !== "string" && typeof current !== "number") {
    throw new Error(
      `jsonpath "${jsonpath}" must point to a string or number field for version updates.`,
    );
  }
  cursor[leaf] = version;
}

function parseRegexPattern(pattern: string): RegExp {
  const slashPattern = pattern.match(/^\/((?:\\\/|[^/])+)\/([a-z]*)$/u);
  if (slashPattern) {
    return new RegExp(slashPattern[1]!, slashPattern[2]!);
  }
  return new RegExp(pattern, "m");
}

function applyRegexRule(
  content: string,
  pattern: string,
  version: string,
): string {
  const regex = parseRegexPattern(pattern);
  const matchFlags = regex.flags.includes("g")
    ? regex.flags
    : `${regex.flags}g`;
  const globalRegex = new RegExp(regex.source, matchFlags);
  const matches = [...content.matchAll(globalRegex)];
  if (matches.length !== 1) {
    throw new Error(
      `Regex pattern must match exactly one occurrence; matched ${matches.length}.`,
    );
  }
  const match = matches[0]!;
  const start = match.index;
  if (start === undefined) {
    throw new Error("Regex match did not include an index.");
  }
  const full = match[0];
  const groupOne = match[1];
  const replacement =
    typeof groupOne === "string" ? full.replace(groupOne, version) : version;
  return `${content.slice(0, start)}${replacement}${content.slice(start + full.length)}`;
}

function applyTomlRulePreservingFormatting(
  content: string,
  jsonpath: string,
  version: string,
): string {
  const simplePath = jsonpath.match(/^\$\.([A-Za-z0-9_-]+)$/u);
  if (!simplePath) {
    const parsed = TOML.parse(content) as unknown;
    setVersionAtJsonPath(parsed, jsonpath, version);
    return `${TOML.stringify(parsed as TOML.JsonMap)}\n`;
  }

  const key = simplePath[1]!;
  const linePattern = new RegExp(
    `^(\\s*${key}\\s*=\\s*)(["'])([^"']*)(\\2)(\\s*(?:#.*)?)$`,
    "mu",
  );
  const match = content.match(linePattern);
  if (!match) {
    throw new Error(
      `jsonpath "${jsonpath}" does not resolve to an existing field.`,
    );
  }
  const [, prefix = "", quote = '"', , , suffix = ""] = match;
  return content.replace(
    linePattern,
    `${prefix}${quote}${version}${quote}${suffix}`,
  );
}

function applyArtifactRuleToContent(
  content: string,
  rule: VersionaryArtifactRule,
  version: string,
): string {
  if (rule.type === "regex") {
    return applyRegexRule(content, rule.pattern!, version);
  }
  if (rule.type === "json") {
    const parsed = JSON.parse(content) as unknown;
    setVersionAtJsonPath(parsed, rule.jsonpath!, version);
    return `${JSON.stringify(parsed, null, 2)}\n`;
  }
  if (rule.type === "toml") {
    return applyTomlRulePreservingFormatting(content, rule.jsonpath!, version);
  }
  const parsed = YAML.parse(content) as unknown;
  setVersionAtJsonPath(parsed, rule.jsonpath!, version);
  return `${YAML.stringify(parsed)}`;
}

function normalizeRelative(base: string, target: string): string {
  return path.relative(base, target).replaceAll("\\", "/");
}

function applyArtifactRulesForPackage(
  cwd: string,
  packagePath: string,
  packageConfig: VersionaryPackage,
  version: string,
): string[] {
  const rules = packageConfig["extra-files"] ?? [];
  if (rules.length === 0) {
    return [];
  }
  const packageBase = path.join(cwd, packagePath);
  const updated: string[] = [];
  for (const rule of rules) {
    const targetPath = path.join(packageBase, rule.path);
    if (!fs.existsSync(targetPath)) {
      throw new Error(
        `Artifact rule target missing for package "${packagePath}": ${rule.path}`,
      );
    }
    const existing = fs.readFileSync(targetPath, "utf8");
    let next: string;
    try {
      next = applyArtifactRuleToContent(existing, rule, version);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(
        `Failed applying artifact rule (${rule.type}) for package "${packagePath}" file "${rule.path}": ${message}`,
      );
    }
    fs.writeFileSync(targetPath, next, "utf8");
    updated.push(normalizeRelative(cwd, targetPath));
  }
  return updated;
}

export function applyConfiguredArtifactRules(
  cwd: string,
  config: VersionaryConfig,
  plan: SimplePlan,
): string[] {
  const packageConfigs = config.packages ?? {};
  if (!plan.packages || plan.packages.length === 0) {
    return [];
  }

  const updated = new Set<string>();
  for (const packagePlan of plan.packages) {
    if (!packagePlan.nextVersion) {
      continue;
    }
    const packageConfig = packageConfigs[packagePlan.path];
    if (!packageConfig?.["extra-files"]?.length) {
      continue;
    }
    const files = applyArtifactRulesForPackage(
      cwd,
      packagePlan.path,
      packageConfig,
      packagePlan.nextVersion,
    );
    for (const file of files) {
      updated.add(file);
    }
  }
  return [...updated].sort((a, b) => a.localeCompare(b));
}
