export type ResourceType = "rule" | "command" | "skill";

export interface ResourceRef {
  type: ResourceType;
  name: string;
  version?: string;
}

export interface ResourceMeta {
  name: string;
  type: ResourceType;
  entry: string;
  description?: string;
  targets?: string[];
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
  targets?: string[];
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
