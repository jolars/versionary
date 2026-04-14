import { describe, expect, it } from "vitest";
import { splitSafeDirtyFiles } from "../src/simple/pr.js";

function parseLikeGitStatusPorcelainLines(lines: string[]): string[] {
  return lines
    .filter((line) => line.length > 0)
    .map((line) => line.slice(3))
    .map((pathPart) => {
      const renameParts = pathPart.split(" -> ");
      return renameParts.at(-1) ?? pathPart;
    })
    .map((filePath) => filePath.trim())
    .filter((filePath) => filePath.length > 0);
}

describe("git porcelain path parsing compatibility", () => {
  it("extracts paths without clipping first character", () => {
    const files = parseLikeGitStatusPorcelainLines([" M pnpm-lock.yaml", "M  src/simple/pr.ts"]);
    expect(files).toEqual(["pnpm-lock.yaml", "src/simple/pr.ts"]);
    const result = splitSafeDirtyFiles(files);
    expect(result.ignored).toEqual(["pnpm-lock.yaml"]);
    expect(result.blocking).toEqual(["src/simple/pr.ts"]);
  });

  it("handles rename paths by taking destination path", () => {
    const files = parseLikeGitStatusPorcelainLines(["R  old/pnpm-lock.yaml -> new/pnpm-lock.yaml"]);
    expect(files).toEqual(["new/pnpm-lock.yaml"]);
    const result = splitSafeDirtyFiles(files);
    expect(result.ignored).toEqual(["new/pnpm-lock.yaml"]);
    expect(result.blocking).toEqual([]);
  });
});
