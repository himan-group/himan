export interface SourceDocsOptions {
  force?: boolean;
  dryRun?: boolean;
}

export type SourceDocsAction = "created" | "updated" | "skipped";

export interface SourceDocsFileResult {
  path: string;
  action: SourceDocsAction;
  reason?: string;
}

export interface SourceDocsResult {
  sourceDir: string;
  files: SourceDocsFileResult[];
  dryRun: boolean;
}
