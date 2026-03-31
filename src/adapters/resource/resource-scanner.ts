import type { ResourceMeta } from "../../domain/resource.js";

export class ResourceScanner {
  async scanRules(_repoDir: string): Promise<ResourceMeta[]> {
    // TODO: scan rules/*/himan.yaml and parse yaml.
    return [];
  }
}
