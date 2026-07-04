import { describe, expect, it } from "vitest";
import {
  type ParsedCommit,
  parseConventionalCommitMessage,
} from "../src/git/commits.js";
import {
  releaseTypeBetween,
  resolveReleaseAsOverride,
} from "../src/release/release-as.js";

function commit(hash: string, subject: string, body = ""): ParsedCommit {
  return { ...parseConventionalCommitMessage(subject, body), hash };
}

describe("resolveReleaseAsOverride", () => {
  it("returns null when no footer is present", () => {
    const commits = [commit("a", "feat: add thing"), commit("b", "fix: bug")];
    expect(resolveReleaseAsOverride(commits, "0.32.0")).toBeNull();
  });

  it("extracts an explicit target version from a footer", () => {
    const commits = [
      commit("a", "chore: graduate", "Release-As: 1.0.0"),
      commit("b", "docs: tidy"),
    ];
    expect(resolveReleaseAsOverride(commits, "0.32.0")).toEqual({
      version: "1.0.0",
      sourceHash: "a",
    });
  });

  it("is case-insensitive on the token and strips a leading v", () => {
    const commits = [commit("a", "chore: bump", "release-as: v2.0.0")];
    expect(resolveReleaseAsOverride(commits, "1.4.0")?.version).toBe("2.0.0");
  });

  it("forces a release even when no commit is releasable", () => {
    const commits = [commit("a", "chore: graduate", "Release-As: 1.0.0")];
    // chore alone yields no bump, but the override still resolves.
    expect(resolveReleaseAsOverride(commits, "0.32.0")?.version).toBe("1.0.0");
  });

  it("accepts repeated identical footers (last wins)", () => {
    const commits = [
      commit("a", "chore: a", "Release-As: 1.0.0"),
      commit("b", "chore: b", "Release-As: 1.0.0"),
    ];
    expect(resolveReleaseAsOverride(commits, "0.32.0")).toEqual({
      version: "1.0.0",
      sourceHash: "b",
    });
  });

  it("throws on conflicting target versions", () => {
    const commits = [
      commit("a", "chore: a", "Release-As: 1.0.0"),
      commit("b", "chore: b", "Release-As: 2.0.0"),
    ];
    expect(() => resolveReleaseAsOverride(commits, "0.32.0")).toThrow(
      /conflicting/i,
    );
  });

  it("throws on an invalid version", () => {
    const commits = [commit("a", "chore: a", "Release-As: not-a-version")];
    expect(() => resolveReleaseAsOverride(commits, "0.32.0")).toThrow(
      /not a valid SemVer/i,
    );
  });

  it("rejects a downgrade", () => {
    const commits = [commit("a", "chore: a", "Release-As: 0.30.0")];
    expect(() => resolveReleaseAsOverride(commits, "0.32.0")).toThrow(
      /not greater than/i,
    );
  });

  it("rejects a no-op equal version", () => {
    const commits = [commit("a", "chore: a", "Release-As: 0.32.0")];
    expect(() => resolveReleaseAsOverride(commits, "0.32.0")).toThrow(
      /not greater than/i,
    );
  });
});

describe("releaseTypeBetween", () => {
  it("classifies a major graduation", () => {
    expect(releaseTypeBetween("0.32.0", "1.0.0")).toBe("major");
  });

  it("classifies a minor jump", () => {
    expect(releaseTypeBetween("1.2.0", "1.5.0")).toBe("minor");
  });

  it("classifies a patch jump", () => {
    expect(releaseTypeBetween("1.2.3", "1.2.4")).toBe("patch");
  });

  it("returns null for an identical version", () => {
    expect(releaseTypeBetween("1.2.3", "1.2.3")).toBeNull();
  });
});
