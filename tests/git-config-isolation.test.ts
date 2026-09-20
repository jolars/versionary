import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";

it("prevents fixture commits from triggering automatic Git maintenance", () => {
  const cwd = fs.mkdtempSync(
    path.join(os.tmpdir(), "versionary-git-maintenance-test-"),
  );
  const git = (...args: string[]): void => {
    execFileSync("git", args, { cwd, stdio: "pipe" });
  };

  try {
    git("init");
    git("config", "user.name", "Test User");
    git("config", "user.email", "test@example.com");
    // Force maintenance to pack objects after one commit, and wait for it so
    // the assertion does not depend on a background process's timing.
    git("config", "maintenance.autoDetach", "false");
    git("config", "maintenance.gc.enabled", "false");
    git("config", "maintenance.loose-objects.enabled", "true");
    git("config", "maintenance.loose-objects.auto", "1");
    fs.writeFileSync(path.join(cwd, "fixture.txt"), "fixture\n");
    git("add", ".");
    git("commit", "-m", "chore: initial");

    expect(fs.readdirSync(path.join(cwd, ".git/objects/pack"))).toEqual([]);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true, maxRetries: 3 });
  }
});
