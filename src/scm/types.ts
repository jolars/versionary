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

export interface ScmCloseReviewRequestInput {
  baseBranch: string;
  headBranch: string;
  reason: string;
}

export interface ScmCloseReviewRequestResult {
  closed: boolean;
  number?: number;
  url?: string;
}

export interface ScmReleaseMetadataInput {
  tag: string;
  version: string;
  notes: string;
  draft?: boolean;
  makeLatest?: "true" | "false" | "legacy";
}

export interface ScmReleaseMetadataResult {
  url: string;
  status?: "created" | "exists";
}

export interface ScmReleaseReferenceCommentsInput {
  version: string;
  releaseUrl: string;
  references: number[];
  mode?: "best-effort" | "strict";
}

export interface ScmReleaseReferenceCommentsResult {
  commented: number[];
}

export interface ScmClient {
  provider: ScmProvider;
  createOrUpdateReviewRequest: (
    input: ScmReviewRequestInput,
    context: ScmClientContext,
  ) => Promise<ScmReviewRequestResult>;
  closeReviewRequestIfExists: (
    input: ScmCloseReviewRequestInput,
    context: ScmClientContext,
  ) => Promise<ScmCloseReviewRequestResult>;
  createReleaseMetadata: (
    input: ScmReleaseMetadataInput,
    context: ScmClientContext,
  ) => Promise<ScmReleaseMetadataResult>;
  createReleaseReferenceComments?: (
    input: ScmReleaseReferenceCommentsInput,
    context: ScmClientContext,
  ) => Promise<ScmReleaseReferenceCommentsResult>;
}
