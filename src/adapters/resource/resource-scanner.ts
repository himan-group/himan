import type { ResourceMeta, ResourceType } from "../../domain/resource.js";
import { promises as fs } from "node:fs";
import path from "node:path";
import YAML from "yaml";

export class ResourceScanner {
  async scanRules(repoDir: string): Promise<ResourceMeta[]> {
    return this.scanByType(repoDir, "rule");
  }

  async scanByType(repoDir: string, type: ResourceType): Promise<ResourceMeta[]> {
    const baseDir = path.join(repoDir, this.getTypeDir(type));
    const hasBaseDir = await this.exists(baseDir);
    if (!hasBaseDir) return [];

    const entries = await fs.readdir(baseDir, { withFileTypes: true });
    const resourceDirs = entries.filter((entry) => entry.isDirectory());
    const result: ResourceMeta[] = [];

    for (const resourceDir of resourceDirs) {
      const yamlPath = path.join(baseDir, resourceDir.name, "himan.yaml");
      if (!(await this.exists(yamlPath))) continue;

      const raw = await fs.readFile(yamlPath, "utf8");
      const parsed = YAML.parse(raw) as Partial<ResourceMeta> | null;
      if (!parsed) continue;
      if (parsed.type !== type) continue;
      if (!parsed.name || !parsed.entry) continue;

      result.push({
        name: parsed.name,
        type,
        entry: parsed.entry,
        description: parsed.description,
        targets: parsed.targets,
      });
    }

    return result;
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
    return "skills";
  }
}
