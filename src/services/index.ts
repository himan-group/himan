import { GitSourceAdapter } from "../adapters/source/git-source-adapter.js";
import { RegistrySourceAdapter } from "../adapters/source/registry-source-adapter.js";
import type {
  ResourceSourceAdapter,
  SourceConfig,
} from "../adapters/source/resource-source-adapter.js";
import type { DoctorCheck, DoctorResult } from "../domain/doctor.js";
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
  type ProjectLock,
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
import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import { promisify } from "node:util";
import { VersionResolver } from "../adapters/version/version-resolver.js";
import YAML from "yaml";

const execFileAsync = promisify(execFile);
const RESOURCE_TYPES: ResourceType[] = ["rule", "command", "skill"];

export interface InstalledResource {
  type: ResourceType;
  name: string;
  version: string;
  agents: string[];
  mode: InstallMode;
  updatedAt: string;
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

  async doctor(projectDir: string): Promise<DoctorResult> {
    const checks: DoctorCheck[] = [];
    checks.push(this.checkNodeVersion());
    checks.push(await this.checkGit());
    checks.push(await this.checkHomeState());

    const config = await this.stateStore.loadConfig();
    if (!config?.source) {
      checks.push({
        name: "source",
        status: "error",
        message: "No source configured. Run `himan init <git_repo>` first.",
        details: { configPath: this.stateStore.getConfigPath() },
      });
    } else {
      const currentName = config.sources?.default ?? "default";
      const currentSource = config.sources?.items[currentName] ?? config.source;
      checks.push({
        name: "source",
        status: "ok",
        message: `Using ${currentSource.type} source ${currentName}.`,
        details: {
          name: currentName,
          type: currentSource.type,
          repo: currentSource.repo,
          repoId: currentSource.repoId,
        },
      });
      checks.push(await this.checkSourceResources());
    }

    checks.push(await this.checkAgents(projectDir));
    const lockCheck = await this.checkProjectLock(projectDir);
    checks.push(lockCheck.check);
    checks.push(await this.checkProjectTargets(projectDir, lockCheck.lock));

    return {
      ok: !checks.some((check) => check.status === "error"),
      checks,
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

  private checkNodeVersion(): DoctorCheck {
    const version = process.versions.node;
    const major = Number(version.split(".")[0]);
    if (major === 22) {
      return {
        name: "node",
        status: "ok",
        message: `Node.js ${version}.`,
      };
    }

    return {
      name: "node",
      status: "error",
      message: `Node.js ${version} is unsupported. Use Node.js 22.x.`,
    };
  }

  private async checkGit(): Promise<DoctorCheck> {
    try {
      const result = await execFileAsync("git", ["--version"]);
      return {
        name: "git",
        status: "ok",
        message: result.stdout.trim() || "Git is available.",
      };
    } catch (error) {
      return this.errorCheck("git", "Git is not available on PATH.", error);
    }
  }

  private async checkHomeState(): Promise<DoctorCheck> {
    const root = this.paths.getHimanRoot();
    const reposDir = this.paths.getReposDir();
    const storeDir = this.paths.getStoreDir();
    const missing = [];
    if (!(await this.exists(root))) missing.push(root);
    if (!(await this.exists(reposDir))) missing.push(reposDir);
    if (!(await this.exists(storeDir))) missing.push(storeDir);

    if (missing.length > 0) {
      return {
        name: "home",
        status: "warn",
        message: "Himan home directories are not fully initialized yet.",
        details: { root, reposDir, storeDir, missing },
      };
    }

    return {
      name: "home",
      status: "ok",
      message: `Himan home is initialized at ${root}.`,
      details: { root, reposDir, storeDir },
    };
  }

  private async checkSourceResources(): Promise<DoctorCheck> {
    try {
      const source = await this.loadSourceFromConfig();
      const entries = await Promise.all(
        RESOURCE_TYPES.map(async (type) => [type, await source.list(type)] as const),
      );
      const counts = Object.fromEntries(
        entries.map(([type, resources]) => [type, resources.length]),
      ) as Record<ResourceType, number>;
      const total = RESOURCE_TYPES.reduce((sum, type) => sum + counts[type], 0);
      return {
        name: "resources",
        status: "ok",
        message: `Scanned ${total} resources from current source.`,
        details: { counts },
      };
    } catch (error) {
      return this.errorCheck("resources", "Cannot scan current source resources.", error);
    }
  }

  private async checkAgents(projectDir: string): Promise<DoctorCheck> {
    try {
      const settings = await this.getAgentSettings(projectDir);
      const scope = settings.project ? "project" : settings.global ? "global" : "default";
      return {
        name: "agents",
        status: "ok",
        message: `Effective agents: ${settings.effective.join(", ")} (${scope}).`,
        details: settings,
      };
    } catch (error) {
      return this.errorCheck("agents", "Cannot resolve effective agents.", error);
    }
  }

  private async checkProjectLock(projectDir: string): Promise<{
    check: DoctorCheck;
    lock?: ProjectLock;
  }> {
    const lockPath = this.lockStore.getLockPath(projectDir);
    const { lock, state } = await this.lockStore.loadWithState(projectDir);
    if (state === "missing") {
      return {
        check: {
          name: "lock",
          status: "ok",
          message: "No himan.lock found for this project yet.",
          details: { lockPath },
        },
      };
    }
    if (state === "invalid" || !lock) {
      return {
        check: {
          name: "lock",
          status: "error",
          message: `Lock file is invalid: ${lockPath}`,
          details: { lockPath },
        },
      };
    }
    if (lock.resources.length === 0) {
      return {
        check: {
          name: "lock",
          status: "warn",
          message: "himan.lock has no resources.",
          details: { lockPath },
        },
        lock,
      };
    }
    return {
      check: {
        name: "lock",
        status: "ok",
        message: `himan.lock tracks ${lock.resources.length} resources.`,
        details: { lockPath, source: lock.source },
      },
      lock,
    };
  }

  private async checkProjectTargets(
    projectDir: string,
    lock: ProjectLock | undefined,
  ): Promise<DoctorCheck> {
    if (!lock || lock.resources.length === 0) {
      return {
        name: "targets",
        status: "ok",
        message: "No locked project targets to verify.",
      };
    }

    const missing: Array<{ resource: string; path: string }> = [];
    for (const resource of lock.resources) {
      const agents = normalizeAgents(resource.agents);
      const targets = getProjectResourcePaths(
        projectDir,
        resource.type,
        resource.name,
        agents,
      );
      for (const targetPath of targets) {
        if (!(await this.exists(targetPath))) {
          missing.push({
            resource: `${resource.type}/${resource.name}@${resource.version}`,
            path: targetPath,
          });
        }
      }
    }

    if (missing.length > 0) {
      return {
        name: "targets",
        status: "warn",
        message: `Missing ${missing.length} installed targets. Run \`himan install\` to restore them.`,
        details: { missing },
      };
    }

    return {
      name: "targets",
      status: "ok",
      message: "All locked project targets exist.",
    };
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
  }> {
    const installInfo = await this.resolveInstalledResource(projectDir, type, name);
    const installedPath = installInfo.installedPath;
    const devPath = this.getProjectDevPath(projectDir, type, name);
    if (!(await this.exists(devPath))) {
      await fs.mkdir(path.dirname(devPath), { recursive: true });
      await fs.cp(installedPath, devPath, { recursive: true });
    }
    for (const linkPath of installInfo.linkPaths) {
      await this.materializeResource(devPath, linkPath, installInfo.mode);
    }
    return {
      type,
      name,
      devPath,
      linkPath: installInfo.linkPaths[0],
      mode: installInfo.mode,
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
  ): Promise<{ type: ResourceType; name: string; version: string; tag: string }> {
    const source = await this.loadSourceFromConfig();
    const sourceDir = await this.resolvePublishSourceDir(type, name, projectDir);
    const existingInstallInfo = await this.tryResolveInstalledResource(
      projectDir,
      type,
      name,
    );

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
    const locked = await this.getLockedResource(projectDir, type, name);
    const resourceMeta = await this.readResourceMetaFromDir(storePath, type);
    const configuredAgents = await this.getConfiguredAgents(projectDir);
    const nextAgents = locked?.agents?.length
      ? normalizeAgents(locked.agents)
      : existingInstallInfo?.agents.length
        ? normalizeAgents(existingInstallInfo.agents)
        : configuredAgents ?? normalizeAgents(resourceMeta?.agents);
    const installMode: InstallMode = "copy";
    const linkPaths = getProjectResourcePaths(projectDir, type, name, nextAgents);
    for (const linkPath of linkPaths) {
      await this.materializeResource(storePath, linkPath, installMode);
    }

    const sourceInfo = await this.getLockSourceInfo();
    await this.lockStore.upsertResource(projectDir, sourceInfo, {
      type,
      name,
      version: nextVersion,
      agents: nextAgents,
      mode: installMode,
    });
    await fs.rm(this.getProjectDevPath(projectDir, type, name), {
      recursive: true,
      force: true,
    });

    return { type, name, version: result.version, tag: result.tag };
  }

  async create(
    type: ResourceType,
    name: string,
    options: CreateOptions,
    projectDir: string,
  ): Promise<CreateResult> {
    this.validateCreateInput(type, name, options);
    const source = await this.loadSourceFromConfig();
    return source.create(type, name, {
      description: options.description,
      agents: await this.resolveEffectiveAgents(projectDir, options.agents),
      entry: options.entry,
      template: options.template ?? "basic",
      force: options.force,
      dryRun: options.dryRun,
    });
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

  private errorCheck(name: string, message: string, error: unknown): DoctorCheck {
    return {
      name,
      status: "error",
      message: `${message} ${error instanceof Error ? error.message : String(error)}`,
    };
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
