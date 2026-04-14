import { describe, expect, it } from "vitest";
import { isReleaseCommitMessage } from "../src/simple/pr.js";

describe("release commit detection", () => {
  it("matches release commit pattern", () => {
    expect(isReleaseCommitMessage("chore(release): v1.2.3")).toBe(true);
  });

  it("rejects non-release messages", () => {
    expect(isReleaseCommitMessage("feat: add feature")).toBe(false);
    expect(isReleaseCommitMessage("chore(release): prepare")).toBe(false);
  });
});
