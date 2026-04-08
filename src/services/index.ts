import { GitSourceAdapter } from "../adapters/source/git-source-adapter.js";
import { RegistrySourceAdapter } from "../adapters/source/registry-source-adapter.js";
import type {
  ResourceSourceAdapter,
  SourceConfig,
} from "../adapters/source/resource-source-adapter.js";
import type {
  CreateOptions,
  CreateResult,
  ResourceMeta,
  ResourceType,
  VersionInfo,
} from "../domain/resource.js";
import { StateStore } from "../state/state-store.js";
import { ProjectLockStore } from "../state/project-lock-store.js";
import type { SourceState } from "../state/state-store.js";
import { PathResolver } from "../utils/path-resolver.js";
import { toRepoId } from "../utils/repo-id.js";
import { HimanError, errorCodes } from "../utils/errors.js";
import path from "node:path";
import { promises as fs } from "node:fs";
import { VersionResolver } from "../adapters/version/version-resolver.js";

export class ServiceFactory {
  private readonly stateStore = new StateStore();
  private readonly lockStore = new ProjectLockStore();
  private readonly paths = new PathResolver();
  private readonly versions = new VersionResolver();

  async initSource(
    type: "git" | "registry",
    repo?: string,
  ): Promise<{ sourceType: "git" | "registry"; repo?: string; repoId?: string }> {
    await this.stateStore.ensureBaseDirs();
    const sourceConfig = this.buildSourceConfig(type, repo);
    const source = this.createSource(type);
    await source.init(sourceConfig);
    const stateSource: SourceState = {
      type,
      repo: sourceConfig.repo,
      repoId: sourceConfig.repoId,
    };
    await this.stateStore.saveConfig({
      source: stateSource,
      sources: {
        default: "default",
        items: { default: stateSource },
      },
    });
    return {
      sourceType: type,
      repo: sourceConfig.repo,
      repoId: sourceConfig.repoId,
    };
  }

  async addSource(
    name: string,
    type: "git" | "registry",
    repo?: string,
  ): Promise<{ name: string; type: "git" | "registry"; repo?: string; repoId?: string }> {
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name)) {
      throw new HimanError(errorCodes.INVALID_INPUT, `Invalid source name: ${name}`);
    }
    await this.stateStore.ensureBaseDirs();
    const sourceConfig = this.buildSourceConfig(type, repo);
    const source = this.createSource(type);
    await source.init(sourceConfig);

    const stateSource: SourceState = {
      type,
      repo: sourceConfig.repo,
      repoId: sourceConfig.repoId,
    };

    const current = await this.stateStore.loadConfig();
    const items = { ...(current?.sources?.items ?? {}) };
    items[name] = stateSource;
    const defaultName = current?.sources?.default ?? name;
    const defaultSource = items[defaultName] ?? stateSource;
    await this.stateStore.saveConfig({
      source: defaultSource,
      sources: {
        default: defaultName,
        items,
      },
    });

    return { name, type, repo: sourceConfig.repo, repoId: sourceConfig.repoId };
  }

  async useSource(name: string): Promise<{ name: string }> {
    const config = await this.stateStore.loadConfig();
    if (!config?.sources) {
      throw new HimanError(errorCodes.CONFIG_NOT_FOUND, "No source configured.");
    }
    const target = config.sources.items[name];
    if (!target) {
      throw new HimanError(errorCodes.RESOURCE_NOT_FOUND, `Source not found: ${name}`);
    }
    await this.stateStore.saveConfig({
      source: target,
      sources: {
        default: name,
        items: config.sources.items,
      },
    });
    return { name };
  }

  async listSources(): Promise<
    Array<{ name: string; type: "git" | "registry"; repo?: string; repoId?: string; isDefault: boolean }>
  > {
    const config = await this.stateStore.loadConfig();
    if (!config?.sources) return [];
    return Object.entries(config.sources.items).map(([name, source]) => ({
      name,
      type: source.type,
      repo: source.repo,
      repoId: source.repoId,
      isDefault: name === config.sources?.default,
    }));
  }

  async list(type: ResourceType): Promise<ResourceMeta[]> {
    const source = await this.loadSourceFromConfig();
    return source.list(type);
  }

  async history(type: ResourceType, name: string): Promise<VersionInfo[]> {
    const source = await this.loadSourceFromConfig();
    return source.history(type, name);
  }

  async install(
    type: ResourceType,
    name: string,
    version: string | undefined,
    projectDir: string,
  ): Promise<{ type: ResourceType; name: string; version: string; linkPath: string }> {
    const source = await this.loadSourceFromConfig();
    const sourceInfo = await this.getLockSourceInfo();
    const history = await source.history(type, name);
    if (history.length === 0) {
      throw new HimanError(
        errorCodes.RESOURCE_NOT_FOUND,
        `Resource not found: ${type}/${name}`,
      );
    }

    const resolvedVersion = this.resolveVersion(history, version);
    const storePath = this.getStorePath(type, name, resolvedVersion);
    const linkPath = this.getProjectResourcePath(projectDir, type, name);
    if (!(await this.exists(storePath))) {
      await source.pull(type, name, resolvedVersion, storePath);
    }
    await this.switchSymlink(storePath, linkPath);
    await this.lockStore.upsertResource(projectDir, sourceInfo, {
      type,
      name,
      version: resolvedVersion,
    });

    return { type, name, version: resolvedVersion, linkPath };
  }

  async dev(
    type: ResourceType,
    name: string,
    projectDir: string,
  ): Promise<{ type: ResourceType; name: string; devPath: string; linkPath: string }> {
    const linkPath = this.getProjectResourcePath(projectDir, type, name);
    const installedPath = await this.readInstalledPath(linkPath);
    const devPath = this.getProjectDevPath(projectDir, type, name);
    if (!(await this.exists(devPath))) {
      await fs.mkdir(path.dirname(devPath), { recursive: true });
      await fs.cp(installedPath, devPath, { recursive: true });
    }
    await this.switchSymlink(devPath, linkPath);
    return { type, name, devPath, linkPath };
  }

  async uninstall(
    type: ResourceType,
    name: string,
    projectDir: string,
  ): Promise<{ type: ResourceType; name: string; linkPath: string }> {
    const linkPath = this.getProjectResourcePath(projectDir, type, name);
    if (!(await this.exists(linkPath))) {
      throw new HimanError(
        errorCodes.INSTALL_NOT_FOUND,
        `Installed resource link not found: ${linkPath}.`,
      );
    }

    await fs.rm(linkPath, { recursive: true, force: true });
    await this.lockStore.removeResource(projectDir, { type, name });
    return { type, name, linkPath };
  }

  async publish(
    type: ResourceType,
    name: string,
    releaseType: "patch" | "minor" | "major",
    projectDir: string,
  ): Promise<{ type: ResourceType; name: string; version: string; tag: string }> {
    const source = await this.loadSourceFromConfig();
    const sourceDir = await this.resolvePublishSourceDir(type, name, projectDir);

    const history = await source.history(type, name);
    const latest = history[0]?.version ?? "0.0.0";
    const nextVersion = this.versions.nextVersion(latest, releaseType);
    const result = await source.publish(type, name, nextVersion, sourceDir, {
      releaseType,
    });

    const storePath = this.getStorePath(type, name, nextVersion);
    if (!(await this.exists(storePath))) {
      await source.pull(type, name, nextVersion, storePath);
    }
    const linkPath = this.getProjectResourcePath(projectDir, type, name);
    if (await this.exists(linkPath)) {
      await this.switchSymlink(storePath, linkPath);
    }

    if (await this.isResourceLocked(projectDir, type, name)) {
      const sourceInfo = await this.getLockSourceInfo();
      await this.lockStore.upsertResource(projectDir, sourceInfo, {
        type,
        name,
        version: nextVersion,
      });
    }

    return { type, name, version: result.version, tag: result.tag };
  }

  async create(
    type: ResourceType,
    name: string,
    options: CreateOptions,
  ): Promise<CreateResult> {
    this.validateCreateInput(type, name, options);
    const source = await this.loadSourceFromConfig();
    return source.create(type, name, {
      description: options.description,
      targets: options.targets,
      entry: options.entry,
      template: options.template ?? "basic",
      force: options.force,
      dryRun: options.dryRun,
    });
  }

  async installFromLock(projectDir: string): Promise<
    Array<{ type: ResourceType; name: string; version: string; linkPath: string }>
  > {
    const { lock, state } = await this.lockStore.loadWithState(projectDir);
    if (state === "missing") {
      throw new HimanError(
        errorCodes.LOCK_NOT_FOUND,
        `Lock file not found: ${this.lockStore.getLockPath(projectDir)}`,
      );
    }
    if (state === "invalid" || !lock) {
      throw new HimanError(
        errorCodes.LOCK_INVALID,
        `Lock file is invalid: ${this.lockStore.getLockPath(projectDir)}`,
      );
    }
    if (lock.resources.length === 0) {
      throw new HimanError(
        errorCodes.LOCK_NOT_FOUND,
        `Lock file has no resources: ${this.lockStore.getLockPath(projectDir)}`,
      );
    }

    const results: Array<{
      type: ResourceType;
      name: string;
      version: string;
      linkPath: string;
    }> = [];
    for (const item of lock.resources) {
      const result = await this.install(item.type, item.name, item.version, projectDir);
      results.push(result);
    }
    return results;
  }

  private async loadSourceFromConfig(): Promise<ResourceSourceAdapter> {
    const config = await this.stateStore.loadConfig();
    if (!config) {
      throw new HimanError(
        errorCodes.CONFIG_NOT_FOUND,
        "Source config not found. Please run `himan init <git_repo>` first.",
      );
    }

    const sourceConfig = this.buildSourceConfig(
      config.source.type,
      config.source.repo,
      config.source.repoId,
    );
    const source = this.createSource(config.source.type);
    await source.init(sourceConfig);
    return source;
  }

  private createSource(type: "git" | "registry"): ResourceSourceAdapter {
    return type === "registry"
      ? new RegistrySourceAdapter()
      : new GitSourceAdapter();
  }

  private async getLockSourceInfo(): Promise<{
    type: "git" | "registry";
    repo?: string;
    repoId?: string;
  }> {
    const config = await this.stateStore.loadConfig();
    if (!config) {
      throw new HimanError(
        errorCodes.CONFIG_NOT_FOUND,
        "Source config not found. Please run `himan init <git_repo>` first.",
      );
    }
    return {
      type: config.source.type,
      repo: config.source.repo,
      repoId: config.source.repoId,
    };
  }

  private async isResourceLocked(
    projectDir: string,
    type: ResourceType,
    name: string,
  ): Promise<boolean> {
    const lock = await this.lockStore.load(projectDir);
    if (!lock) return false;
    return lock.resources.some((item) => item.type === type && item.name === name);
  }

  private buildSourceConfig(
    type: "git" | "registry",
    repo?: string,
    repoId?: string,
  ): SourceConfig {
    if (type === "registry") {
      return { type };
    }
    if (!repo) {
      throw new HimanError(
        errorCodes.INVALID_INPUT,
        "Git repo is required for git source.",
      );
    }

    const effectiveRepoId = repoId ?? toRepoId(repo);
    return {
      type,
      repo,
      repoId: effectiveRepoId,
      repoDir: path.join(this.paths.getReposDir(), effectiveRepoId),
    };
  }

  private resolveVersion(history: VersionInfo[], version?: string): string {
    if (!version) return history[0].version;
    const found = history.find((item) => item.version === version);
    if (!found) {
      throw new HimanError(
        errorCodes.VERSION_NOT_FOUND,
        `Version not found: ${version}`,
      );
    }
    return found.version;
  }

  private getStorePath(type: ResourceType, name: string, version: string): string {
    return path.join(this.paths.getStoreDir(), type, name, version);
  }

  private getProjectResourcePath(
    projectDir: string,
    type: ResourceType,
    name: string,
  ): string {
    if (type === "rule") return path.join(projectDir, ".cursor", "rules", name);
    if (type === "command") return path.join(projectDir, ".cursor", "commands", name);
    return path.join(projectDir, ".cursor", "skills", name);
  }

  private getProjectDevPath(projectDir: string, type: ResourceType, name: string): string {
    return path.join(projectDir, ".himan", "dev", type, name);
  }

  private async switchSymlink(targetPath: string, linkPath: string): Promise<void> {
    await fs.mkdir(path.dirname(linkPath), { recursive: true });
    await fs.rm(linkPath, { recursive: true, force: true });
    await fs.symlink(targetPath, linkPath, "dir");
  }

  private async readInstalledPath(linkPath: string): Promise<string> {
    if (!(await this.exists(linkPath))) {
      throw new HimanError(
        errorCodes.INSTALL_NOT_FOUND,
        `Installed resource link not found: ${linkPath}. Run install first.`,
      );
    }
    return fs.realpath(linkPath);
  }

  private async exists(targetPath: string): Promise<boolean> {
    try {
      await fs.access(targetPath);
      return true;
    } catch {
      return false;
    }
  }

  private async resolvePublishSourceDir(
    type: ResourceType,
    name: string,
    projectDir: string,
  ): Promise<string> {
    const devPath = this.getProjectDevPath(projectDir, type, name);
    if (await this.exists(devPath)) {
      return devPath;
    }

    const repoResourceDir = await this.getRepoResourceDir(type, name);
    if (await this.exists(repoResourceDir)) {
      return repoResourceDir;
    }

    throw new HimanError(
      errorCodes.RESOURCE_NOT_FOUND,
      `No publish source found for ${type}/${name}. Create resource or switch to dev mode first.`,
    );
  }

  private async getRepoResourceDir(type: ResourceType, name: string): Promise<string> {
    const config = await this.stateStore.loadConfig();
    if (!config) {
      throw new HimanError(
        errorCodes.CONFIG_NOT_FOUND,
        "Source config not found. Please run `himan init <git_repo>` first.",
      );
    }

    const sourceConfig = this.buildSourceConfig(
      config.source.type,
      config.source.repo,
      config.source.repoId,
    );
    if (!sourceConfig.repoDir) {
      throw new HimanError(
        errorCodes.INVALID_INPUT,
        "Current source does not support repo directory publish.",
      );
    }
    return path.join(sourceConfig.repoDir, `${this.getTypeDir(type)}`, name);
  }

  private getTypeDir(type: ResourceType): string {
    if (type === "rule") return "rules";
    if (type === "command") return "commands";
    return "skills";
  }

  private validateCreateInput(
    type: ResourceType,
    name: string,
    options: CreateOptions,
  ): void {
    if (!["rule", "command", "skill"].includes(type)) {
      throw new HimanError(
        errorCodes.UNSUPPORTED_RESOURCE_TYPE,
        `Unsupported resource type for create: ${type}`,
      );
    }

    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name)) {
      throw new HimanError(
        errorCodes.INVALID_RESOURCE_NAME,
        `Invalid resource name: ${name}. Use kebab-case only.`,
      );
    }

    if (options.template && options.template !== "basic") {
      throw new HimanError(
        errorCodes.TEMPLATE_NOT_FOUND,
        `Template not found: ${options.template}`,
      );
    }
  }
}
