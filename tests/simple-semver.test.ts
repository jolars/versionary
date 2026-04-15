import { describe, expect, it } from "vitest";
import {
  bumpVersion,
  compareVersions,
  isValidVersion,
  parseVersion,
} from "../src/domain/release/semver.js";

describe("simple semver", () => {
  it("parses x.y.z and optional pre-release/build metadata", () => {
    expect(parseVersion("1.2.3")).toEqual({
      major: 1,
      minor: 2,
      patch: 3,
      prerelease: [],
      build: [],
    });
    expect(parseVersion("1.2.3-alpha.1+build.5")).toEqual({
      major: 1,
      minor: 2,
      patch: 3,
      prerelease: ["alpha", "1"],
      build: ["build", "5"],
    });
  });

  it("bumps versions", () => {
    expect(bumpVersion("1.2.3", "patch")).toBe("1.2.4");
    expect(bumpVersion("1.2.3", "minor")).toBe("1.3.0");
    expect(bumpVersion("1.2.3", "major")).toBe("2.0.0");
  });

  it("validates full SemVer 2.0 forms", () => {
    expect(isValidVersion("0.1.0")).toBe(true);
    expect(isValidVersion("1.0.0-alpha")).toBe(true);
    expect(isValidVersion("1.0.0-alpha.1")).toBe(true);
    expect(isValidVersion("1.0.0+20130313144700")).toBe(true);
    expect(isValidVersion("1.0.0-beta+exp.sha.5114f85")).toBe(true);
    expect(isValidVersion("01.0.0")).toBe(false);
    expect(isValidVersion("1.01.0")).toBe(false);
    expect(isValidVersion("1.0.0-01")).toBe(false);
    expect(isValidVersion("1.0")).toBe(false);
  });

  it("implements SemVer precedence examples", () => {
    const chain = [
      "1.0.0-alpha",
      "1.0.0-alpha.1",
      "1.0.0-alpha.beta",
      "1.0.0-beta",
      "1.0.0-beta.2",
      "1.0.0-beta.11",
      "1.0.0-rc.1",
      "1.0.0",
    ];

    for (let index = 0; index < chain.length - 1; index += 1) {
      expect(compareVersions(chain[index] ?? "", chain[index + 1] ?? "")).toBe(
        -1,
      );
    }
    expect(compareVersions("1.0.0+build.1", "1.0.0+build.2")).toBe(0);
    expect(compareVersions("2.1.0", "2.1.1")).toBe(-1);
    expect(compareVersions("2.1.1", "2.1.0")).toBe(1);
  });
});
