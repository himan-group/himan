import type {
  ArchiveOptions,
  ArchiveResult,
  CommentOptions,
  CommentResult,
  CreateOptions,
  CreateResult,
  PublishResult,
  RenameOptions,
  RenameResult,
  ResourceListOptions,
  ResourceMeta,
  ResourceType,
  RestoreOptions,
  RestoreResult,
  VersionInfo,
} from "../../domain/resource.js";
import type {
  SourceDocsOptions,
  SourceDocsResult,
} from "../../domain/source-docs.js";

export interface SourceConfig {
  type: "git" | "registry";
  repo?: string;
  repoId?: string;
  repoDir?: string;
  endpoint?: string;
}

export interface ResourceSourceAdapter {
  init(sourceConfig: SourceConfig): Promise<void>;
  list(type: ResourceType, options?: ResourceListOptions): Promise<ResourceMeta[]>;
  history(type: ResourceType, name: string): Promise<VersionInfo[]>;
  isArchived(type: ResourceType, name: string): Promise<boolean>;
  pull(
    type: ResourceType,
    name: string,
    version: string,
    targetDir: string,
  ): Promise<void>;
  publish(
    type: ResourceType,
    name: string,
    version: string,
    sourceDir: string,
    options?: Record<string, unknown>,
  ): Promise<PublishResult>;
  create(
    type: ResourceType,
    name: string,
    options: CreateOptions,
  ): Promise<CreateResult>;
  rename(
    type: ResourceType,
    oldName: string,
    newName: string,
    options?: RenameOptions,
  ): Promise<RenameResult>;
  comment(
    type: ResourceType,
    name: string,
    options: CommentOptions,
  ): Promise<CommentResult>;
  archive(
    type: ResourceType,
    name: string,
    options?: ArchiveOptions,
  ): Promise<ArchiveResult>;
  restore(
    type: ResourceType,
    name: string,
    options?: RestoreOptions,
  ): Promise<RestoreResult>;
  initDocs(options: SourceDocsOptions): Promise<SourceDocsResult>;
}
