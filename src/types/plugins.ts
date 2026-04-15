export type VersionaryPluginCapability =
  | "scm.reviewRequest"
  | "scm.releaseMetadata";

export interface VersionaryScmReviewRequestInput {
  baseBranch: string;
  headBranch: string;
  title: string;
  body: string;
  labels?: string[];
}

export interface VersionaryScmReviewRequestResult {
  id: string;
  number?: number;
  url: string;
  state: "open" | "closed" | "merged";
}

export interface VersionaryScmReleaseMetadataInput {
  tag: string;
  version: string;
  notes: string;
}

export interface VersionaryScmReleaseMetadataResult {
  url: string;
  status?: "created" | "exists";
}

export interface VersionaryPluginContext {
  cwd: string;
  logger?: {
    info: (message: string) => void;
    warn: (message: string) => void;
    error: (message: string) => void;
  };
}

export interface VersionaryPluginRuntime {
  name: string;
  capabilities: VersionaryPluginCapability[];
  createOrUpdateReviewRequest?: (
    input: VersionaryScmReviewRequestInput,
    context: VersionaryPluginContext,
  ) => Promise<VersionaryScmReviewRequestResult>;
  createReleaseMetadata?: (
    input: VersionaryScmReleaseMetadataInput,
    context: VersionaryPluginContext,
  ) => Promise<VersionaryScmReleaseMetadataResult>;
}
