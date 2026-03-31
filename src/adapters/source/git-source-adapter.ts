import type {
  PublishResult,
  ResourceMeta,
  ResourceType,
  VersionInfo,
} from "../../domain/resource.js";
import type {
  ResourceSourceAdapter,
  SourceConfig,
} from "./resource-source-adapter.js";
import { RepoManager } from "../git/repo-manager.js";

export class GitSourceAdapter implements ResourceSourceAdapter {
  private readonly repoManager = new RepoManager();

  async init(sourceConfig: SourceConfig): Promise<void> {
    if (!sourceConfig.repo) return;
    await this.repoManager.cloneOrFetch(sourceConfig.repo, "");
  }

  async list(_type: ResourceType): Promise<ResourceMeta[]> {
    // TODO: scan rules/*/himan.yaml via ResourceScanner.
    return [];
  }

  async history(_type: ResourceType, _name: string): Promise<VersionInfo[]> {
    // TODO: list tags and sort via semver.
    return [];
  }

  async pull(
    _type: ResourceType,
    _name: string,
    _version: string,
    _targetDir: string,
  ): Promise<void> {
    // TODO: git archive and materialize into store target.
  }

  async publish(
    _type: ResourceType,
    name: string,
    version: string,
    _sourceDir: string,
  ): Promise<PublishResult> {
    const tag = `rule/${name}@${version}`;
    // TODO: perform commit/tag/push and return result.
    return { version, tag };
  }
}
