import { describe, expect, it } from "vitest";
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
});
