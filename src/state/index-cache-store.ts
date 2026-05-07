import { promises as fs } from "node:fs";
import path from "node:path";
import type { ResourceMeta, ResourceType } from "../domain/resource.js";
import { PathResolver } from "../utils/path-resolver.js";

interface IndexEntry {
  repoId: string;
  type: ResourceType;
  metadataHash?: string;
  baseDirMtimeMs?: number;
  updatedAt: string;
  resources: ResourceMeta[];
}

interface IndexFile {
  version: 1;
  entries: IndexEntry[];
}

export class IndexCacheStore {
  private readonly paths = new PathResolver();

  getIndexPath(): string {
    return path.join(this.paths.getHimanRoot(), "index.json");
  }

  async get(repoId: string, type: ResourceType): Promise<IndexEntry | null> {
    const data = await this.load();
    if (!data) return null;
    return data.entries.find((item) => item.repoId === repoId && item.type === type) ?? null;
  }

  async upsert(
    repoId: string,
    type: ResourceType,
    metadataHash: string,
    resources: ResourceMeta[],
  ): Promise<void> {
    const now = new Date().toISOString();
    const file: IndexFile = (await this.load()) ?? { version: 1, entries: [] };
    const found = file.entries.find((item) => item.repoId === repoId && item.type === type);
    if (found) {
      found.metadataHash = metadataHash;
      delete found.baseDirMtimeMs;
      found.resources = resources;
      found.updatedAt = now;
    } else {
      file.entries.push({
        repoId,
        type,
        metadataHash,
        resources,
        updatedAt: now,
      });
    }

    await fs.mkdir(path.dirname(this.getIndexPath()), { recursive: true });
    await fs.writeFile(this.getIndexPath(), JSON.stringify(file, null, 2), "utf8");
  }

  private async load(): Promise<IndexFile | null> {
    try {
      const raw = await fs.readFile(this.getIndexPath(), "utf8");
      const parsed = JSON.parse(raw) as IndexFile;
      if (parsed.version !== 1 || !Array.isArray(parsed.entries)) return null;
      return parsed;
    } catch {
      return null;
    }
  }
}
