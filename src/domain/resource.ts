export type ResourceType = "rule" | "command" | "skill";
export type InstallMode = "link" | "copy";

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
  agents?: string[];
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
