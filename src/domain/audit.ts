import type { InstallMode, ResourceType } from "./resource.js";

export type AuditScope = "global" | "project";
export type AuditStatus = "managed" | "unmanaged" | "drifted";
export type AuditIssueLevel = "warn" | "error";
export type AuditIssueCategory =
  | "duplicate"
  | "version-drift"
  | "lock-missing-target"
  | "lock-modified"
  | "unmanaged"
  | "orphan-store-cache";

export interface AuditResource {
  scope: AuditScope;
  agent: string;
  type: ResourceType;
  name: string;
  version?: string;
  source?: string;
  status: AuditStatus;
  mode?: InstallMode;
  path: string;
}

export interface AuditIssue {
  level: AuditIssueLevel;
  category: AuditIssueCategory;
  message: string;
  path?: string;
  suggestion: string;
}

export interface AuditScopeStats {
  resources: number;
  byType: Record<ResourceType, number>;
  managed: number;
  unmanaged: number;
  drifted: number;
}

export interface AuditAgentStats {
  agent: string;
  resources: number;
  byType: Record<ResourceType, number>;
}

export interface AuditStats {
  agents: AuditAgentStats[];
  scopes: Record<AuditScope, AuditScopeStats>;
  totals: {
    resources: number;
    managed: number;
    unmanaged: number;
    drifted: number;
  };
  issues: Record<AuditIssueCategory, number>;
}

export interface AuditResult {
  resources: AuditResource[];
  issues: AuditIssue[];
  stats: AuditStats;
}
