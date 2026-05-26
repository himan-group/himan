export type ResourceType = "rule" | "command" | "skill" | "config";
export type InstallMode = "link" | "copy";

export interface ResourceRef {
  type: ResourceType;
  name: string;
  version?: string;
}

export interface ResourceComment {
  score: number;
  text?: string;
}

export interface ResourceMeta {
  name: string;
  type: ResourceType;
  entry: string;
  version?: string;
  category?: string;
  description?: string;
  comment?: ResourceComment;
  agents?: string[];
  archived?: boolean;
  archivedAt?: string;
  archiveReason?: string;
}

export interface ResourceAnalysisMetadata {
  content?: {
    tokenizer?: string;
    tokenEstimator?: string;
    entryTokens?: number;
    packageTokens?: number;
    contentHash?: string;
    measuredAt?: string;
    measuredBy?: string;
  };
  dependencies?: {
    skills?: Array<string | { name: string; optional?: boolean }>;
    scripts?: Array<string | { path: string; optional?: boolean; purpose?: string }>;
    mcpTools?: string[];
  };
  generation?: {
    generatedBy?: string;
    generatedAt?: string;
    model?: string;
    promptRef?: string;
  };
}

export interface VersionInfo {
  version: string;
  raw: string;
}

export interface PublishResult {
  version: string;
  tag: string;
}

export interface CreateOptions {
  description?: string;
  agents?: string[];
  entry?: string;
  template?: string;
  force?: boolean;
  dryRun?: boolean;
}

export interface CreateResult {
  type: ResourceType;
  name: string;
  resourceDir: string;
  files: string[];
  dryRun: boolean;
}

export interface RenameOptions {
  dryRun?: boolean;
}

export interface RenameResult {
  type: ResourceType;
  oldName: string;
  newName: string;
  previousResourceDir: string;
  resourceDir: string;
  latestVersion?: string;
  tag?: string;
  committed: boolean;
  dryRun: boolean;
}

export interface CommentOptions {
  score: number;
  text?: string;
  clearText?: boolean;
  dryRun?: boolean;
}

export interface CommentResult {
  type: ResourceType;
  name: string;
  comment: ResourceComment;
  resourceDir: string;
  metadataPath: string;
  committed: boolean;
  dryRun: boolean;
}

export interface ResourceListOptions {
  archived?: boolean;
  includeArchived?: boolean;
}

export interface ArchiveOptions {
  reason?: string;
  dryRun?: boolean;
}

export interface ArchiveResult {
  type: ResourceType;
  name: string;
  previousResourceDir: string;
  archiveDir: string;
  archivedAt?: string;
  archiveReason?: string;
  committed: boolean;
  dryRun: boolean;
}

export interface RestoreOptions {
  dryRun?: boolean;
}

export interface RestoreResult {
  type: ResourceType;
  name: string;
  previousArchiveDir: string;
  resourceDir: string;
  committed: boolean;
  dryRun: boolean;
}
