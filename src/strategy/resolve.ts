import type { VersionaryConfig } from "../types/config.js";
import { latexVersionStrategy } from "./latex.js";
import { nodeVersionStrategy } from "./node.js";
import { rVersionStrategy } from "./r.js";
import { rustVersionStrategy } from "./rust.js";
import { simpleVersionStrategy } from "./simple.js";
import type { VersionStrategy } from "./types.js";

const strategyRegistry: Record<string, VersionStrategy> = {
  latex: latexVersionStrategy,
  simple: simpleVersionStrategy,
  node: nodeVersionStrategy,
  rust: rustVersionStrategy,
  r: rVersionStrategy,
};

export function listKnownReleaseTypes(): string[] {
  return Object.keys(strategyRegistry).sort((a, b) => a.localeCompare(b));
}

export function resolveVersionStrategy(
  config: VersionaryConfig,
): VersionStrategy {
  const releaseType = config["release-type"] ?? "simple";
  const strategy = strategyRegistry[releaseType];
  if (!strategy) {
    const known = listKnownReleaseTypes().join(", ");
    throw new Error(
      `Unsupported release-type "${releaseType}". Supported release types: ${known}.`,
    );
  }
  return strategy;
}
