import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const cli = fileURLToPath(new URL("../../src/cli/index.ts", import.meta.url));
const tsx = fileURLToPath(
  new URL("../../node_modules/.bin/tsx", import.meta.url),
);
const mockGitHub = new URL("../fixtures/mock-github.mjs", import.meta.url).href;

export function mockGitHubEnv(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    NODE_OPTIONS: `--import=${mockGitHub}`,
    GITHUB_REPOSITORY: "test/repository",
    VERSIONARY_PR_TOKEN: "test-token",
    GH_TOKEN: "test-token",
    GITHUB_TOKEN: "test-token",
    GITHUB_REF: "",
    VERSIONARY_BASE_BRANCH: "",
  };
}

export function runCli(cwd: string, ...args: string[]): string {
  return execFileSync(tsx, [cli, ...args], {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    env: mockGitHubEnv(),
  }).trim();
}
