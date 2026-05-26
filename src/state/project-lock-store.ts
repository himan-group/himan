import { promises as fs } from "node:fs";
import path from "node:path";
import type { InstallMode, ResourceType } from "../domain/resource.js";

export interface LockSourceInfo {
  name?: string;
  type: "git" | "registry";
  repo?: string;
  repoId?: string;
}

export interface LockResourceEntry {
  type: ResourceType;
  name: string;
  version: string;
  source?: string;
  agents?: string[];
  mode?: InstallMode;
  updatedAt: string;
}

export interface ProjectLock {
  version: 1;
  source: LockSourceInfo;
  sources?: Record<string, LockSourceInfo>;
  updatedAt: string;
  resources: LockResourceEntry[];
}

export class ProjectLockStore {
  getLockPath(projectDir: string): string {
    return path.join(projectDir, "himan.lock");
  }

  async loadWithState(
    projectDir: string,
  ): Promise<{ lock: ProjectLock | null; state: "ok" | "missing" | "invalid" }> {
    const lockPath = this.getLockPath(projectDir);
    try {
      const raw = await fs.readFile(lockPath, "utf8");
      const parsed = JSON.parse(raw) as ProjectLock;
      if (parsed.version !== 1 || !Array.isArray(parsed.resources)) {
        return { lock: null, state: "invalid" };
      }
      return { lock: parsed, state: "ok" };
    } catch (error) {
      const err = error as NodeJS.ErrnoException;
      if (err?.code === "ENOENT") {
        return { lock: null, state: "missing" };
      }
      return { lock: null, state: "invalid" };
    }
  }

  async load(projectDir: string): Promise<ProjectLock | null> {
    const result = await this.loadWithState(projectDir);
    return result.lock;
  }

  async upsertResource(
    projectDir: string,
    source: LockSourceInfo,
    resource: {
      type: ResourceType;
      name: string;
      version: string;
      source?: string;
      agents?: string[];
      mode?: InstallMode;
    },
  ): Promise<void> {
    const now = new Date().toISOString();
    const existing = await this.load(projectDir);
    const lock: ProjectLock = existing ?? {
      version: 1,
      source,
      updatedAt: now,
      resources: [],
    };

    if (lock.resources.length === 0 && !resource.source) {
      lock.source = source;
    }
    if (resource.source) {
      lock.sources = {
        ...(lock.sources ?? {}),
        [resource.source]: source,
      };
    }
    lock.updatedAt = now;

    const found = lock.resources.find(
      (item) => item.type === resource.type && item.name === resource.name,
    );
    if (found) {
      found.version = resource.version;
      if (resource.source) {
        found.source = resource.source;
      } else {
        delete found.source;
      }
      found.agents = resource.agents;
      found.mode = resource.mode;
      found.updatedAt = now;
    } else {
      lock.resources.push({
        type: resource.type,
        name: resource.name,
        version: resource.version,
        source: resource.source,
        agents: resource.agents,
        mode: resource.mode,
        updatedAt: now,
      });
    }

    lock.resources.sort((a, b) => {
      if (a.type !== b.type) return a.type.localeCompare(b.type);
      return a.name.localeCompare(b.name);
    });
    this.pruneUnusedSources(lock);

    await this.writeLock(projectDir, lock);
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
    this.pruneUnusedSources(lock);
    lock.updatedAt = new Date().toISOString();
    await this.writeLock(projectDir, lock);
  }

  async renameResource(
    projectDir: string,
    resource: { type: ResourceType; oldName: string; newName: string; version?: string },
  ): Promise<void> {
    const lock = await this.load(projectDir);
    if (!lock) return;

    const found = lock.resources.find(
      (item) => item.type === resource.type && item.name === resource.oldName,
    );
    if (!found) return;

    const now = new Date().toISOString();
    found.name = resource.newName;
    found.version = resource.version ?? found.version;
    found.updatedAt = now;
    lock.updatedAt = now;
    lock.resources.sort((a, b) => {
      if (a.type !== b.type) return a.type.localeCompare(b.type);
      return a.name.localeCompare(b.name);
    });
    await this.writeLock(projectDir, lock);
  }

  private pruneUnusedSources(lock: ProjectLock): void {
    if (!lock.sources) return;
    const usedSources = new Set(
      lock.resources
        .map((resource) => resource.source)
        .filter((source): source is string => Boolean(source)),
    );
    const sources = Object.fromEntries(
      Object.entries(lock.sources).filter(([name]) => usedSources.has(name)),
    );
    if (Object.keys(sources).length > 0) {
      lock.sources = sources;
      return;
    }
    delete lock.sources;
  }

  private async writeLock(projectDir: string, lock: ProjectLock): Promise<void> {
    const orderedLock: ProjectLock = {
      version: lock.version,
      source: lock.source,
      ...(lock.sources ? { sources: lock.sources } : {}),
      updatedAt: lock.updatedAt,
      resources: lock.resources,
    };
    await fs.writeFile(
      this.getLockPath(projectDir),
      JSON.stringify(orderedLock, null, 2),
      "utf8",
    );
  }
}
