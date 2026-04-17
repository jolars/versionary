import type {
  ScmClientContext,
  ScmProvider,
  ScmReleaseMetadataInput,
  ScmReleaseMetadataResult,
  ScmReleaseReferenceCommentsInput,
  ScmReleaseReferenceCommentsResult,
  ScmReviewRequestInput,
  ScmReviewRequestResult,
} from "../scm/types.js";

export type VersionaryPluginCapability =
  | "scm.reviewRequest"
  | "scm.releaseMetadata"
  | "scm.releaseReferenceComments";

export type VersionaryScmReviewRequestInput = ScmReviewRequestInput;

export type VersionaryScmReviewRequestResult = ScmReviewRequestResult;

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
