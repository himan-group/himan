import type {
  CreateOptions,
  CreateResult,
  PublishResult,
  ResourceMeta,
  ResourceType,
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
  list(type: ResourceType): Promise<ResourceMeta[]>;
  history(type: ResourceType, name: string): Promise<VersionInfo[]>;
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
  initDocs(options: SourceDocsOptions): Promise<SourceDocsResult>;
}
