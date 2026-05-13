import { createHash } from "node:crypto";
import type { ResourceAnalysisMetadata } from "../../domain/resource.js";

const TOKENIZER = "approx-char-v1";
const TOKEN_ESTIMATOR = "ceil(chars/4)";

export interface ResourceAnalysisInput {
  entry: string;
  entryContent: string;
  packageFiles?: Array<{ path: string; content: string }>;
  measuredAt?: Date;
  measuredBy: string;
  generatedBy: string;
}

export function buildResourceAnalysisMetadata(
  input: ResourceAnalysisInput,
): ResourceAnalysisMetadata {
  const measuredAt = input.measuredAt ?? new Date();
  const packageFiles = input.packageFiles?.length
    ? input.packageFiles
    : [{ path: input.entry, content: input.entryContent }];

  return {
    content: {
      tokenizer: TOKENIZER,
      tokenEstimator: TOKEN_ESTIMATOR,
      entryTokens: estimateTokens(input.entryContent),
      packageTokens: estimateTokens(
        packageFiles.map((file) => file.content).join("\n"),
      ),
      contentHash: hashPackageFiles(packageFiles),
      measuredAt: measuredAt.toISOString(),
      measuredBy: input.measuredBy,
    },
    dependencies: {
      skills: [],
      scripts: [],
      mcpTools: [],
    },
    generation: {
      generatedBy: input.generatedBy,
      generatedAt: measuredAt.toISOString(),
    },
  };
}

function estimateTokens(content: string): number {
  return Math.ceil(content.length / 4);
}

function hashPackageFiles(files: Array<{ path: string; content: string }>): string {
  const hash = createHash("sha256");
  for (const file of [...files].sort((a, b) => a.path.localeCompare(b.path))) {
    hash.update(file.path);
    hash.update("\0");
    hash.update(file.content);
    hash.update("\0");
  }
  return `sha256:${hash.digest("hex")}`;
}
