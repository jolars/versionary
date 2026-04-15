import { describe, expect, it } from "vitest";
import { rVersionStrategy } from "../src/domain/strategy/r.js";
import { resolveVersionStrategy } from "../src/domain/strategy/resolve.js";
import { rustVersionStrategy } from "../src/domain/strategy/rust.js";
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

  it("uses DESCRIPTION as r strategy default version file", () => {
    expect(
      rVersionStrategy.getVersionFile({
        version: 1,
        "release-type": "r",
      }),
    ).toBe("DESCRIPTION");
  });
});
