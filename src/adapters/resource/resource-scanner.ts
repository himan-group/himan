import type { ResourceMeta, ResourceType } from "../../domain/resource.js";
import { promises as fs } from "node:fs";
import path from "node:path";
import YAML from "yaml";

interface ResourceScanOptions {
  archived?: boolean;
}

export class ResourceScanner {
  async scanRules(repoDir: string): Promise<ResourceMeta[]> {
    return this.scanByType(repoDir, "rule");
  }

  async scanByType(
    repoDir: string,
    type: ResourceType,
    options: ResourceScanOptions = {},
  ): Promise<ResourceMeta[]> {
    const baseDir = options.archived
      ? path.join(repoDir, "archive", this.getTypeDir(type))
      : path.join(repoDir, this.getTypeDir(type));
    const hasBaseDir = await this.exists(baseDir);
    if (!hasBaseDir) return [];

    const entries = await fs.readdir(baseDir, { withFileTypes: true });
    const resourceDirs = entries.filter((entry) => entry.isDirectory());
    const result: ResourceMeta[] = [];

    for (const resourceDir of resourceDirs) {
      const yamlPath = path.join(baseDir, resourceDir.name, "himan.yaml");
      if (await this.exists(yamlPath)) {
        const raw = await fs.readFile(yamlPath, "utf8");
        const parsed = YAML.parse(raw) as Partial<ResourceMeta> | null;
        if (!parsed) continue;
        if (parsed.type !== type) continue;
        if (!parsed.name || !parsed.entry) continue;

        result.push({
          name: parsed.name,
          type,
          entry: parsed.entry,
          version: this.readStringMetadata(parsed, "version"),
          category: this.readStringMetadata(parsed, "category"),
          description: parsed.description,
          ...this.readCommentMetadata(parsed),
          agents: Array.isArray((parsed as { agents?: unknown }).agents)
            ? ((parsed as { agents?: string[] }).agents ?? [])
            : ((parsed as { targets?: string[] }).targets ?? []),
          ...(options.archived
            ? {
                archived: true,
                archivedAt: this.readStringMetadata(parsed, "archivedAt"),
                archiveReason: this.readStringMetadata(parsed, "archiveReason"),
              }
            : {}),
        });
        continue;
      }

      const inferred = await this.inferResourceMeta(
        path.join(baseDir, resourceDir.name),
        resourceDir.name,
        type,
        options,
      );
      if (inferred) result.push(inferred);
    }

    return result;
  }

  private async inferResourceMeta(
    resourceDir: string,
    dirName: string,
    type: ResourceType,
    options: ResourceScanOptions,
  ): Promise<ResourceMeta | undefined> {
    const entry = this.getDefaultEntry(type);
    const entryPath = path.join(resourceDir, entry);
    if (!(await this.exists(entryPath))) return undefined;

    const metadata =
      type === "skill" ? await this.readSkillFrontMatter(entryPath) : null;
    return {
      name: this.readStringMetadata(metadata, "name") ?? dirName,
      type,
      entry,
      version: this.readStringMetadata(metadata, "version"),
      category: this.readStringMetadata(metadata, "category"),
      description: this.readStringMetadata(metadata, "description"),
      ...this.readCommentMetadata(metadata),
      agents:
        this.readStringArrayMetadata(metadata, "agents") ??
        this.readStringArrayMetadata(metadata, "targets") ??
        [],
      ...(options.archived ? { archived: true } : {}),
    };
  }

  private async readSkillFrontMatter(
    skillPath: string,
  ): Promise<Record<string, unknown> | null> {
    const raw = await fs.readFile(skillPath, "utf8");
    const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(raw.trimStart());
    if (!match) return null;

    try {
      const parsed = YAML.parse(match[1]) as unknown;
      return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : null;
    } catch {
      return null;
    }
  }

  private readStringMetadata(
    metadata: Record<string, unknown> | null,
    key: string,
  ): string | undefined {
    const value = metadata?.[key];
    if (typeof value !== "string") return undefined;
    const trimmed = value.trim();
    return trimmed ? trimmed : undefined;
  }

  private readScoreMetadata(
    metadata: Record<string, unknown> | null,
  ): number | undefined {
    const comment = metadata?.comment;
    if (
      typeof comment !== "object" ||
      comment === null ||
      Array.isArray(comment) ||
      !("score" in comment)
    ) {
      return undefined;
    }
    const value = (comment as { score?: unknown }).score;
    if (typeof value !== "number" || !Number.isInteger(value)) return undefined;
    return value >= 1 && value <= 10 ? value : undefined;
  }

  private readCommentMetadata(
    metadata: Record<string, unknown> | null,
  ): Pick<ResourceMeta, "comment"> {
    const score = this.readScoreMetadata(metadata);
    if (score === undefined) return {};
    const text = this.readCommentTextMetadata(metadata);
    return {
      comment: {
        score,
        ...(text ? { text } : {}),
      },
    };
  }

  private readCommentTextMetadata(
    metadata: Record<string, unknown> | null,
  ): string | undefined {
    const comment = metadata?.comment;
    if (typeof comment !== "object" || comment === null || Array.isArray(comment)) {
      return undefined;
    }
    return this.readStringMetadata(comment as Record<string, unknown>, "text");
  }

  private readStringArrayMetadata(
    metadata: Record<string, unknown> | null,
    key: string,
  ): string[] | undefined {
    const value = metadata?.[key];
    if (!Array.isArray(value)) return undefined;
    const items = value
      .filter((item): item is string => typeof item === "string")
      .map((item) => item.trim())
      .filter(Boolean);
    return items.length > 0 ? items : undefined;
  }

  private async exists(targetPath: string): Promise<boolean> {
    try {
      await fs.access(targetPath);
      return true;
    } catch {
      return false;
    }
  }

  private getTypeDir(type: ResourceType): string {
    if (type === "rule") return "rules";
    if (type === "command") return "commands";
    if (type === "config") return "configs";
    return "skills";
  }

  private getDefaultEntry(type: ResourceType): string {
    if (type === "config") return "config.toml";
    return type === "skill" ? "SKILL.md" : "content.md";
  }
}
