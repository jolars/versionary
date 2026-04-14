import { describe, expect, it } from "vitest";
import { bumpVersion, parseVersion } from "../src/simple/semver.js";

describe("simple semver", () => {
  it("parses x.y.z", () => {
    expect(parseVersion("1.2.3")).toEqual({ major: 1, minor: 2, patch: 3 });
  });

  it("bumps versions", () => {
    expect(bumpVersion("1.2.3", "patch")).toBe("1.2.4");
    expect(bumpVersion("1.2.3", "minor")).toBe("1.3.0");
    expect(bumpVersion("1.2.3", "major")).toBe("2.0.0");
  });
});
