import { promises as fs } from "node:fs";
import path from "node:path";

export interface ProjectConfig {
  version: 1;
  agents?: string[];
  updatedAt: string;
}

export class ProjectConfigStore {
  getConfigPath(projectDir: string): string {
    return path.join(projectDir, ".himan", "config.json");
  }

  async load(projectDir: string): Promise<ProjectConfig | null> {
    try {
      const raw = await fs.readFile(this.getConfigPath(projectDir), "utf8");
      const parsed = JSON.parse(raw) as ProjectConfig;
      if (parsed.version !== 1) return null;
      return parsed;
    } catch {
      return null;
    }
  }

  async saveAgents(projectDir: string, agents: string[]): Promise<ProjectConfig> {
    const now = new Date().toISOString();
    const existing = await this.load(projectDir);
    const config: ProjectConfig = {
      version: 1,
      ...existing,
      agents,
      updatedAt: now,
    };
    await fs.mkdir(path.dirname(this.getConfigPath(projectDir)), { recursive: true });
    await fs.writeFile(this.getConfigPath(projectDir), JSON.stringify(config, null, 2), "utf8");
    return config;
  }

  async clearAgents(projectDir: string): Promise<void> {
    const existing = await this.load(projectDir);
    if (!existing) return;
    const config: ProjectConfig = {
      ...existing,
      agents: undefined,
      updatedAt: new Date().toISOString(),
    };
    await fs.writeFile(this.getConfigPath(projectDir), JSON.stringify(config, null, 2), "utf8");
  }
}
