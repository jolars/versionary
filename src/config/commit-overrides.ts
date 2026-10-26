import fs from "node:fs";
import path from "node:path";
import { applyEdits, modify, type ParseError, parse } from "jsonc-parser";
import type { ReleasePlan } from "../release/plan.js";
import type {
  LoadedConfig,
  VersionaryCommitOverride,
} from "../types/config.js";
import { loadConfig } from "./load-config.js";

function updateCommitOverrides(
  loaded: LoadedConfig,
  updates: Array<[string, VersionaryCommitOverride | undefined]>,
): void {
  let raw = fs.readFileSync(loaded.path, "utf8");
  const errors: ParseError[] = [];
  parse(raw, errors, { allowTrailingComma: true });
  if (errors.length > 0) {
    throw new Error(`Cannot edit malformed configuration at ${loaded.path}.`);
  }
  const indent = raw.match(/\n([\t ]+)"/u)?.[1] ?? "  ";
  const options = {
    formattingOptions: {
      insertSpaces: !indent.includes("\t"),
      tabSize: indent.length,
      eol: raw.includes("\r\n") ? "\r\n" : "\n",
    },
  };
  const remaining = { ...loaded.config["commit-overrides"] };
  for (const [hash, override] of updates) {
    if (override === undefined) {
      delete remaining[hash];
    } else {
      remaining[hash] = override;
    }
    raw = applyEdits(
      raw,
      modify(raw, ["commit-overrides", hash], override, options),
    );
  }
  if (Object.keys(remaining).length === 0) {
    raw = applyEdits(
      raw,
      modify(raw, ["commit-overrides"], undefined, options),
    );
  }
  fs.writeFileSync(loaded.path, raw, "utf8");
}

export function writeCommitOverride(
  loaded: LoadedConfig,
  hash: string,
  override: VersionaryCommitOverride,
): void {
  updateCommitOverrides(loaded, [[hash, override]]);
}

export function pruneCommitOverrides(cwd: string, plan: ReleasePlan): string[] {
  // A shared override stays active until every affected package advances past it.
  const consumed = (plan.commitOverrides ?? []).filter(
    (entry) => entry.packages.length === 0,
  );
  if (consumed.length === 0) {
    return [];
  }
  const loaded = loadConfig(cwd);
  updateCommitOverrides(
    loaded,
    consumed.map(({ hash }) => [hash, undefined]),
  );
  return [path.relative(cwd, loaded.path)];
}
