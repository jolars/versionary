import { describe, expect, it } from "vitest";
import { nodeVersionStrategy } from "../src/domain/strategy/node.js";
import { rVersionStrategy } from "../src/domain/strategy/r.js";
import {
  listKnownReleaseTypes,
  resolveVersionStrategy,
} from "../src/domain/strategy/resolve.js";
import { rustVersionStrategy } from "../src/domain/strategy/rust.js";
import { simpleVersionStrategy } from "../src/domain/strategy/simple.js";
import type { VersionaryConfig } from "../src/types/config.js";

describe("resolveVersionStrategy", () => {
  it("routes release-type rust to rust strategy", () => {
    const config: VersionaryConfig = {
      version: 1,
      "release-type": "rust",
    };

    const strategy = resolveVersionStrategy(config);
    expect(strategy).toBe(rustVersionStrategy);
    expect(strategy.name).toBe("rust");
  });

  it("uses Cargo.toml as rust strategy default version file", () => {
    expect(
      rustVersionStrategy.getVersionFile({
        version: 1,
        "release-type": "rust",
      }),
    ).toBe("Cargo.toml");
  });

  it("routes release-type r to R strategy", () => {
    const config: VersionaryConfig = {
      version: 1,
      "release-type": "r",
    };

    const strategy = resolveVersionStrategy(config);
    expect(strategy).toBe(rVersionStrategy);
    expect(strategy.name).toBe("r");
  });

  it("routes release-type node to node strategy", () => {
    const config: VersionaryConfig = {
      version: 1,
      "release-type": "node",
    };

    const strategy = resolveVersionStrategy(config);
    expect(strategy).toBe(nodeVersionStrategy);
    expect(strategy.name).toBe("node");
  });

  it("falls back to simple strategy for unknown release type", () => {
    const config: VersionaryConfig = {
      version: 1,
      "release-type": "not-real",
    };

    const strategy = resolveVersionStrategy(config);
    expect(strategy).toBe(simpleVersionStrategy);
    expect(strategy.name).toBe("simple");
  });

  it("lists known release types from internal strategy registry", () => {
    expect(listKnownReleaseTypes()).toEqual(["node", "r", "rust", "simple"]);
  });

  it("uses DESCRIPTION as r strategy default version file", () => {
    expect(
      rVersionStrategy.getVersionFile({
        version: 1,
        "release-type": "r",
      }),
    ).toBe("DESCRIPTION");
  });
});
