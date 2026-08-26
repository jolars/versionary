import type { VersionaryConfig } from "../types/config.js";
import { cmakeVersionStrategy } from "./cmake.js";
import { compositeVersionStrategy } from "./composite.js";
import { juliaVersionStrategy } from "./julia.js";
import { latexVersionStrategy } from "./latex.js";
import { nodeVersionStrategy } from "./node.js";
import { pythonVersionStrategy } from "./python.js";
import { rVersionStrategy } from "./r.js";
import { rustVersionStrategy } from "./rust.js";
import { simpleVersionStrategy } from "./simple.js";
import type { VersionStrategy } from "./types.js";

const strategyRegistry: Record<string, VersionStrategy> = {
  cmake: cmakeVersionStrategy,
  julia: juliaVersionStrategy,
  latex: latexVersionStrategy,
  simple: simpleVersionStrategy,
  node: nodeVersionStrategy,
  rust: rustVersionStrategy,
  r: rVersionStrategy,
  python: pythonVersionStrategy,
};

export function listKnownReleaseTypes(): string[] {
  return Object.keys(strategyRegistry).sort((a, b) => a.localeCompare(b));
}

function resolveSingle(name: string): VersionStrategy {
  const strategy = strategyRegistry[name];
  if (!strategy) {
    const known = listKnownReleaseTypes().join(", ");
    throw new Error(
      `Unsupported release-type "${name}". Supported release types: ${known}.`,
    );
  }
  return strategy;
}

export function resolveVersionStrategy(
  config: VersionaryConfig,
): VersionStrategy {
  const releaseType = config["release-type"] ?? "simple";
  if (Array.isArray(releaseType)) {
    if (releaseType.length === 0) {
      throw new Error(
        "release-type array must contain at least one strategy name.",
      );
    }
    const seen = new Set<string>();
    const strategies: VersionStrategy[] = [];
    for (const name of releaseType) {
      if (seen.has(name)) {
        throw new Error(
          `release-type array contains duplicate entry "${name}".`,
        );
      }
      seen.add(name);
      strategies.push(resolveSingle(name));
    }
    return compositeVersionStrategy(strategies);
  }
  return resolveSingle(releaseType);
}
