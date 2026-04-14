import { describe, expect, it } from "vitest";
import { analyzeCommits } from "../src/simple/git.js";

describe("simple commit analysis", () => {
  it("returns highest bump type", () => {
    const release = analyzeCommits([
      { hash: "a", subject: "fix: patch issue" },
      { hash: "b", subject: "feat: add thing" },
    ]);
    expect(release).toBe("minor");
  });

  it("ignores revert commits", () => {
    const release = analyzeCommits([{ hash: "a", subject: "revert: feat: add thing" }]);
    expect(release).toBeNull();
  });
});
