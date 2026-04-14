import { execFileSync } from "node:child_process";

export function resolveRepositoryWebBaseUrl(cwd: string): string | null {
  const server = process.env.GITHUB_SERVER_URL;
  const slug = process.env.GITHUB_REPOSITORY;
  if (server && slug) {
    return `${server.replace(/\/+$/u, "")}/${slug}`;
  }

  try {
    const remote = execFileSync("git", ["remote", "get-url", "origin"], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    const httpsMatch = remote.match(/^(?:https?:\/\/|git@)([^:/]+)[:/]([^/]+\/[^/]+?)(?:\.git)?$/u);
    if (!httpsMatch) {
      return null;
    }
    const [, host, repoPath] = httpsMatch;
    return `https://${host}/${repoPath}`;
  } catch {
    return null;
  }
}
