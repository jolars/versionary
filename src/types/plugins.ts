import type {
  ScmClientContext,
  ScmProvider,
  ScmReleaseMetadataInput,
  ScmReleaseMetadataResult,
  ScmReviewRequestInput,
  ScmReviewRequestResult,
} from "../scm/types.js";

export type VersionaryPluginCapability =
  | "scm.reviewRequest"
  | "scm.releaseMetadata";

export type VersionaryScmReviewRequestInput = ScmReviewRequestInput;

export type VersionaryScmReviewRequestResult = ScmReviewRequestResult;

export type VersionaryScmReleaseMetadataInput = ScmReleaseMetadataInput;

export type VersionaryScmReleaseMetadataResult = ScmReleaseMetadataResult;

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
}
