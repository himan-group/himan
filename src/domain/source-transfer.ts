import type { ResourceType } from "./resource.js";

export interface GitSourceEndpoint {
  name?: string;
  repo: string;
  repoId?: string;
}

export interface SourceTransferOptions {
  branch?: string;
  targetBranch?: string;
  addSource?: string;
  use?: boolean;
  dryRun?: boolean;
}

export interface SourceCloneOptions {
  branch?: string;
  targetBranch?: string;
  dryRun?: boolean;
}

export interface GitSourceCloneResult {
  branch: string;
  targetBranch: string;
  tags: string[];
  dryRun: boolean;
  pushed: boolean;
}

export interface SourceCloneResult extends GitSourceCloneResult {
  source: GitSourceEndpoint;
  target: GitSourceEndpoint;
  addedSource?: string;
  usedSource?: string;
}

export interface SourceSyncResource {
  type: ResourceType;
  name: string;
  version: string;
  tag: string;
  sourceRef?: string;
  sourcePath?: string;
}

export type SourceSyncTagAction = "created" | "skipped";

export interface SourceSyncResourceResult {
  type: ResourceType;
  name: string;
  version: string;
  tag: string;
  action: SourceSyncTagAction;
}

export interface SourceSyncOptions {
  targetBranch?: string;
  dryRun?: boolean;
}

export interface GitSourceSyncResult {
  targetBranch: string;
  resources: SourceSyncResourceResult[];
  dryRun: boolean;
  committed: boolean;
  pushed: boolean;
}

export interface SourceSyncResult extends GitSourceSyncResult {
  source: GitSourceEndpoint;
  target: GitSourceEndpoint;
  addedSource?: string;
  usedSource?: string;
}
