export type ScmProvider = "github";

export interface ScmClientContext {
  cwd: string;
  logger?: {
    info: (message: string) => void;
    warn: (message: string) => void;
    error: (message: string) => void;
  };
}

export interface ScmReviewRequestInput {
  baseBranch: string;
  headBranch: string;
  title: string;
  body: string;
  labels?: string[];
}

export interface ScmReviewRequestResult {
  id: string;
  number?: number;
  url: string;
  state: "open" | "closed" | "merged";
}

export interface ScmReleaseMetadataInput {
  tag: string;
  version: string;
  notes: string;
  draft?: boolean;
}

export interface ScmReleaseMetadataResult {
  url: string;
  status?: "created" | "exists";
}

export interface ScmClient {
  provider: ScmProvider;
  createOrUpdateReviewRequest: (
    input: ScmReviewRequestInput,
    context: ScmClientContext,
  ) => Promise<ScmReviewRequestResult>;
  createReleaseMetadata: (
    input: ScmReleaseMetadataInput,
    context: ScmClientContext,
  ) => Promise<ScmReleaseMetadataResult>;
}
