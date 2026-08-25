import { promises as fs } from "node:fs";
import path from "node:path";
import type { InstallMode, ResourceType } from "../domain/resource.js";
import { PathResolver } from "../utils/path-resolver.js";

export type InstallScope = "project" | "global";

export interface InstalledRegistryEntry {
  scope: InstallScope;
  /** Current project directory for project-scope installs. */
  projectDir?: string;
  /** Normalized agent name (for example `codex`). */
  agent: string;
  type: ResourceType;
  name: string;
  version: string;
  source?: string;
  mode: InstallMode;
  targetPath: string;
  updatedAt: string;
}

export interface InstalledRegistry {
  version: 1;
  entries: InstalledRegistryEntry[];
}

export interface RegistryRemoveFilter {
  scope: InstallScope;
  projectDir?: string;
  agent?: string;
  type?: ResourceType;
  name?: string;
}

/**
 * Machine-level install registry at `~/.himan/installed.json`.
 *
 * Unlike `himan.lock` (a project file that can be committed), this registry is a
 * local runtime record of both project and global installs, and is the
 * authoritative source for `system audit` managed/drifted classification and
 * global resource versions.
 */
export class InstalledRegistryStore {
  private readonly paths = new PathResolver();

  getRegistryPath(): string {
    return path.join(this.paths.getHimanRoot(), "installed.json");
  }

  async load(): Promise<InstalledRegistry> {
    try {
      const raw = await fs.readFile(this.getRegistryPath(), "utf8");
      const parsed = JSON.parse(raw) as InstalledRegistry;
      if (parsed.version !== 1 || !Array.isArray(parsed.entries)) {
        return { version: 1, entries: [] };
      }
      return { version: 1, entries: parsed.entries };
    } catch {
      return { version: 1, entries: [] };
    }
  }

  async save(registry: InstalledRegistry): Promise<void> {
    await fs.mkdir(this.paths.getHimanRoot(), { recursive: true });
    await fs.writeFile(this.getRegistryPath(), `${JSON.stringify(registry, null, 2)}\n`);
  }

  async upsert(entry: InstalledRegistryEntry): Promise<void> {
    await this.upsertMany([entry]);
  }

  async upsertMany(entries: InstalledRegistryEntry[]): Promise<void> {
    if (entries.length === 0) return;
    const registry = await this.load();
    for (const entry of entries) {
      const key = entryKey(entry);
      const index = registry.entries.findIndex((item) => entryKey(item) === key);
      if (index >= 0) {
        registry.entries[index] = entry;
      } else {
        registry.entries.push(entry);
      }
    }
    await this.save(registry);
  }

  async remove(filter: RegistryRemoveFilter): Promise<void> {
    const registry = await this.load();
    const next = registry.entries.filter((entry) => {
      if (entry.scope !== filter.scope) return true;
      if (filter.projectDir !== undefined && entry.projectDir !== filter.projectDir) {
        return true;
      }
      if (filter.agent !== undefined && entry.agent !== filter.agent) return true;
      if (filter.type !== undefined && entry.type !== filter.type) return true;
      if (filter.name !== undefined && entry.name !== filter.name) return true;
      return false;
    });
    if (next.length !== registry.entries.length) {
      await this.save({ version: 1, entries: next });
    }
  }
}

function entryKey(
  entry: Pick<InstalledRegistryEntry, "scope" | "projectDir" | "agent" | "type" | "name">,
): string {
  return [
    entry.scope,
    entry.projectDir ?? "",
    entry.agent,
    entry.type,
    entry.name,
  ].join("\u0000");
}
