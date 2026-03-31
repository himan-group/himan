export type ResourceType = "rule";

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
