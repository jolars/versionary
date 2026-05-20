import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  DEFAULT_GIT_AUTHOR_EMAIL,
  DEFAULT_GIT_AUTHOR_NAME,
  ensureGitIdentity,
} from "../src/git/identity.js";

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

describe("ensureGitIdentity", () => {
  let cwd: string;
  let savedGlobal: string | undefined;
  let savedSystem: string | undefined;

  beforeEach(() => {
    cwd = mkdtempSync(path.join(tmpdir(), "versionary-identity-"));
    git(cwd, "init");
    // Isolate from any ambient global/system git identity so the "no identity
    // configured" case is reproducible regardless of the host machine.
    savedGlobal = process.env.GIT_CONFIG_GLOBAL;
    savedSystem = process.env.GIT_CONFIG_SYSTEM;
    process.env.GIT_CONFIG_GLOBAL = "/dev/null";
    process.env.GIT_CONFIG_SYSTEM = "/dev/null";
  });

  afterEach(() => {
    if (savedGlobal === undefined) {
      delete process.env.GIT_CONFIG_GLOBAL;
    } else {
      process.env.GIT_CONFIG_GLOBAL = savedGlobal;
    }
    if (savedSystem === undefined) {
      delete process.env.GIT_CONFIG_SYSTEM;
    } else {
      process.env.GIT_CONFIG_SYSTEM = savedSystem;
    }
    rmSync(cwd, { recursive: true, force: true });
  });

  it("sets a default committer identity when none is configured", () => {
    expect(() => git(cwd, "config", "user.name")).toThrow();

    ensureGitIdentity(cwd);

    expect(git(cwd, "config", "user.name")).toBe(DEFAULT_GIT_AUTHOR_NAME);
    expect(git(cwd, "config", "user.email")).toBe(DEFAULT_GIT_AUTHOR_EMAIL);
  });

  it("does not override an existing identity", () => {
    git(cwd, "config", "user.name", "Jane Dev");
    git(cwd, "config", "user.email", "jane@example.com");

    ensureGitIdentity(cwd);

    expect(git(cwd, "config", "user.name")).toBe("Jane Dev");
    expect(git(cwd, "config", "user.email")).toBe("jane@example.com");
  });
});
