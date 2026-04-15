import type { VersionaryConfig } from "../types/config.js";
import { nodeVersionStrategy } from "./node.js";
import { simpleVersionStrategy } from "./simple.js";
import type { VersionStrategy } from "./types.js";

export function resolveVersionStrategy(config: VersionaryConfig): VersionStrategy {
  if (config["release-type"] === "node") {
    return nodeVersionStrategy;
  }
  return simpleVersionStrategy;
}
