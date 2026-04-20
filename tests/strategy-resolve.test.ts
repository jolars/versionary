import { describe, expect, it } from "vitest";
import { latexVersionStrategy } from "../src/strategy/latex.js";
import { nodeVersionStrategy } from "../src/strategy/node.js";
import { rVersionStrategy } from "../src/strategy/r.js";
import {
  listKnownReleaseTypes,
  resolveVersionStrategy,
} from "../src/strategy/resolve.js";
import { rustVersionStrategy } from "../src/strategy/rust.js";
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

  it("routes release-type latex to latex strategy", () => {
    const config: VersionaryConfig = {
      version: 1,
      "release-type": "latex",
    };

    const strategy = resolveVersionStrategy(config);
    expect(strategy).toBe(latexVersionStrategy);
    expect(strategy.name).toBe("latex");
  });

  it("throws for unknown release type", () => {
    const config: VersionaryConfig = {
      version: 1,
      "release-type": "not-real",
    };

    expect(() => resolveVersionStrategy(config)).toThrow(
      /Unsupported release-type "not-real"/,
    );
  });

  it("lists known release types from internal strategy registry", () => {
    expect(listKnownReleaseTypes()).toEqual([
      "latex",
      "node",
      "r",
      "rust",
      "simple",
    ]);
  });

  it("uses DESCRIPTION as r strategy default version file", () => {
    expect(
      rVersionStrategy.getVersionFile({
        version: 1,
        "release-type": "r",
      }),
    ).toBe("DESCRIPTION");
  });

  it("uses build.lua as latex strategy default version file", () => {
    expect(
      latexVersionStrategy.getVersionFile({
        version: 1,
        "release-type": "latex",
      }),
    ).toBe("build.lua");
  });
});
