import { promises as fs } from "node:fs";
import path from "node:path";
import type { ResourceType } from "../domain/resource.js";

export interface LockSourceInfo {
  type: "git" | "registry";
  repo?: string;
  repoId?: string;
}

export interface LockResourceEntry {
  type: ResourceType;
  name: string;
  version: string;
  updatedAt: string;
}

export interface ProjectLock {
  version: 1;
  source: LockSourceInfo;
  updatedAt: string;
  resources: LockResourceEntry[];
}

export class ProjectLockStore {
  getLockPath(projectDir: string): string {
    return path.join(projectDir, "himan.lock");
  }

  async load(projectDir: string): Promise<ProjectLock | null> {
    try {
      const raw = await fs.readFile(this.getLockPath(projectDir), "utf8");
      const parsed = JSON.parse(raw) as ProjectLock;
      if (parsed.version !== 1 || !Array.isArray(parsed.resources)) {
        return null;
      }
      return parsed;
    } catch {
      return null;
    }
  }

  async upsertResource(
    projectDir: string,
    source: LockSourceInfo,
    resource: { type: ResourceType; name: string; version: string },
  ): Promise<void> {
    const now = new Date().toISOString();
    const existing = await this.load(projectDir);
    const lock: ProjectLock = existing ?? {
      version: 1,
      source,
      updatedAt: now,
      resources: [],
    };

    lock.source = source;
    lock.updatedAt = now;

    const found = lock.resources.find(
      (item) => item.type === resource.type && item.name === resource.name,
    );
    if (found) {
      found.version = resource.version;
      found.updatedAt = now;
    } else {
      lock.resources.push({
        type: resource.type,
        name: resource.name,
        version: resource.version,
        updatedAt: now,
      });
    }

    lock.resources.sort((a, b) => {
      if (a.type !== b.type) return a.type.localeCompare(b.type);
      return a.name.localeCompare(b.name);
    });

    await fs.writeFile(this.getLockPath(projectDir), JSON.stringify(lock, null, 2), "utf8");
  }

  async removeResource(
    projectDir: string,
    resource: { type: ResourceType; name: string },
  ): Promise<void> {
    const lock = await this.load(projectDir);
    if (!lock) return;

    const nextResources = lock.resources.filter(
      (item) => !(item.type === resource.type && item.name === resource.name),
    );
    if (nextResources.length === lock.resources.length) {
      return;
    }

    lock.resources = nextResources;
    lock.updatedAt = new Date().toISOString();
    await fs.writeFile(this.getLockPath(projectDir), JSON.stringify(lock, null, 2), "utf8");
  }
}
