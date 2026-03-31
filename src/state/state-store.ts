import { promises as fs } from "node:fs";
import path from "node:path";
import { PathResolver } from "../utils/path-resolver.js";

export interface HimanConfig {
  source: {
    type: "git" | "registry";
    repo?: string;
    repoId?: string;
    endpoint?: string;
  };
}

export class StateStore {
  private readonly paths = new PathResolver();

  getConfigPath(): string {
    return path.join(this.paths.getHimanRoot(), "config.json");
  }

  async ensureBaseDirs(): Promise<void> {
    await fs.mkdir(this.paths.getReposDir(), { recursive: true });
    await fs.mkdir(this.paths.getStoreDir(), { recursive: true });
  }

  async saveConfig(config: HimanConfig): Promise<void> {
    await fs.mkdir(path.dirname(this.getConfigPath()), { recursive: true });
    await fs.writeFile(this.getConfigPath(), JSON.stringify(config, null, 2));
  }

  async loadConfig(): Promise<HimanConfig | null> {
    try {
      const raw = await fs.readFile(this.getConfigPath(), "utf8");
      return JSON.parse(raw) as HimanConfig;
    } catch {
      return null;
    }
  }
}
