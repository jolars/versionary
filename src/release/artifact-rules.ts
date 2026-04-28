import fs from "node:fs";
import path from "node:path";
import TOML from "@iarna/toml";
import YAML from "yaml";
import type {
  VersionaryArtifactRule,
  VersionaryConfig,
  VersionaryPackage,
} from "../types/config.js";
import type { SimplePlan } from "./plan.js";

const WILDCARD = Symbol("wildcard");
type FieldPathToken = string | number | typeof WILDCARD;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function parseFieldPath(fieldPath: string): FieldPathToken[] {
  if (!fieldPath.startsWith("$")) {
    throw new Error(`Invalid field-path "${fieldPath}". Must start with "$".`);
  }
  const tokens: FieldPathToken[] = [];
  let index = 1;

  while (index < fieldPath.length) {
    const current = fieldPath[index];
    if (current === ".") {
      if (fieldPath[index + 1] === "*") {
        tokens.push(WILDCARD);
        index += 2;
        continue;
      }
      const keyMatch = fieldPath.slice(index + 1).match(/^[A-Za-z0-9_@/-]+/u);
      if (!keyMatch) {
        throw new Error(
          `Invalid field-path "${fieldPath}" near index ${index}.`,
        );
      }
      tokens.push(keyMatch[0]);
      index += 1 + keyMatch[0].length;
      continue;
    }
    if (current === "[") {
      const rest = fieldPath.slice(index + 1);
      if (rest.startsWith("*]")) {
        tokens.push(WILDCARD);
        index += 3;
        continue;
      }
      const numberMatch = rest.match(/^(\d+)\]/u);
      if (numberMatch) {
        tokens.push(Number(numberMatch[1]));
        index += 2 + numberMatch[1]?.length;
        continue;
      }
      const keyMatch = rest.match(/^"([^"]+)"\]/u);
      if (keyMatch) {
        const key = keyMatch[1];
        if (!key) {
          throw new Error(
            `Invalid field-path "${fieldPath}" near index ${index}.`,
          );
        }
        tokens.push(key);
        index += 4 + keyMatch[1]?.length;
        continue;
      }
      throw new Error(`Invalid field-path "${fieldPath}" near index ${index}.`);
    }
    throw new Error(`Invalid field-path "${fieldPath}" near index ${index}.`);
  }

  if (tokens.length === 0) {
    throw new Error(
      `Invalid field-path "${fieldPath}". Path must target a field.`,
    );
  }
  return tokens;
}

function assignLeaf(
  container: unknown,
  key: string | number,
  fieldPath: string,
  version: string,
): void {
  if (typeof key === "number") {
    if (!Array.isArray(container) || key >= container.length) {
      throw new Error(
        `field-path "${fieldPath}" does not resolve to an existing field.`,
      );
    }
    const current = container[key];
    if (typeof current !== "string" && typeof current !== "number") {
      throw new Error(
        `field-path "${fieldPath}" must point to a string or number field for version updates.`,
      );
    }
    container[key] = version;
    return;
  }
  if (!isRecord(container) || !(key in container)) {
    throw new Error(
      `field-path "${fieldPath}" does not resolve to an existing field.`,
    );
  }
  const current = container[key];
  if (typeof current !== "string" && typeof current !== "number") {
    throw new Error(
      `field-path "${fieldPath}" must point to a string or number field for version updates.`,
    );
  }
  container[key] = version;
}

function applyTokens(
  cursor: unknown,
  tokens: FieldPathToken[],
  position: number,
  fieldPath: string,
  version: string,
): boolean {
  const token = tokens[position];
  const isLeaf = position === tokens.length - 1;

  if (token === WILDCARD) {
    let matched = false;
    if (isRecord(cursor)) {
      for (const key of Object.keys(cursor)) {
        if (isLeaf) {
          assignLeaf(cursor, key, fieldPath, version);
          matched = true;
        } else if (
          applyTokens(cursor[key], tokens, position + 1, fieldPath, version)
        ) {
          matched = true;
        }
      }
      return matched;
    }
    if (Array.isArray(cursor)) {
      for (let i = 0; i < cursor.length; i += 1) {
        if (isLeaf) {
          assignLeaf(cursor, i, fieldPath, version);
          matched = true;
        } else if (
          applyTokens(cursor[i], tokens, position + 1, fieldPath, version)
        ) {
          matched = true;
        }
      }
      return matched;
    }
    throw new Error(
      `field-path "${fieldPath}" wildcard segment does not target an object or array.`,
    );
  }

  if (typeof token === "number") {
    if (!Array.isArray(cursor) || token >= cursor.length) {
      throw new Error(
        `field-path "${fieldPath}" does not resolve to an existing field.`,
      );
    }
    if (isLeaf) {
      assignLeaf(cursor, token, fieldPath, version);
      return true;
    }
    return applyTokens(cursor[token], tokens, position + 1, fieldPath, version);
  }

  if (typeof token === "string") {
    if (!isRecord(cursor) || !(token in cursor)) {
      throw new Error(
        `field-path "${fieldPath}" does not resolve to an existing field.`,
      );
    }
    if (isLeaf) {
      assignLeaf(cursor, token, fieldPath, version);
      return true;
    }
    return applyTokens(cursor[token], tokens, position + 1, fieldPath, version);
  }

  throw new Error(
    `field-path "${fieldPath}" does not resolve to an existing field.`,
  );
}

function setVersionAtJsonPath(
  document: unknown,
  fieldPath: string,
  version: string,
): void {
  const tokens = parseFieldPath(fieldPath);
  const matched = applyTokens(document, tokens, 0, fieldPath, version);
  if (!matched) {
    throw new Error(`field-path "${fieldPath}" did not match any fields.`);
  }
}

function resolveFieldPath(rule: VersionaryArtifactRule): string {
  const fieldPath = rule["field-path"] ?? rule.jsonpath;
  if (!fieldPath) {
    throw new Error(
      `${rule.type} artifact rules require "field-path" (or deprecated "jsonpath").`,
    );
  }
  return fieldPath;
}

function parseRegexPattern(pattern: string): RegExp {
  const slashPattern = pattern.match(/^\/((?:\\\/|[^/])+)\/([a-z]*)$/u);
  if (slashPattern) {
    const source = slashPattern[1];
    const flags = slashPattern[2];
    if (!source || flags === undefined) {
      throw new Error(`Invalid regex pattern "${pattern}".`);
    }
    return new RegExp(source, flags);
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
  const match = matches[0];
  if (!match) {
    throw new Error("Regex match result missing.");
  }
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
  fieldPath: string,
  version: string,
): string {
  const simplePath = fieldPath.match(/^\$\.([A-Za-z0-9_-]+)$/u);
  if (!simplePath) {
    const parsed = TOML.parse(content) as unknown;
    setVersionAtJsonPath(parsed, fieldPath, version);
    return `${TOML.stringify(parsed as TOML.JsonMap)}\n`;
  }

  const key = simplePath[1];
  if (!key) {
    throw new Error(
      `field-path "${fieldPath}" does not resolve to an existing field.`,
    );
  }
  const linePattern = new RegExp(
    `^(\\s*${key}\\s*=\\s*)(["'])([^"']*)(\\2)(\\s*(?:#.*)?)$`,
    "mu",
  );
  const match = content.match(linePattern);
  if (!match) {
    throw new Error(
      `field-path "${fieldPath}" does not resolve to an existing field.`,
    );
  }
  const [, prefix = "", quote = '"', , , suffix = ""] = match;
  return content.replace(
    linePattern,
    `${prefix}${quote}${version}${quote}${suffix}`,
  );
}

function findMatchingBrace(
  content: string,
  openBraceIndex: number,
  endExclusive: number,
): number {
  let depth = 0;
  let inDoubleQuoted = false;
  let inMultiSingleQuoted = false;
  let inLineComment = false;
  let inBlockComment = false;

  for (let index = openBraceIndex; index < endExclusive; index += 1) {
    const current = content[index] ?? "";
    const next = content[index + 1] ?? "";

    if (inLineComment) {
      if (current === "\n") {
        inLineComment = false;
      }
      continue;
    }

    if (inBlockComment) {
      if (current === "*" && next === "/") {
        inBlockComment = false;
        index += 1;
      }
      continue;
    }

    if (inDoubleQuoted) {
      if (current === "\\") {
        index += 1;
        continue;
      }
      if (current === '"') {
        inDoubleQuoted = false;
      }
      continue;
    }

    if (inMultiSingleQuoted) {
      if (current === "'" && next === "'") {
        inMultiSingleQuoted = false;
        index += 1;
      }
      continue;
    }

    if (current === "#") {
      inLineComment = true;
      continue;
    }

    if (current === "/" && next === "*") {
      inBlockComment = true;
      index += 1;
      continue;
    }

    if (current === '"') {
      inDoubleQuoted = true;
      continue;
    }

    if (current === "'" && next === "'") {
      inMultiSingleQuoted = true;
      index += 1;
      continue;
    }

    if (current === "{") {
      depth += 1;
      continue;
    }

    if (current === "}") {
      depth -= 1;
      if (depth === 0) {
        return index;
      }
    }
  }

  return -1;
}

function resolveNixPathTokens(fieldPath: string): string[] {
  const tokens = parseFieldPath(fieldPath);
  if (tokens.some((token) => token === WILDCARD)) {
    throw new Error(
      `Nix artifact rules do not support wildcard segments in field-path "${fieldPath}".`,
    );
  }
  if (tokens.some((token) => typeof token === "number")) {
    throw new Error(
      `Nix artifact rules do not support array index segments in field-path "${fieldPath}".`,
    );
  }
  return tokens as string[];
}

function escapeForRegex(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function buildNixKeyPattern(key: string): string {
  const escaped = escapeForRegex(key);
  return `(?:${escaped}|"${escaped}")`;
}

function findNixScopeRanges(
  content: string,
  key: string,
  rangeStart: number,
  rangeEnd: number,
): Array<{ start: number; end: number }> {
  const keyPattern = buildNixKeyPattern(key);
  const assignmentPattern = new RegExp(
    `^\\s*${keyPattern}\\s*=.*\\{(?:\\s*(?:#.*)?)$`,
    "gmu",
  );
  const scopedContent = content.slice(rangeStart, rangeEnd);
  const ranges: Array<{ start: number; end: number }> = [];

  let match = assignmentPattern.exec(scopedContent);
  while (match) {
    const matchText = match[0] ?? "";
    const relLineStart = match.index;
    const relBracePos = matchText.lastIndexOf("{");
    if (relLineStart >= 0 && relBracePos >= 0) {
      const absoluteBrace = rangeStart + relLineStart + relBracePos;
      const closingBrace = findMatchingBrace(content, absoluteBrace, rangeEnd);
      if (closingBrace < 0) {
        throw new Error(
          `Nix field-path segment "${key}" has an unterminated attrset.`,
        );
      }
      ranges.push({ start: absoluteBrace + 1, end: closingBrace });
    }
    match = assignmentPattern.exec(scopedContent);
  }

  return ranges;
}

function applyNixRulePreservingFormatting(
  content: string,
  fieldPath: string,
  version: string,
): string {
  const tokens = resolveNixPathTokens(fieldPath);
  const parentTokens = tokens.slice(0, -1);
  const leaf = tokens.at(-1);
  if (!leaf) {
    throw new Error(
      `field-path "${fieldPath}" does not resolve to an existing field.`,
    );
  }

  let candidateRanges: Array<{ start: number; end: number }> = [
    { start: 0, end: content.length },
  ];
  for (const parent of parentTokens) {
    const nextRanges: Array<{ start: number; end: number }> = [];
    for (const range of candidateRanges) {
      const nested = findNixScopeRanges(
        content,
        parent,
        range.start,
        range.end,
      );
      nextRanges.push(...nested);
    }
    candidateRanges = nextRanges;
    if (candidateRanges.length === 0) {
      throw new Error(
        `field-path "${fieldPath}" does not resolve to an existing field.`,
      );
    }
  }

  const leafPattern = new RegExp(
    `(^\\s*${buildNixKeyPattern(leaf)}\\s*=\\s*)(["'])([^"']*)(\\2)(\\s*;)`,
    "gmu",
  );

  const replacements: Array<{
    start: number;
    end: number;
    replacement: string;
  }> = [];

  for (const range of candidateRanges) {
    const segment = content.slice(range.start, range.end);
    let match = leafPattern.exec(segment);
    while (match) {
      const full = match[0] ?? "";
      const prefix = match[1] ?? "";
      const quote = match[2] ?? '"';
      const suffix = match[5] ?? ";";
      const relStart = match.index;
      replacements.push({
        start: range.start + relStart,
        end: range.start + relStart + full.length,
        replacement: `${prefix}${quote}${version}${quote}${suffix}`,
      });
      match = leafPattern.exec(segment);
    }
  }

  if (replacements.length === 0) {
    throw new Error(
      `field-path "${fieldPath}" does not resolve to an existing field.`,
    );
  }

  if (replacements.length > 1) {
    throw new Error(
      `Nix artifact rule field-path "${fieldPath}" matched multiple assignments; refine the path to match exactly one field.`,
    );
  }

  const [target] = replacements;
  if (!target) {
    throw new Error("Nix replacement target missing.");
  }
  return `${content.slice(0, target.start)}${target.replacement}${content.slice(target.end)}`;
}

function applyArtifactRuleToContent(
  content: string,
  rule: VersionaryArtifactRule,
  version: string,
): string {
  if (rule.type === "regex") {
    if (!rule.pattern) {
      throw new Error('regex artifact rules require "pattern".');
    }
    return applyRegexRule(content, rule.pattern, version);
  }
  if (rule.type === "json") {
    const parsed = JSON.parse(content) as unknown;
    setVersionAtJsonPath(parsed, resolveFieldPath(rule), version);
    return `${JSON.stringify(parsed, null, 2)}\n`;
  }
  if (rule.type === "toml") {
    return applyTomlRulePreservingFormatting(
      content,
      resolveFieldPath(rule),
      version,
    );
  }
  if (rule.type === "nix") {
    return applyNixRulePreservingFormatting(
      content,
      resolveFieldPath(rule),
      version,
    );
  }
  const parsed = YAML.parse(content) as unknown;
  setVersionAtJsonPath(parsed, resolveFieldPath(rule), version);
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
