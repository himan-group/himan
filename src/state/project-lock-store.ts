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
  agents?: string[];
  mode?: InstallMode;
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

    lock.source = source;
    lock.updatedAt = now;

    const found = lock.resources.find(
      (item) => item.type === resource.type && item.name === resource.name,
    );
    if (found) {
      found.version = resource.version;
      found.agents = resource.agents;
      found.mode = resource.mode;
      found.updatedAt = now;
    } else {
      lock.resources.push({
        type: resource.type,
        name: resource.name,
        version: resource.version,
        agents: resource.agents,
        mode: resource.mode,
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
