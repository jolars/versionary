import { Octokit } from "@octokit/rest";
import type { VersionaryPluginRuntime } from "../types/plugins.js";
import type {
  ScmClient,
  ScmClientContext,
  ScmReleaseMetadataInput,
  ScmReleaseMetadataResult,
  ScmReviewRequestInput,
  ScmReviewRequestResult,
} from "./types.js";

interface ParsedRepo {
  owner: string;
  repo: string;
}

interface GitHubErrorDetails {
  status?: number;
  message: string;
}

interface ReviewRequestBranchContext {
  headBranch: string;
  baseBranch: string;
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

function parseGitHubError(error: unknown): GitHubErrorDetails {
  const status =
    typeof error === "object" && error !== null && "status" in error
      ? Number((error as { status?: unknown }).status)
      : undefined;
  const message =
    error instanceof Error ? error.message : "Unknown GitHub API error";
  return { status, message };
}

function repoRef(repo: ParsedRepo): string {
  return `${repo.owner}/${repo.repo}`;
}

function resolveHeadForList(repo: ParsedRepo, headBranch: string): string {
  const separator = headBranch.indexOf(":");
  if (separator === -1) {
    return `${repo.owner}:${headBranch}`;
  }
  const owner = headBranch.slice(0, separator);
  const branch = headBranch.slice(separator + 1);
  if (!owner || !branch || branch.includes(":")) {
    throw new Error(
      `Invalid head branch "${headBranch}". Expected "branch" or "owner:branch".`,
    );
  }
  return `${owner}:${branch}`;
}

function toReviewRequestState(
  pull: { state?: string; merged_at?: string | null },
  context: string,
): "open" | "closed" | "merged" {
  if (pull.state === "open") {
    return "open";
  }
  if (pull.merged_at) {
    return "merged";
  }
  if (pull.state === "closed") {
    return "closed";
  }
  throw new Error(
    `Unexpected pull request state "${String(pull.state)}" for ${context}.`,
  );
}

/**
 * GitHub hardening contract (see tests/github-plugin-hardening-matrix.test.ts):
 * - GITHUB_REPOSITORY must exist and use owner/repo format.
 * - Token precedence: VERSIONARY_PR_TOKEN -> GH_TOKEN -> GITHUB_TOKEN.
 * - Label application is best-effort for 404/422, but fails for other statuses.
 * - Release metadata lookup treats 404 as "missing, create release"; non-404 fails.
 */
async function ensureLabels(
  octokit: Octokit,
  repo: ParsedRepo,
  pullNumber: number,
  labels: string[],
  branchContext: ReviewRequestBranchContext,
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
    const { status, message } = parseGitHubError(error);
    if (status === 404 || status === 422) {
      return;
    }
    throw new Error(
      `Failed applying labels to pull request #${pullNumber}: [${repoRef(repo)} base=${branchContext.baseBranch} head=${branchContext.headBranch}] ${message}`,
    );
  }
}

export function createGitHubPlugin(): VersionaryPluginRuntime & ScmClient {
  return {
    name: "github",
    capabilities: ["scm.reviewRequest", "scm.releaseMetadata"],
    provider: "github",
    async createOrUpdateReviewRequest(
      input: ScmReviewRequestInput,
      _context: ScmClientContext,
    ): Promise<ScmReviewRequestResult> {
      const repo = getRepoFromEnv();
      const octokit = new Octokit({ auth: getGitHubToken() });
      const listHead = resolveHeadForList(repo, input.headBranch);

      let existing: Awaited<ReturnType<typeof octokit.pulls.list>>["data"];
      try {
        const response = await octokit.pulls.list({
          owner: repo.owner,
          repo: repo.repo,
          state: "open",
          head: listHead,
          base: input.baseBranch,
          per_page: 100,
        });
        existing = response.data;
      } catch (error: unknown) {
        const { message } = parseGitHubError(error);
        throw new Error(
          `Failed listing open pull requests for branch "${input.headBranch}" into "${input.baseBranch}": [${repoRef(repo)}] ${message}`,
        );
      }

      if (existing.length > 1) {
        const matches = existing.map((item) => `#${item.number}`).join(", ");
        throw new Error(
          `Ambiguous open pull request matches for "${input.headBranch}" into "${input.baseBranch}": [${repoRef(repo)}] ${matches}`,
        );
      }

      if (existing.length > 0) {
        const pr = existing[0];
        let updated: Awaited<ReturnType<typeof octokit.pulls.update>>["data"];
        try {
          const response = await octokit.pulls.update({
            owner: repo.owner,
            repo: repo.repo,
            pull_number: pr.number,
            title: input.title,
            body: input.body,
          });
          updated = response.data;
        } catch (error: unknown) {
          const { message } = parseGitHubError(error);
          throw new Error(
            `Failed updating pull request #${pr.number}: [${repoRef(repo)} base=${input.baseBranch} head=${input.headBranch}] ${message}`,
          );
        }
        await ensureLabels(octokit, repo, updated.number, input.labels ?? [], {
          baseBranch: input.baseBranch,
          headBranch: input.headBranch,
        });
        return {
          id: String(updated.id),
          number: updated.number,
          url: updated.html_url,
          state: toReviewRequestState(
            updated,
            `pull request #${updated.number} in ${repoRef(repo)}`,
          ),
        };
      }

      let created: Awaited<ReturnType<typeof octokit.pulls.create>>["data"];
      try {
        const response = await octokit.pulls.create({
          owner: repo.owner,
          repo: repo.repo,
          title: input.title,
          head: input.headBranch,
          base: input.baseBranch,
          body: input.body,
        });
        created = response.data;
      } catch (error: unknown) {
        const { message } = parseGitHubError(error);
        throw new Error(
          `Failed creating pull request from "${input.headBranch}" into "${input.baseBranch}": [${repoRef(repo)}] ${message}`,
        );
      }
      await ensureLabels(octokit, repo, created.number, input.labels ?? [], {
        baseBranch: input.baseBranch,
        headBranch: input.headBranch,
      });
      return {
        id: String(created.id),
        number: created.number,
        url: created.html_url,
        state: toReviewRequestState(
          created,
          `pull request #${created.number} in ${repoRef(repo)}`,
        ),
      };
    },
    async createReleaseMetadata(
      input: ScmReleaseMetadataInput,
      _context: ScmClientContext,
    ): Promise<ScmReleaseMetadataResult> {
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
        const { status, message } = parseGitHubError(error);
        if (status !== 404) {
          throw new Error(
            `Failed checking existing GitHub release for tag "${input.tag}": [${repoRef(repo)}] ${message}`,
          );
        }
      }
      let data: Awaited<ReturnType<typeof octokit.repos.createRelease>>["data"];
      try {
        const response = await octokit.repos.createRelease({
          owner: repo.owner,
          repo: repo.repo,
          tag_name: input.tag,
          name: input.tag,
          body: input.notes,
          draft: input.draft ?? false,
        });
        data = response.data;
      } catch (error: unknown) {
        const { message } = parseGitHubError(error);
        throw new Error(
          `Failed creating GitHub release for tag "${input.tag}": [${repoRef(repo)}] ${message}`,
        );
      }
      return { url: data.html_url, status: "created" };
    },
  };
}
