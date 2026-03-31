import type { ResourceMeta } from "../../domain/resource.js";
import { promises as fs } from "node:fs";
import path from "node:path";
import YAML from "yaml";

export class ResourceScanner {
  async scanRules(repoDir: string): Promise<ResourceMeta[]> {
    const rulesDir = path.join(repoDir, "rules");
    const hasRulesDir = await this.exists(rulesDir);
    if (!hasRulesDir) return [];

    const entries = await fs.readdir(rulesDir, { withFileTypes: true });
    const ruleDirs = entries.filter((entry) => entry.isDirectory());
    const result: ResourceMeta[] = [];

    for (const ruleDir of ruleDirs) {
      const yamlPath = path.join(rulesDir, ruleDir.name, "himan.yaml");
      if (!(await this.exists(yamlPath))) continue;

      const raw = await fs.readFile(yamlPath, "utf8");
      const parsed = YAML.parse(raw) as Partial<ResourceMeta> | null;
      if (!parsed) continue;
      if (parsed.type !== "rule") continue;
      if (!parsed.name || !parsed.entry) continue;

      result.push({
        name: parsed.name,
        type: "rule",
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
}
