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
import { ResourceScanner } from "../resource/resource-scanner.js";
import semver from "semver";
import { HimanError, errorCodes } from "../../utils/errors.js";

export class GitSourceAdapter implements ResourceSourceAdapter {
  private readonly repoManager = new RepoManager();
  private readonly scanner = new ResourceScanner();
  private sourceConfig: SourceConfig | null = null;

  async init(sourceConfig: SourceConfig): Promise<void> {
    if (!sourceConfig.repo || !sourceConfig.repoDir) {
      throw new HimanError(
        errorCodes.INVALID_INPUT,
        "Git source requires repo and repoDir.",
      );
    }

    this.sourceConfig = sourceConfig;
    await this.repoManager.cloneOrFetch(sourceConfig.repo, sourceConfig.repoDir);
  }

  async list(type: ResourceType): Promise<ResourceMeta[]> {
    if (type !== "rule") return [];
    return this.scanner.scanRules(this.getRepoDir());
  }

  async history(type: ResourceType, name: string): Promise<VersionInfo[]> {
    if (type !== "rule") return [];
    const tags = await this.repoManager.listTags(
      this.getRepoDir(),
      `${type}/${name}@*`,
    );

    const versions = tags
      .map((tag) => ({ raw: tag, version: tag.split("@").at(1) ?? "" }))
      .filter((item) => semver.valid(item.version))
      .sort((a, b) => semver.rcompare(a.version, b.version));

    return versions;
  }

  async pull(
    type: ResourceType,
    name: string,
    version: string,
    targetDir: string,
  ): Promise<void> {
    const tag = `${type}/${name}@${version}`;
    await this.repoManager.archiveResource(
      this.getRepoDir(),
      tag,
      `${type}s/${name}`,
      targetDir,
    );
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

  private getRepoDir(): string {
    if (!this.sourceConfig?.repoDir) {
      throw new HimanError(
        errorCodes.CONFIG_NOT_FOUND,
        "Git source is not initialized.",
      );
    }
    return this.sourceConfig.repoDir;
  }
}
