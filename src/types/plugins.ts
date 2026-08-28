import type {
  ScmClientContext,
  ScmListReviewRequestsInput,
  ScmProvider,
  ScmReleaseMetadataInput,
  ScmReleaseMetadataResult,
  ScmReleaseReferenceCommentsInput,
  ScmReleaseReferenceCommentsResult,
  ScmReviewRequestInput,
  ScmReviewRequestResult,
  ScmReviewRequestSummary,
} from "../scm/types.js";

export type VersionaryPluginCapability =
  | "scm.reviewRequest"
  | "scm.releaseMetadata"
  | "scm.releaseReferenceComments";

export type VersionaryScmReviewRequestInput = ScmReviewRequestInput;

export type VersionaryScmReviewRequestResult = ScmReviewRequestResult;

export type VersionaryScmListReviewRequestsInput = ScmListReviewRequestsInput;

export type VersionaryScmReviewRequestSummary = ScmReviewRequestSummary;

export type VersionaryScmReleaseMetadataInput = ScmReleaseMetadataInput;

export type VersionaryScmReleaseMetadataResult = ScmReleaseMetadataResult;

export type VersionaryScmReleaseReferenceCommentsInput =
  ScmReleaseReferenceCommentsInput;

export type VersionaryScmReleaseReferenceCommentsResult =
  ScmReleaseReferenceCommentsResult;

export type VersionaryPluginContext = ScmClientContext;

export interface VersionaryPluginRuntime {
  name: string;
  capabilities: VersionaryPluginCapability[];
  provider?: ScmProvider;
  createOrUpdateReviewRequest?: (
    input: VersionaryScmReviewRequestInput,
    context: VersionaryPluginContext,
  ) => Promise<VersionaryScmReviewRequestResult>;
  createReleaseMetadata?: (
    input: VersionaryScmReleaseMetadataInput,
    context: VersionaryPluginContext,
  ) => Promise<VersionaryScmReleaseMetadataResult>;
  createReleaseReferenceComments?: (
    input: VersionaryScmReleaseReferenceCommentsInput,
    context: VersionaryPluginContext,
  ) => Promise<VersionaryScmReleaseReferenceCommentsResult>;
}
