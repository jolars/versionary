import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  readReleaseTargets,
  writeBaselineSha,
} from "../src/app/release/state.js";

const tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = fs.mkdtempSync(
    path.join(os.tmpdir(), "versionary-release-test-"),
  );
  tempDirs.push(dir);
  return dir;
}

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  }).trim();
}

function write(cwd: string, relative: string, content: string): void {
  const target = path.join(cwd, relative);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content, "utf8");
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
});

describe("release state targets", () => {
  it("persists and reads monorepo release targets", () => {
    const cwd = makeTempDir();
    git(cwd, "init");
    git(cwd, "config", "user.name", "Test User");
    git(cwd, "config", "user.email", "test@example.com");
    write(cwd, "versionary.jsonc", JSON.stringify({ version: 1 }));
    write(cwd, "version.txt", "1.0.0\n");
    git(cwd, "add", ".");
    git(cwd, "commit", "-m", "chore: init");

    writeBaselineSha(cwd, "abc1234", [
      {
        path: "packages/a",
        version: "1.2.0",
        tag: "packages-a-v1.2.0",
        notes: "notes a",
      },
      {
        path: "packages/b",
        version: "0.3.1",
        tag: "packages-b-v0.3.1",
        notes: "notes b",
      },
    ]);

    const targets = readReleaseTargets(cwd);
    expect(targets).toHaveLength(2);
    expect(targets[0]?.tag).toBe("packages-a-v1.2.0");
    expect(targets[1]?.tag).toBe("packages-b-v0.3.1");
  });
});
