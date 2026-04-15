import type { VersionaryConfig } from "../../types/config.js";
import { nodeVersionStrategy } from "./node.js";
import { rVersionStrategy } from "./r.js";
import { rustVersionStrategy } from "./rust.js";
import { simpleVersionStrategy } from "./simple.js";
import type { VersionStrategy } from "./types.js";

export function resolveVersionStrategy(
  config: VersionaryConfig,
): VersionStrategy {
  if (config["release-type"] === "node") {
    return nodeVersionStrategy;
  }
  if (config["release-type"] === "rust") {
    return rustVersionStrategy;
  }
  if (config["release-type"] === "r") {
    return rVersionStrategy;
  }
  return simpleVersionStrategy;
}
