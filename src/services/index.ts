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
import { PathResolver } from "../utils/path-resolver.js";
import { toRepoId } from "../utils/repo-id.js";
import { HimanError, errorCodes } from "../utils/errors.js";
import path from "node:path";
import { promises as fs } from "node:fs";
import { VersionResolver } from "../adapters/version/version-resolver.js";

export class ServiceFactory {
  private readonly stateStore = new StateStore();
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
    await this.stateStore.saveConfig({
      source: { type, repo: sourceConfig.repo, repoId: sourceConfig.repoId },
    });
    return {
      sourceType: type,
      repo: sourceConfig.repo,
      repoId: sourceConfig.repoId,
    };
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
    const history = await source.history(type, name);
    if (history.length === 0) {
      throw new HimanError(
        errorCodes.RESOURCE_NOT_FOUND,
        `Resource not found: ${type}/${name}`,
      );
    }

    const resolvedVersion = this.resolveVersion(history, version);
    const storePath = this.getStorePath(type, name, resolvedVersion);
    const linkPath = this.getProjectRulePath(projectDir, name);
    if (!(await this.exists(storePath))) {
      await source.pull(type, name, resolvedVersion, storePath);
    }
    await this.switchSymlink(storePath, linkPath);

    return { type, name, version: resolvedVersion, linkPath };
  }

  async dev(
    type: ResourceType,
    name: string,
    projectDir: string,
  ): Promise<{ type: ResourceType; name: string; devPath: string; linkPath: string }> {
    if (type !== "rule") {
      throw new HimanError(
        errorCodes.INVALID_INPUT,
        `Unsupported resource type: ${type}`,
      );
    }

    const linkPath = this.getProjectRulePath(projectDir, name);
    const installedPath = await this.readInstalledPath(linkPath);
    const devPath = path.join(projectDir, ".himan", "dev", name);
    if (!(await this.exists(devPath))) {
      await fs.mkdir(path.dirname(devPath), { recursive: true });
      await fs.cp(installedPath, devPath, { recursive: true });
    }
    await this.switchSymlink(devPath, linkPath);
    return { type, name, devPath, linkPath };
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
    if (type === "rule") {
      await this.switchSymlink(storePath, this.getProjectRulePath(projectDir, name));
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

  private getProjectRulePath(projectDir: string, name: string): string {
    return path.join(projectDir, ".cursor", "rules", name);
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
    const devPath = path.join(projectDir, ".himan", "dev", name);
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
