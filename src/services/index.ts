import { GitSourceAdapter } from "../adapters/source/git-source-adapter.js";
import { RegistrySourceAdapter } from "../adapters/source/registry-source-adapter.js";
import type {
  ResourceSourceAdapter,
  SourceConfig,
} from "../adapters/source/resource-source-adapter.js";
import type {
  CreateOptions,
  CreateResult,
  InstallMode,
  RenameResult,
  ResourceMeta,
  ResourceType,
  VersionInfo,
} from "../domain/resource.js";
import type {
  SourceDocsOptions,
  SourceDocsResult,
} from "../domain/source-docs.js";
import type {
  GitSourceEndpoint,
  SourceCloneResult,
  SourceSyncResult,
  SourceTransferOptions,
} from "../domain/source-transfer.js";
import { StateStore } from "../state/state-store.js";
import { ProjectConfigStore } from "../state/project-config-store.js";
import {
  ProjectLockStore,
  type LockSourceInfo,
} from "../state/project-lock-store.js";
import type { SourceState } from "../state/state-store.js";
import { PathResolver } from "../utils/path-resolver.js";
import { toRepoId } from "../utils/repo-id.js";
import { HimanError, errorCodes } from "../utils/errors.js";
import {
  getGlobalResourcePaths,
  getProjectResourcePaths,
  getSupportedAgentNames,
  normalizeAgents,
} from "../utils/agent-configs.js";
import path from "node:path";
import { promises as fs } from "node:fs";
import { VersionResolver } from "../adapters/version/version-resolver.js";
import YAML from "yaml";

export interface InstalledResource {
  type: ResourceType;
  name: string;
  version: string;
  agents: string[];
  mode: InstallMode;
  updatedAt: string;
}

export type PublishInstallScope = "project" | "global";

export interface PublishProgress {
  stage:
    | "prepare"
    | "resolve-version"
    | "publish-source"
    | "sync-store"
    | "install"
    | "cleanup"
    | "done";
  message: string;
}

export interface PublishOptions {
  installScope?: PublishInstallScope;
  onProgress?: (progress: PublishProgress) => void;
}

interface ExistingResourceTarget {
  resourcePath: string;
  linkPaths: string[];
  agents: string[];
  mode: InstallMode;
}

export class ServiceFactory {
  private readonly stateStore = new StateStore();
  private readonly projectConfigStore = new ProjectConfigStore();
  private readonly lockStore = new ProjectLockStore();
  private readonly paths = new PathResolver();
  private readonly versions = new VersionResolver();

  async initSource(
    type: "git" | "registry",
    repo?: string,
  ): Promise<{ sourceType: "git" | "registry"; repo?: string; repoId?: string }> {
    await this.stateStore.ensureBaseDirs();
    const current = await this.stateStore.loadConfig();
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
      agents: current?.agents,
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
    this.validateSourceName(name);
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
      agents: current?.agents,
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
      agents: config.agents,
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

  async initSourceDocs(options: SourceDocsOptions): Promise<SourceDocsResult> {
    const source = await this.loadSourceFromConfig();
    return source.initDocs(options);
  }

  async cloneSource(
    from: string,
    to: string,
    options: SourceTransferOptions = {},
  ): Promise<SourceCloneResult> {
    await this.stateStore.ensureBaseDirs();
    this.validateSourceTransferOptions(to, options);
    const sourceEndpoint = await this.resolveGitSourceEndpoint(from);
    const targetEndpoint = await this.resolveGitSourceEndpoint(to);
    this.validateSourceTransferUseTarget(targetEndpoint, options);
    this.ensureDifferentGitSources(sourceEndpoint, targetEndpoint);

    const source = await this.loadGitSourceFromEndpoint(sourceEndpoint);
    const result = await source.cloneTo(targetEndpoint.repo, {
      branch: options.branch,
      targetBranch: options.targetBranch,
      dryRun: options.dryRun,
    });
    const configUpdates = await this.applySourceTransferConfigUpdates(
      targetEndpoint,
      options,
    );

    return {
      source: sourceEndpoint,
      target: targetEndpoint,
      ...result,
      ...configUpdates,
    };
  }

  async syncSource(
    from: string,
    to: string,
    options: SourceTransferOptions = {},
  ): Promise<SourceSyncResult> {
    await this.stateStore.ensureBaseDirs();
    this.validateSourceTransferOptions(to, options);
    const sourceEndpoint = await this.resolveGitSourceEndpoint(from);
    const targetEndpoint = await this.resolveGitSourceEndpoint(to);
    this.validateSourceTransferUseTarget(targetEndpoint, options);
    this.ensureDifferentGitSources(sourceEndpoint, targetEndpoint);

    const source = await this.loadGitSourceFromEndpoint(sourceEndpoint);
    const result = await source.syncLatestTo(targetEndpoint.repo, {
      targetBranch: options.targetBranch,
      dryRun: options.dryRun,
    });
    const configUpdates = await this.applySourceTransferConfigUpdates(
      targetEndpoint,
      options,
    );

    return {
      source: sourceEndpoint,
      target: targetEndpoint,
      ...result,
      ...configUpdates,
    };
  }

  async setAgents(
    agents: string[],
    scope: "global" | "project",
    projectDir: string,
  ): Promise<{ scope: "global" | "project"; agents: string[] }> {
    const normalized = normalizeAgents(agents);
    if (scope === "project") {
      await this.projectConfigStore.saveAgents(projectDir, normalized);
      return { scope, agents: normalized };
    }

    await this.stateStore.ensureBaseDirs();
    const current = await this.stateStore.loadConfig();
    await this.stateStore.saveConfig({
      ...(current ?? {}),
      agents: normalized,
    });
    return { scope, agents: normalized };
  }

  async getAgentSettings(projectDir: string): Promise<{
    global?: string[];
    project?: string[];
    effective: string[];
    supported: string[];
  }> {
    const [globalConfig, projectConfig] = await Promise.all([
      this.stateStore.loadConfig(),
      this.projectConfigStore.load(projectDir),
    ]);
    const global = globalConfig?.agents?.length
      ? normalizeAgents(globalConfig.agents)
      : undefined;
    const project = projectConfig?.agents?.length
      ? normalizeAgents(projectConfig.agents)
      : undefined;
    return {
      global,
      project,
      effective: project ?? global ?? normalizeAgents(),
      supported: getSupportedAgentNames(),
    };
  }

  async clearAgents(
    scope: "global" | "project",
    projectDir: string,
  ): Promise<{ scope: "global" | "project" }> {
    if (scope === "project") {
      await this.projectConfigStore.clearAgents(projectDir);
      return { scope };
    }

    const current = await this.stateStore.loadConfig();
    await this.stateStore.saveConfig({
      ...(current ?? {}),
      agents: undefined,
    });
    return { scope };
  }

  async list(type: ResourceType, agents?: string[]): Promise<ResourceMeta[]> {
    const source = await this.loadSourceFromConfig();
    const resources = await source.list(type);
    if (!agents?.length) return resources;
    const selected = normalizeAgents(agents);
    return resources.filter((resource) =>
      normalizeAgents(resource.agents).some((agent) => selected.includes(agent)),
    );
  }

  async listInstalled(
    projectDir: string,
    type?: ResourceType,
    agents?: string[],
  ): Promise<InstalledResource[]> {
    const { lock, state } = await this.lockStore.loadWithState(projectDir);
    if (state === "invalid") {
      throw new HimanError(
        errorCodes.LOCK_INVALID,
        `Lock file is invalid: ${this.lockStore.getLockPath(projectDir)}`,
      );
    }
    if (state === "missing" || !lock) {
      return [];
    }

    const selectedAgents = agents?.length ? normalizeAgents(agents) : undefined;
    return lock.resources
      .filter((resource) => !type || resource.type === type)
      .map((resource) => ({
        type: resource.type,
        name: resource.name,
        version: resource.version,
        agents: normalizeAgents(resource.agents),
        mode: this.resolveInstallMode(resource.mode),
        updatedAt: resource.updatedAt,
      }))
      .filter(
        (resource) =>
          !selectedAgents ||
          resource.agents.some((agent) => selectedAgents.includes(agent)),
      );
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
    agents?: string[],
    mode: InstallMode = "copy",
  ): Promise<{
    type: ResourceType;
    name: string;
    version: string;
    linkPath: string;
    mode: InstallMode;
  }> {
    const { source, sourceInfo } = await this.loadSourceWithInfoFromConfig();
    return this.installWithSource(
      source,
      sourceInfo,
      type,
      name,
      version,
      projectDir,
      agents,
      mode,
    );
  }

  async installGlobal(
    type: ResourceType,
    name: string,
    version: string | undefined,
    projectDir: string,
    agents?: string[],
    mode: InstallMode = "copy",
  ): Promise<{
    type: ResourceType;
    name: string;
    version: string;
    linkPath: string;
    mode: InstallMode;
  }> {
    const source = await this.loadSourceFromConfig();
    return this.installWithSource(
      source,
      undefined,
      type,
      name,
      version,
      projectDir,
      agents,
      mode,
      "global",
    );
  }

  async dev(
    type: ResourceType,
    name: string,
    projectDir: string,
  ): Promise<{
    type: ResourceType;
    name: string;
    devPath: string;
    linkPath: string;
    mode: InstallMode;
    sourceScope: "project" | "global";
  }> {
    const projectTarget = await this.tryResolveProjectResourceTarget(
      projectDir,
      type,
      name,
    );
    if (projectTarget) {
      return {
        type,
        name,
        devPath: projectTarget.resourcePath,
        linkPath: projectTarget.linkPaths[0],
        mode: projectTarget.mode,
        sourceScope: "project",
      };
    }

    const globalTarget = await this.tryResolveGlobalResourceTarget(
      projectDir,
      type,
      name,
    );
    if (!globalTarget) {
      throw new HimanError(
        errorCodes.INSTALL_NOT_FOUND,
        `Installed resource link not found for ${type}/${name}. Run install first.`,
      );
    }

    const projectLinkPaths = getProjectResourcePaths(
      projectDir,
      type,
      name,
      globalTarget.agents,
    );
    for (const [index, linkPath] of projectLinkPaths.entries()) {
      const sourcePath = globalTarget.linkPaths[index] ?? globalTarget.resourcePath;
      await this.materializeResource(sourcePath, linkPath, "copy");
    }
    return {
      type,
      name,
      devPath: projectLinkPaths[0],
      linkPath: projectLinkPaths[0],
      mode: "copy",
      sourceScope: "global",
    };
  }

  async uninstall(
    type: ResourceType,
    name: string,
    projectDir: string,
  ): Promise<{ type: ResourceType; name: string; linkPath: string }> {
    const installInfo = await this.resolveInstalledResource(projectDir, type, name);
    if (installInfo.linkPaths.length === 0) {
      throw new HimanError(
        errorCodes.INSTALL_NOT_FOUND,
        `Installed resource link not found for ${type}/${name}.`,
      );
    }

    for (const linkPath of installInfo.linkPaths) {
      await fs.rm(linkPath, { recursive: true, force: true });
    }
    await this.lockStore.removeResource(projectDir, { type, name });
    return { type, name, linkPath: installInfo.linkPaths[0] };
  }

  async publish(
    type: ResourceType,
    name: string,
    releaseType: "patch" | "minor" | "major",
    projectDir: string,
    options: PublishOptions = {},
  ): Promise<{
    type: ResourceType;
    name: string;
    version: string;
    tag: string;
    installScope: PublishInstallScope;
    linkPath: string;
  }> {
    const installScope = options.installScope ?? "project";
    this.reportPublishProgress(options, "prepare", `Preparing ${type}/${name}.`);
    const source = await this.loadSourceFromConfig();
    const sourceDir = await this.resolvePublishSourceDir(type, name, projectDir);
    const existingInstallInfo = await this.tryResolveInstalledResource(
      projectDir,
      type,
      name,
    );
    const existingGlobalInstallInfo = await this.tryResolveGlobalResourceTarget(
      projectDir,
      type,
      name,
    );

    const history = await source.history(type, name);
    const latest = history[0]?.version ?? "0.0.0";
    const nextVersion = this.versions.nextVersion(latest, releaseType);
    this.reportPublishProgress(
      options,
      "resolve-version",
      `Resolved ${releaseType} version ${nextVersion}.`,
    );
    this.reportPublishProgress(
      options,
      "publish-source",
      `Publishing ${type}/${name}@${nextVersion} to the Git source.`,
    );
    const result = await source.publish(type, name, nextVersion, sourceDir, {
      releaseType,
    });

    const storePath = this.getStorePath(type, name, nextVersion);
    this.reportPublishProgress(
      options,
      "sync-store",
      `Syncing ${type}/${name}@${nextVersion} into the local store.`,
    );
    if (!(await this.exists(storePath))) {
      await source.pull(type, name, nextVersion, storePath);
    }
    const locked = await this.getLockedResource(projectDir, type, name);
    const resourceMeta = await this.readResourceMetaFromDir(storePath, type);
    const configuredAgents = await this.getConfiguredAgents(projectDir);
    const installMode: InstallMode = "copy";
    const nextAgents =
      installScope === "global"
        ? existingGlobalInstallInfo?.agents.length
          ? normalizeAgents(existingGlobalInstallInfo.agents)
          : existingInstallInfo?.agents.length
            ? normalizeAgents(existingInstallInfo.agents)
            : locked?.agents?.length
              ? normalizeAgents(locked.agents)
              : configuredAgents ?? normalizeAgents(resourceMeta?.agents)
        : locked?.agents?.length
          ? normalizeAgents(locked.agents)
          : existingInstallInfo?.agents.length
            ? normalizeAgents(existingInstallInfo.agents)
            : configuredAgents ?? normalizeAgents(resourceMeta?.agents);
    const linkPaths =
      installScope === "global"
        ? getGlobalResourcePaths(this.paths.getHomeDir(), type, name, nextAgents)
        : getProjectResourcePaths(projectDir, type, name, nextAgents);
    this.reportPublishProgress(
      options,
      "install",
      installScope === "global"
        ? `Installing published version globally for ${nextAgents.join(", ")}.`
        : `Installing published version into the current project for ${nextAgents.join(", ")}.`,
    );
    for (const linkPath of linkPaths) {
      await this.materializeResource(storePath, linkPath, installMode);
    }

    if (installScope === "project") {
      const sourceInfo = await this.getLockSourceInfo();
      await this.lockStore.upsertResource(projectDir, sourceInfo, {
        type,
        name,
        version: nextVersion,
        agents: nextAgents,
        mode: installMode,
      });
    }
    this.reportPublishProgress(options, "cleanup", `Cleaning up legacy dev copy if present.`);
    await fs.rm(this.getProjectDevPath(projectDir, type, name), {
      recursive: true,
      force: true,
    });

    this.reportPublishProgress(
      options,
      "done",
      `Published ${type}/${name}@${result.version}.`,
    );
    return {
      type,
      name,
      version: result.version,
      tag: result.tag,
      installScope,
      linkPath: linkPaths[0],
    };
  }

  async create(
    type: ResourceType,
    name: string,
    options: CreateOptions,
    projectDir: string,
  ): Promise<CreateResult> {
    this.validateCreateInput(type, name, options);
    await this.loadSourceFromConfig();

    const agents = await this.resolveEffectiveAgents(projectDir, options.agents);
    const resourcePaths = getProjectResourcePaths(projectDir, type, name, agents);
    const entry = options.entry ?? this.getDefaultEntry(type);
    const files = resourcePaths.flatMap((resourcePath) => [
      path.join(resourcePath, "himan.yaml"),
      path.join(resourcePath, entry),
    ]);
    const existingPaths: string[] = [];
    for (const resourcePath of resourcePaths) {
      if (await this.exists(resourcePath)) existingPaths.push(resourcePath);
    }

    if (existingPaths.length > 0 && !options.force) {
      throw new HimanError(
        errorCodes.RESOURCE_EXISTS,
        `Resource already exists: ${type}/${name}`,
        { paths: existingPaths },
      );
    }

    if (!options.dryRun) {
      for (const resourcePath of resourcePaths) {
        await fs.rm(resourcePath, { recursive: true, force: true });
        await fs.mkdir(resourcePath, { recursive: true });
        await fs.writeFile(
          path.join(resourcePath, "himan.yaml"),
          YAML.stringify({
            name,
            type,
            version: "0.1.0",
            entry,
            description: options.description ?? `${type} resource ${name}`,
            agents,
          }),
          "utf8",
        );
        await fs.writeFile(
          path.join(resourcePath, entry),
          this.getDefaultContent(type, name),
          "utf8",
        );
      }
    }

    return {
      type,
      name,
      resourceDir: resourcePaths[0],
      files,
      dryRun: Boolean(options.dryRun),
    };
  }

  async rename(
    type: ResourceType,
    oldName: string,
    newName: string,
    projectDir: string,
    options: { dryRun?: boolean; migrateProject?: boolean } = {},
  ): Promise<RenameResult & { projectMigrated: boolean }> {
    this.validateRenameInput(type, oldName, newName);
    const source = await this.loadSourceFromConfig();
    const shouldMigrateProject = options.migrateProject !== false && !options.dryRun;

    const locked = shouldMigrateProject
      ? await this.getLockedResource(projectDir, type, oldName)
      : undefined;
    const installInfo = shouldMigrateProject
      ? await this.tryResolveInstalledResource(projectDir, type, oldName)
      : undefined;
    const hasDevPath =
      shouldMigrateProject &&
      (await this.exists(this.getProjectDevPath(projectDir, type, oldName)));

    if (shouldMigrateProject && (locked || installInfo || hasDevPath)) {
      await this.ensureRenamedProjectResourceAvailable(
        projectDir,
        type,
        oldName,
        newName,
        locked,
        installInfo,
      );
    }

    const result = await source.rename(type, oldName, newName, {
      dryRun: options.dryRun,
    });
    const projectMigrated =
      shouldMigrateProject &&
      (await this.migrateRenamedProjectResource(
        source,
        type,
        oldName,
        newName,
        projectDir,
        result,
        locked,
        installInfo,
      ));

    return {
      ...result,
      projectMigrated,
    };
  }

  async installFromLock(
    projectDir: string,
    agents?: string[],
    mode?: InstallMode,
  ): Promise<
    Array<{
      type: ResourceType;
      name: string;
      version: string;
      linkPath: string;
      mode: InstallMode;
    }>
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
      mode: InstallMode;
    }> = [];
    const lockSourceInfo = this.normalizeLockSourceInfo(lock.source);
    const lockedSource = await this.loadSourceFromLock(lockSourceInfo);
    for (const item of lock.resources) {
      const result = await this.installWithSource(
        lockedSource,
        lockSourceInfo,
        item.type,
        item.name,
        item.version,
        projectDir,
        agents ?? item.agents,
        mode ?? this.resolveInstallMode(item.mode),
        "project",
      );
      results.push(result);
    }
    return results;
  }

  private async installWithSource(
    source: ResourceSourceAdapter,
    sourceInfo: LockSourceInfo | undefined,
    type: ResourceType,
    name: string,
    version: string | undefined,
    projectDir: string,
    agents: string[] | undefined,
    mode: InstallMode,
    scope: "project" | "global" = "project",
  ): Promise<{
    type: ResourceType;
    name: string;
    version: string;
    linkPath: string;
    mode: InstallMode;
  }> {
    const history = await source.history(type, name);
    if (history.length === 0) {
      throw new HimanError(
        errorCodes.RESOURCE_NOT_FOUND,
        `Resource not found: ${type}/${name}`,
      );
    }

    const resolvedVersion = this.resolveVersion(history, version);
    const storePath = this.getStorePath(type, name, resolvedVersion);
    if (!(await this.exists(storePath))) {
      await source.pull(type, name, resolvedVersion, storePath);
    }
    const resourceMeta = await this.readResourceMetaFromDir(storePath, type);
    const effectiveTargets =
      scope === "global"
        ? await this.resolveGlobalInstallAgents(
            projectDir,
            type,
            name,
            agents,
            resourceMeta?.agents,
          )
        : await this.resolveEffectiveAgents(
            projectDir,
            agents,
            resourceMeta?.agents,
          );
    const linkPaths =
      scope === "global"
        ? getGlobalResourcePaths(this.paths.getHomeDir(), type, name, effectiveTargets)
        : getProjectResourcePaths(projectDir, type, name, effectiveTargets);
    for (const linkPath of linkPaths) {
      await this.materializeResource(storePath, linkPath, mode);
    }
    if (scope === "project") {
      if (!sourceInfo) {
        throw new Error("Project install requires source lock information.");
      }
      await this.lockStore.upsertResource(projectDir, sourceInfo, {
        type,
        name,
        version: resolvedVersion,
        agents: effectiveTargets,
        mode,
      });
    }

    return { type, name, version: resolvedVersion, linkPath: linkPaths[0], mode };
  }

  private async loadSourceFromConfig(): Promise<ResourceSourceAdapter> {
    return (await this.loadSourceWithInfoFromConfig()).source;
  }

  private async resolveGitSourceEndpoint(ref: string): Promise<GitSourceEndpoint> {
    const config = await this.stateStore.loadConfig();
    const configured = config?.sources?.items[ref];

    if (configured) {
      if (configured.type !== "git" || !configured.repo) {
        throw new HimanError(
          errorCodes.INVALID_INPUT,
          `Source is not a git source: ${ref}`,
        );
      }
      return {
        name: ref,
        repo: configured.repo,
        repoId: configured.repoId ?? toRepoId(configured.repo),
      };
    }

    if (!ref.trim()) {
      throw new HimanError(errorCodes.INVALID_INPUT, "Git repo is required.");
    }

    return {
      repo: ref,
      repoId: toRepoId(ref),
    };
  }

  private async loadGitSourceFromEndpoint(
    endpoint: GitSourceEndpoint,
  ): Promise<GitSourceAdapter> {
    const sourceConfig = this.buildSourceConfig(
      "git",
      endpoint.repo,
      endpoint.repoId,
    );
    const source = new GitSourceAdapter();
    await source.init(sourceConfig);
    return source;
  }

  private validateSourceTransferOptions(
    targetRef: string,
    options: SourceTransferOptions,
  ): void {
    if (options.addSource) {
      this.validateSourceName(options.addSource);
    }

    if (!options.use || options.addSource) {
      return;
    }

    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(targetRef)) {
      throw new HimanError(
        errorCodes.INVALID_INPUT,
        "`--use` requires the target to be a configured source name or `--add-source <name>`.",
      );
    }
  }

  private validateSourceTransferUseTarget(
    target: GitSourceEndpoint,
    options: SourceTransferOptions,
  ): void {
    if (options.use && !options.addSource && !target.name) {
      throw new HimanError(
        errorCodes.INVALID_INPUT,
        "`--use` requires the target to be a configured source name or `--add-source <name>`.",
      );
    }
  }

  private ensureDifferentGitSources(
    source: GitSourceEndpoint,
    target: GitSourceEndpoint,
  ): void {
    if (source.repo === target.repo) {
      throw new HimanError(
        errorCodes.INVALID_INPUT,
        "Source and target repositories must be different.",
      );
    }
  }

  private async applySourceTransferConfigUpdates(
    target: GitSourceEndpoint,
    options: SourceTransferOptions,
  ): Promise<{ addedSource?: string; usedSource?: string }> {
    if (options.dryRun) return {};

    let addedSource: string | undefined;
    if (options.addSource) {
      await this.addSource(options.addSource, "git", target.repo);
      addedSource = options.addSource;
    }

    const sourceToUse = options.use ? options.addSource ?? target.name : undefined;
    if (sourceToUse) {
      await this.useSource(sourceToUse);
    }

    return {
      addedSource,
      usedSource: sourceToUse,
    };
  }

  private validateSourceName(name: string): void {
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name)) {
      throw new HimanError(errorCodes.INVALID_INPUT, `Invalid source name: ${name}`);
    }
  }

  private async loadSourceWithInfoFromConfig(): Promise<{
    source: ResourceSourceAdapter;
    sourceInfo: LockSourceInfo;
  }> {
    const { name, source: stateSource } = await this.getCurrentSourceState();
    const sourceInfo = this.toLockSourceInfo(stateSource, name);
    const source = await this.loadSourceFromInfo(sourceInfo);
    return {
      source,
      sourceInfo,
    };
  }

  private async loadSourceFromLock(sourceInfo: LockSourceInfo): Promise<ResourceSourceAdapter> {
    return this.loadSourceFromInfo(sourceInfo);
  }

  private async loadSourceFromInfo(sourceInfo: LockSourceInfo): Promise<ResourceSourceAdapter> {
    const normalizedSourceInfo = this.normalizeLockSourceInfo(sourceInfo);
    const sourceConfig = this.buildSourceConfig(
      normalizedSourceInfo.type,
      normalizedSourceInfo.repo,
      normalizedSourceInfo.repoId,
    );
    const source = this.createSource(normalizedSourceInfo.type);
    await source.init(sourceConfig);
    return source;
  }

  private async getCurrentSourceState(): Promise<{
    name?: string;
    source: SourceState;
  }> {
    const config = await this.stateStore.loadConfig();
    if (!config?.source) {
      throw new HimanError(
        errorCodes.CONFIG_NOT_FOUND,
        "Source config not found. Please run `himan init <git_repo>` first.",
      );
    }

    const currentName = config.sources?.default ?? "default";
    const currentSource = config.sources?.items[currentName] ?? config.source;
    return { name: currentName, source: currentSource };
  }

  private createSource(type: "git" | "registry"): ResourceSourceAdapter {
    return type === "registry"
      ? new RegistrySourceAdapter()
      : new GitSourceAdapter();
  }

  private async getLockSourceInfo(): Promise<{
    name?: string;
    type: "git" | "registry";
    repo?: string;
    repoId?: string;
  }> {
    const { name, source } = await this.getCurrentSourceState();
    return this.toLockSourceInfo(source, name);
  }

  private toLockSourceInfo(source: SourceState, name?: string): LockSourceInfo {
    return this.normalizeLockSourceInfo({
      name,
      type: source.type,
      repo: source.repo,
      repoId: source.repoId,
    });
  }

  private normalizeLockSourceInfo(sourceInfo: LockSourceInfo): LockSourceInfo {
    if (sourceInfo.type !== "git" || !sourceInfo.repo) {
      return sourceInfo;
    }

    return {
      ...sourceInfo,
      repoId: sourceInfo.repoId ?? toRepoId(sourceInfo.repo),
    };
  }

  private async getLockedResource(projectDir: string, type: ResourceType, name: string) {
    const lock = await this.lockStore.load(projectDir);
    if (!lock) return undefined;
    return lock.resources.find((item) => item.type === type && item.name === name);
  }

  private async ensureRenamedProjectResourceAvailable(
    projectDir: string,
    type: ResourceType,
    oldName: string,
    newName: string,
    locked: Awaited<ReturnType<ServiceFactory["getLockedResource"]>>,
    installInfo:
      | {
          installedPath: string;
          linkPaths: string[];
          agents: string[];
          mode: InstallMode;
        }
      | undefined,
  ): Promise<void> {
    const lockedNewName = await this.getLockedResource(projectDir, type, newName);
    if (lockedNewName) {
      throw new HimanError(
        errorCodes.RESOURCE_EXISTS,
        `Installed resource already exists: ${type}/${newName}`,
      );
    }

    const newDevPath = this.getProjectDevPath(projectDir, type, newName);
    if (await this.exists(newDevPath)) {
      throw new HimanError(
        errorCodes.RESOURCE_EXISTS,
        `Development resource already exists: ${type}/${newName}`,
      );
    }

    const agents = locked?.agents?.length
      ? normalizeAgents(locked.agents)
      : installInfo?.agents;
    if (!agents?.length) return;

    for (const linkPath of getProjectResourcePaths(projectDir, type, newName, agents)) {
      if (await this.exists(linkPath)) {
        throw new HimanError(
          errorCodes.RESOURCE_EXISTS,
          `Installed resource already exists: ${type}/${newName}`,
        );
      }
    }
  }

  private async migrateRenamedProjectResource(
    source: ResourceSourceAdapter,
    type: ResourceType,
    oldName: string,
    newName: string,
    projectDir: string,
    result: RenameResult,
    locked: Awaited<ReturnType<ServiceFactory["getLockedResource"]>>,
    installInfo:
      | {
          installedPath: string;
          linkPaths: string[];
          agents: string[];
          mode: InstallMode;
        }
      | undefined,
  ): Promise<boolean> {
    const oldDevPath = this.getProjectDevPath(projectDir, type, oldName);
    const newDevPath = this.getProjectDevPath(projectDir, type, newName);
    const hasDevPath = await this.exists(oldDevPath);

    if (!locked && !installInfo && !hasDevPath) {
      return false;
    }

    let sourcePath: string | undefined;
    if (hasDevPath) {
      await fs.mkdir(path.dirname(newDevPath), { recursive: true });
      await fs.rename(oldDevPath, newDevPath);
      await this.updateRenamedResourceMetadata(newDevPath, type, oldName, newName);
      sourcePath = newDevPath;
    } else if (result.latestVersion) {
      const storePath = this.getStorePath(type, newName, result.latestVersion);
      if (!(await this.exists(storePath))) {
        await source.pull(type, newName, result.latestVersion, storePath);
      }
      sourcePath = storePath;
    } else if (installInfo) {
      sourcePath = installInfo.installedPath;
    } else {
      sourcePath = result.resourceDir;
    }

    const agents = locked?.agents?.length
      ? normalizeAgents(locked.agents)
      : installInfo?.agents ?? normalizeAgents();
    const mode = installInfo?.mode ?? this.resolveInstallMode(locked?.mode);
    const oldLinkPaths =
      installInfo?.linkPaths ?? getProjectResourcePaths(projectDir, type, oldName, agents);
    const newLinkPaths = getProjectResourcePaths(projectDir, type, newName, agents);

    for (const linkPath of newLinkPaths) {
      await this.materializeResource(sourcePath, linkPath, mode);
    }
    for (const linkPath of oldLinkPaths) {
      await fs.rm(linkPath, { recursive: true, force: true });
    }
    if (locked) {
      await this.lockStore.renameResource(projectDir, {
        type,
        oldName,
        newName,
        version: result.latestVersion ?? locked.version,
      });
    }

    return true;
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

  private getProjectDevPath(projectDir: string, type: ResourceType, name: string): string {
    return path.join(projectDir, ".himan", "dev", type, name);
  }

  private async materializeResource(
    sourcePath: string,
    targetPath: string,
    mode: InstallMode,
  ): Promise<void> {
    await fs.mkdir(path.dirname(targetPath), { recursive: true });
    await fs.rm(targetPath, { recursive: true, force: true });
    if (mode === "copy") {
      await fs.cp(sourcePath, targetPath, { recursive: true });
      return;
    }
    await fs.symlink(sourcePath, targetPath, "dir");
  }

  private resolveInstallMode(mode?: string): InstallMode {
    return mode === "link" ? "link" : "copy";
  }

  private reportPublishProgress(
    options: PublishOptions,
    stage: PublishProgress["stage"],
    message: string,
  ): void {
    options.onProgress?.({ stage, message });
  }

  private async tryResolveProjectResourceTarget(
    projectDir: string,
    type: ResourceType,
    name: string,
  ): Promise<ExistingResourceTarget | undefined> {
    const locked = await this.getLockedResource(projectDir, type, name);
    const configuredAgents = await this.getConfiguredAgents(projectDir);

    if (locked?.agents?.length || configuredAgents?.length) {
      const agents = locked?.agents?.length
        ? normalizeAgents(locked.agents)
        : (configuredAgents ?? normalizeAgents());
      const linkPaths = getProjectResourcePaths(projectDir, type, name, agents);
      const existingLinkPath = await this.findFirstExistingPath(linkPaths);
      if (existingLinkPath) {
        return {
          resourcePath: existingLinkPath,
          linkPaths,
          agents,
          mode: this.resolveInstallMode(locked?.mode ?? (await this.readPathMode(existingLinkPath))),
        };
      }
    }

    const existingCandidates = await this.findExistingAgentPaths(
      projectDir,
      type,
      name,
      "project",
    );
    if (existingCandidates.length === 0) {
      return undefined;
    }

    const existingAgents = normalizeAgents(
      existingCandidates.map((candidate) => candidate.agent),
    );
    const linkPaths = getProjectResourcePaths(projectDir, type, name, existingAgents);
    return {
      resourcePath: existingCandidates[0].path,
      linkPaths,
      agents: existingAgents,
      mode: await this.readPathMode(existingCandidates[0].path),
    };
  }

  private async tryResolveGlobalResourceTarget(
    projectDir: string,
    type: ResourceType,
    name: string,
  ): Promise<ExistingResourceTarget | undefined> {
    const existingCandidates = await this.findExistingAgentPaths(
      projectDir,
      type,
      name,
      "global",
    );
    if (existingCandidates.length === 0) {
      return undefined;
    }

    const agents = normalizeAgents(existingCandidates.map((candidate) => candidate.agent));
    const linkPaths = getGlobalResourcePaths(this.paths.getHomeDir(), type, name, agents);
    return {
      resourcePath: existingCandidates[0].path,
      linkPaths,
      agents,
      mode: await this.readPathMode(existingCandidates[0].path),
    };
  }

  private async findExistingAgentPaths(
    projectDir: string,
    type: ResourceType,
    name: string,
    scope: "project" | "global",
  ): Promise<Array<{ agent: string; path: string }>> {
    const rootDir = scope === "global" ? this.paths.getHomeDir() : projectDir;
    const candidates = getSupportedAgentNames().map((agent) => ({
      agent,
      path:
        scope === "global"
          ? getGlobalResourcePaths(rootDir, type, name, [agent])[0]
          : getProjectResourcePaths(rootDir, type, name, [agent])[0],
    }));
    const existingCandidates: Array<{ agent: string; path: string }> = [];
    for (const candidate of candidates) {
      if (await this.exists(candidate.path)) existingCandidates.push(candidate);
    }
    return existingCandidates;
  }

  private async findFirstExistingPath(paths: string[]): Promise<string | undefined> {
    for (const targetPath of paths) {
      if (await this.exists(targetPath)) return targetPath;
    }
    return undefined;
  }

  private async readPathMode(targetPath: string): Promise<InstallMode> {
    const stat = await fs.lstat(targetPath);
    return stat.isSymbolicLink() ? "link" : "copy";
  }

  private async resolveInstalledResource(
    projectDir: string,
    type: ResourceType,
    name: string,
  ): Promise<{
    installedPath: string;
    linkPaths: string[];
    agents: string[];
    mode: InstallMode;
  }> {
    const locked = await this.getLockedResource(projectDir, type, name);
    const configuredAgents = await this.getConfiguredAgents(projectDir);
    const lockedTargets = locked?.agents?.length
      ? normalizeAgents(locked.agents)
      : configuredAgents ?? normalizeAgents();
    const expectedFromLock = getProjectResourcePaths(projectDir, type, name, lockedTargets);
    const existingFromLock: string[] = [];
    for (const candidate of expectedFromLock) {
      if (await this.exists(candidate)) existingFromLock.push(candidate);
    }
    if (existingFromLock.length > 0) {
      const installedPath = await fs.realpath(existingFromLock[0]);
      return {
        installedPath,
        agents: lockedTargets,
        linkPaths: getProjectResourcePaths(projectDir, type, name, lockedTargets),
        mode: this.resolveInstallMode(locked?.mode),
      };
    }

    const allCandidates = getSupportedAgentNames().map((agent) => ({
      agent,
      path: getProjectResourcePaths(projectDir, type, name, [agent])[0],
    }));
    const existingCandidates: Array<{ agent: string; path: string }> = [];
    for (const candidate of allCandidates) {
      if (await this.exists(candidate.path)) existingCandidates.push(candidate);
    }
    if (existingCandidates.length === 0) {
      throw new HimanError(
        errorCodes.INSTALL_NOT_FOUND,
        `Installed resource link not found for ${type}/${name}. Run install first.`,
      );
    }

    const installedPath = await fs.realpath(existingCandidates[0].path);
    const resourceMeta = await this.readResourceMetaFromDir(installedPath, type);
    const agentsFromMeta = resourceMeta?.agents?.length
      ? normalizeAgents(resourceMeta.agents)
      : undefined;
    const existingAgents = normalizeAgents(existingCandidates.map((candidate) => candidate.agent));
    const effectiveAgents = configuredAgents ?? agentsFromMeta ?? existingAgents;
    return {
      installedPath,
      agents: effectiveAgents,
      linkPaths: getProjectResourcePaths(projectDir, type, name, effectiveAgents),
      mode: "link",
    };
  }

  private async tryResolveInstalledResource(
    projectDir: string,
    type: ResourceType,
    name: string,
  ): Promise<
    | {
        installedPath: string;
        linkPaths: string[];
        agents: string[];
        mode: InstallMode;
      }
    | undefined
  > {
    try {
      return await this.resolveInstalledResource(projectDir, type, name);
    } catch (error) {
      if (
        error instanceof HimanError &&
        error.code === errorCodes.INSTALL_NOT_FOUND
      ) {
        return undefined;
      }
      throw error;
    }
  }

  private async resolveEffectiveAgents(
    projectDir: string,
    explicitAgents?: string[],
    fallbackAgents?: string[],
  ): Promise<string[]> {
    if (explicitAgents?.length) {
      return normalizeAgents(explicitAgents);
    }
    const configuredAgents = await this.getConfiguredAgents(projectDir);
    if (configuredAgents?.length) {
      return configuredAgents;
    }
    return normalizeAgents(fallbackAgents);
  }

  private async resolveGlobalInstallAgents(
    projectDir: string,
    type: ResourceType,
    name: string,
    explicitAgents?: string[],
    fallbackAgents?: string[],
  ): Promise<string[]> {
    if (explicitAgents?.length) {
      return normalizeAgents(explicitAgents);
    }
    const locked = await this.getLockedResource(projectDir, type, name);
    if (locked?.agents?.length) {
      return normalizeAgents(locked.agents);
    }
    return this.resolveEffectiveAgents(projectDir, undefined, fallbackAgents);
  }

  private async getConfiguredAgents(projectDir: string): Promise<string[] | undefined> {
    const [globalConfig, projectConfig] = await Promise.all([
      this.stateStore.loadConfig(),
      this.projectConfigStore.load(projectDir),
    ]);
    if (projectConfig?.agents?.length) {
      return normalizeAgents(projectConfig.agents);
    }
    if (globalConfig?.agents?.length) {
      return normalizeAgents(globalConfig.agents);
    }
    return undefined;
  }

  private async readResourceMetaFromDir(
    resourceDir: string,
    type: ResourceType,
  ): Promise<{ agents?: string[] } | null> {
    const yamlPath = path.join(resourceDir, "himan.yaml");
    if (await this.exists(yamlPath)) {
      const raw = await fs.readFile(yamlPath, "utf8");
      const parsed =
        (YAML.parse(raw) as { agents?: string[]; targets?: string[] } | null) ??
        null;
      if (!parsed) return null;
      return { agents: parsed.agents ?? parsed.targets };
    }

    if (type !== "skill") return null;
    const entryPath = path.join(resourceDir, this.getDefaultEntry(type));
    if (!(await this.exists(entryPath))) return null;
    const metadata = await this.readFrontMatter(entryPath);
    return {
      agents:
        this.readStringArrayMetadata(metadata, "agents") ??
        this.readStringArrayMetadata(metadata, "targets"),
    };
  }

  private async updateRenamedResourceMetadata(
    resourceDir: string,
    type: ResourceType,
    oldName: string,
    newName: string,
  ): Promise<void> {
    const yamlPath = path.join(resourceDir, "himan.yaml");
    if (await this.exists(yamlPath)) {
      const raw = await fs.readFile(yamlPath, "utf8");
      const parsed = YAML.parse(raw) as unknown;
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        return;
      }
      await fs.writeFile(
        yamlPath,
        YAML.stringify({
          ...(parsed as Record<string, unknown>),
          name: newName,
        }),
        "utf8",
      );
      return;
    }

    if (type !== "skill") return;
    const entryPath = path.join(resourceDir, this.getDefaultEntry(type));
    if (!(await this.exists(entryPath))) return;

    const raw = await fs.readFile(entryPath, "utf8");
    const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(raw);
    if (!match) return;

    let parsed: unknown;
    try {
      parsed = YAML.parse(match[1]);
    } catch {
      return;
    }
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      Array.isArray(parsed) ||
      (parsed as Record<string, unknown>).name !== oldName
    ) {
      return;
    }

    const frontMatter = YAML.stringify({
      ...(parsed as Record<string, unknown>),
      name: newName,
    }).trimEnd();
    await fs.writeFile(
      entryPath,
      `---\n${frontMatter}\n---\n${raw.slice(match[0].length)}`,
      "utf8",
    );
  }

  private async readFrontMatter(
    filePath: string,
  ): Promise<Record<string, unknown> | null> {
    const raw = await fs.readFile(filePath, "utf8");
    const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(raw.trimStart());
    if (!match) return null;
    try {
      const parsed = YAML.parse(match[1]) as unknown;
      return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : null;
    } catch {
      return null;
    }
  }

  private readStringArrayMetadata(
    metadata: Record<string, unknown> | null,
    key: string,
  ): string[] | undefined {
    const value = metadata?.[key];
    if (!Array.isArray(value)) return undefined;
    const items = value
      .filter((item): item is string => typeof item === "string")
      .map((item) => item.trim())
      .filter(Boolean);
    return items.length > 0 ? items : undefined;
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

    const projectTarget = await this.tryResolveProjectResourceTarget(
      projectDir,
      type,
      name,
    );
    if (projectTarget) {
      return projectTarget.resourcePath;
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
    if (!config?.source) {
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

  private getDefaultEntry(type: ResourceType): string {
    return type === "skill" ? "SKILL.md" : "content.md";
  }

  private getDefaultContent(type: ResourceType, name: string): string {
    if (type === "rule") {
      return `# ${name}\n\nDescribe rule instructions here.\n`;
    }
    if (type === "command") {
      return `# ${name}\n\nDescribe command behavior here.\n`;
    }
    return `# ${name}\n\nDescribe skill workflow here.\n`;
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

  private validateRenameInput(
    type: ResourceType,
    oldName: string,
    newName: string,
  ): void {
    if (!["rule", "command", "skill"].includes(type)) {
      throw new HimanError(
        errorCodes.UNSUPPORTED_RESOURCE_TYPE,
        `Unsupported resource type for rename: ${type}`,
      );
    }

    if (oldName === newName) {
      throw new HimanError(
        errorCodes.INVALID_INPUT,
        "Old and new resource names must be different.",
      );
    }

    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(newName)) {
      throw new HimanError(
        errorCodes.INVALID_RESOURCE_NAME,
        `Invalid resource name: ${newName}. Use kebab-case only.`,
      );
    }
  }
}
