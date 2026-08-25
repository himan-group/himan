import { promises as fs } from "node:fs";
import path from "node:path";
import { PathResolver } from "../utils/path-resolver.js";

export interface SourceState {
  type: "git" | "registry" | "local";
  alias?: string;
  repo?: string;
  repoId?: string;
  endpoint?: string;
}

export interface HimanConfig {
  source?: SourceState;
  sources?: {
    default: string;
    items: Record<string, SourceState>;
  };
  agents?: string[];
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
    const normalized = this.normalizeConfig(config);
    await fs.mkdir(path.dirname(this.getConfigPath()), { recursive: true });
    await fs.writeFile(this.getConfigPath(), JSON.stringify(normalized, null, 2));
  }

  async loadConfig(): Promise<HimanConfig | null> {
    try {
      const raw = await fs.readFile(this.getConfigPath(), "utf8");
      return this.normalizeConfig(JSON.parse(raw) as Partial<HimanConfig>);
    } catch {
      return null;
    }
  }

  private normalizeConfig(input: Partial<HimanConfig>): HimanConfig {
    if (input.sources?.default && input.sources.items) {
      const defaultName = input.sources.default;
      const defaultSource = input.sources.items[defaultName];
      if (defaultSource) {
        return {
          source: defaultSource,
          sources: {
            default: defaultName,
            items: input.sources.items,
          },
          agents: input.agents,
        };
      }
    }

    const fallback = input.source;
    if (!fallback) {
      return {
        agents: input.agents,
      };
    }

    return {
      source: fallback,
      sources: {
        default: "default",
        items: {
          default: fallback,
        },
      },
      agents: input.agents,
    };
  }
}
