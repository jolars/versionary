import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { inspect } from "node:util";
import { afterEach, describe, expect, it, vi } from "vitest";
import { pushReleaseBranch } from "../src/release/pr.js";
import { mockGitHubEnv } from "./helpers/cli.js";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const cli = path.join(repoRoot, "src", "cli", "index.ts");
const tsx = path.join(repoRoot, "node_modules", ".bin", "tsx");
const tempDirs: string[] = [];
const branch = "versionary/release";
const rejection = "Release branch rejected by test policy.";
const tokens = {
  VERSIONARY_PR_TOKEN: "test-pr-secret+/=",
  GH_TOKEN: "test-gh-secret+/=",
  GITHUB_TOKEN: "test-github-secret+/=",
};

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function writeExecutable(file: string, content: string): void {
  fs.writeFileSync(file, content, { mode: 0o755 });
}

function setupRepo(rejectPush = true) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "versionary-push-"));
  tempDirs.push(root);
  const cwd = path.join(root, "work");
  const origin = path.join(root, "origin.git");
  fs.mkdirSync(cwd);
  git(root, "init", "--bare", origin);
  git(cwd, "init");
  git(cwd, "config", "user.name", "Test User");
  git(cwd, "config", "user.email", "test@example.com");
  git(cwd, "remote", "add", "origin", origin);
  fs.writeFileSync(path.join(cwd, "version.txt"), "0.1.0\n");
  fs.writeFileSync(
    path.join(cwd, "versionary.jsonc"),
    JSON.stringify({ version: 1, "review-mode": "pr" }),
  );
  git(cwd, "add", ".");
  git(cwd, "commit", "-m", "feat: add a feature");
  git(cwd, "push", "-u", "origin", "main");

  const attempts = path.join(root, "push-attempts");
  if (rejectPush) {
    const diagnostic = [
      rejection,
      "https://push-user:push%40password@example.com/owner/repo.git",
      "https://token-only-secret@example.com/owner/repo.git",
      ...Object.values(tokens).flatMap((token) => [
        token,
        encodeURIComponent(token),
      ]),
    ].join("\n");
    writeExecutable(
      path.join(origin, "hooks", "pre-receive"),
      `#!/usr/bin/env node
require("node:fs").appendFileSync(${JSON.stringify(attempts)}, "attempt\\n");
process.stderr.write(${JSON.stringify(diagnostic)});
process.exit(1);
`,
    );
  }
  return { root, cwd, origin, attempts };
}

function expectSafeDiagnostic(diagnostic: string): void {
  expect(diagnostic).toContain(rejection);
  expect(diagnostic).toContain("git push --force-with-lease origin");
  expect(diagnostic).toContain("example.com/owner/repo.git");
  for (const secret of [
    "push-user",
    "push%40password",
    "token-only-secret",
    ...Object.values(tokens).flatMap((token) => [
      token,
      encodeURIComponent(token),
    ]),
  ]) {
    expect(diagnostic).not.toContain(secret);
  }
}

afterEach(() => {
  vi.unstubAllEnvs();
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("release branch push diagnostics", () => {
  it("pushes the release branch successfully", () => {
    const { cwd, origin } = setupRepo(false);
    git(cwd, "checkout", "-b", branch);

    pushReleaseBranch(cwd, branch);

    expect(git(origin, "rev-parse", branch)).toBe(
      git(cwd, "rev-parse", "HEAD"),
    );
  });

  it("retains Git's rejection without exposing credentials in the error", () => {
    const { cwd, attempts } = setupRepo();
    git(cwd, "checkout", "-b", branch);
    for (const [key, token] of Object.entries(tokens)) {
      vi.stubEnv(key, token);
    }

    let error: unknown;
    try {
      pushReleaseBranch(cwd, branch);
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(Error);
    expectSafeDiagnostic(inspect(error));
    expect(fs.readFileSync(attempts, "utf8")).toBe("attempt\n");
  });

  it.each(["run", "pr"])(
    "reports a rejected push through the %s CLI command",
    (command) => {
      const { cwd, attempts } = setupRepo();
      const args = command === "run" ? [command, "--json"] : [command];

      const result = spawnSync(tsx, [cli, ...args], {
        cwd,
        encoding: "utf8",
        env: { ...mockGitHubEnv(), ...tokens },
      });

      expect(result.status).toBe(1);
      expectSafeDiagnostic(result.stderr);
      if (command === "run") {
        expect(result.stdout).toBe("");
      }
      expect(fs.readFileSync(attempts, "utf8")).toBe("attempt\n");
    },
  );

  it("reports the CLI rejection through the GitHub Action entrypoint", () => {
    const { root, cwd, origin, attempts } = setupRepo();
    const bin = path.join(root, "bin");
    fs.mkdirSync(bin);
    // Keep real Git and CLI execution while replacing the npm download.
    writeExecutable(
      path.join(bin, "npx"),
      `#!/usr/bin/env node
const { spawnSync } = require("node:child_process");
const result = spawnSync(${JSON.stringify(tsx)}, [${JSON.stringify(cli)}, ...process.argv.slice(4)], { stdio: "inherit" });
process.exit(result.status ?? 1);
`,
    );
    const remote = `https://x-access-token:${encodeURIComponent(tokens.GITHUB_TOKEN)}@github.com/test/repository.git`;
    // The Action configures an authenticated URL; redirect it to the local fixture.
    git(cwd, "config", `url.${origin}.insteadOf`, remote);
    const output = path.join(root, "github-output");

    const result = spawnSync(
      process.execPath,
      [path.join(repoRoot, "action", "index.js")],
      {
        cwd,
        encoding: "utf8",
        env: {
          ...mockGitHubEnv(),
          ...tokens,
          PATH: `${bin}${path.delimiter}${process.env.PATH ?? ""}`,
          INPUT_TOKEN: tokens.GITHUB_TOKEN,
          INPUT_WORKING_DIRECTORY: cwd,
          GITHUB_SERVER_URL: "https://github.com",
          GITHUB_EVENT_NAME: "workflow_dispatch",
          GITHUB_OUTPUT: output,
        },
      },
    );

    expect(result.status).toBe(1);
    expectSafeDiagnostic(result.stderr);
    expect(result.stdout).toBe("");
    expect(fs.existsSync(output)).toBe(false);
    expect(fs.readFileSync(attempts, "utf8")).toBe("attempt\n");
  });
});
