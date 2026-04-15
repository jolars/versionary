import { Octokit } from "@octokit/rest";
import type {
  VersionaryPluginContext,
  VersionaryPluginRuntime,
  VersionaryScmReleaseMetadataInput,
  VersionaryScmReleaseMetadataResult,
  VersionaryScmReviewRequestInput,
  VersionaryScmReviewRequestResult,
} from "../types/plugins.js";

interface ParsedRepo {
  owner: string;
  repo: string;
}

function parseRepoSlug(input: string): ParsedRepo {
  const [owner, repo] = input.split("/");
  if (!owner || !repo) {
    throw new Error(`Invalid repo slug "${input}". Expected "owner/repo".`);
  }
  return { owner, repo };
}

function getRepoFromEnv(): ParsedRepo {
  const slug = process.env.GITHUB_REPOSITORY;
  if (!slug) {
    throw new Error("Missing GITHUB_REPOSITORY environment variable.");
  }
  return parseRepoSlug(slug);
}

function getGitHubToken(): string {
  const token =
    process.env.VERSIONARY_PR_TOKEN ??
    process.env.GH_TOKEN ??
    process.env.GITHUB_TOKEN;
  if (!token) {
    throw new Error(
      "Missing GitHub token. Set VERSIONARY_PR_TOKEN, GH_TOKEN, or GITHUB_TOKEN.",
    );
  }
  return token;
}

async function ensureLabels(
  octokit: Octokit,
  repo: ParsedRepo,
  pullNumber: number,
  labels: string[],
): Promise<void> {
  if (labels.length === 0) {
    return;
  }

  try {
    await octokit.issues.addLabels({
      owner: repo.owner,
      repo: repo.repo,
      issue_number: pullNumber,
      labels,
    });
  } catch (error: unknown) {
    const status =
      typeof error === "object" && error !== null && "status" in error
        ? Number((error as { status?: unknown }).status)
        : undefined;
    if (status === 404 || status === 422) {
      return;
    }
    const message =
      error instanceof Error ? error.message : "Unknown GitHub API error";
    throw new Error(
      `Failed applying labels to pull request #${pullNumber}: ${message}`,
    );
  }
}

export function createGitHubPlugin(): VersionaryPluginRuntime {
  return {
    name: "github",
    capabilities: ["scm.reviewRequest", "scm.releaseMetadata"],
    async createOrUpdateReviewRequest(
      input: VersionaryScmReviewRequestInput,
      _context: VersionaryPluginContext,
    ): Promise<VersionaryScmReviewRequestResult> {
      const repo = getRepoFromEnv();
      const octokit = new Octokit({ auth: getGitHubToken() });

      const { data: existing } = await octokit.pulls.list({
        owner: repo.owner,
        repo: repo.repo,
        state: "open",
        head: `${repo.owner}:${input.headBranch}`,
        base: input.baseBranch,
        per_page: 1,
      });

      if (existing.length > 0) {
        const pr = existing[0];
        const { data: updated } = await octokit.pulls.update({
          owner: repo.owner,
          repo: repo.repo,
          pull_number: pr.number,
          title: input.title,
          body: input.body,
        });
        await ensureLabels(octokit, repo, updated.number, input.labels ?? []);
        return {
          id: String(updated.id),
          number: updated.number,
          url: updated.html_url,
          state: updated.state === "open" ? "open" : "closed",
        };
      }

      const { data: created } = await octokit.pulls.create({
        owner: repo.owner,
        repo: repo.repo,
        title: input.title,
        head: input.headBranch,
        base: input.baseBranch,
        body: input.body,
      });
      await ensureLabels(octokit, repo, created.number, input.labels ?? []);
      return {
        id: String(created.id),
        number: created.number,
        url: created.html_url,
        state: created.state === "open" ? "open" : "closed",
      };
    },
    async createReleaseMetadata(
      input: VersionaryScmReleaseMetadataInput,
      _context: VersionaryPluginContext,
    ): Promise<VersionaryScmReleaseMetadataResult> {
      const repo = getRepoFromEnv();
      const octokit = new Octokit({ auth: getGitHubToken() });
      try {
        const existing = await octokit.repos.getReleaseByTag({
          owner: repo.owner,
          repo: repo.repo,
          tag: input.tag,
        });
        return { url: existing.data.html_url, status: "exists" };
      } catch (error: unknown) {
        const status =
          typeof error === "object" && error !== null && "status" in error
            ? Number((error as { status?: unknown }).status)
            : undefined;
        if (status !== 404) {
          const message =
            error instanceof Error ? error.message : "Unknown GitHub API error";
          throw new Error(
            `Failed checking existing GitHub release for tag "${input.tag}": ${message}`,
          );
        }
      }
      const { data } = await octokit.repos.createRelease({
        owner: repo.owner,
        repo: repo.repo,
        tag_name: input.tag,
        name: input.tag,
        body: input.notes,
      });
      return { url: data.html_url, status: "created" };
    },
  };
}
