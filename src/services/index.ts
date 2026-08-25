import { GitSourceAdapter } from "../adapters/source/git-source-adapter.js";
import { LocalSourceAdapter } from "../adapters/source/local-source-adapter.js";
import { RegistrySourceAdapter } from "../adapters/source/registry-source-adapter.js";
import { SystemAuditor } from "../adapters/audit/system-auditor.js";
import type {
  ResourceSourceAdapter,
  SourceConfig,
} from "../adapters/source/resource-source-adapter.js";
import type { AuditResult, CleanupCandidate, CleanupResult } from "../domain/audit.js";
import type { DoctorCheck, DoctorResult } from "../domain/doctor.js";
import type {
  ArchiveOptions,
  ArchiveResult,
  CommentOptions,
  CommentResult,
  CreateOptions,
  CreateResult,
  InstallMode,
  MigrateResult,
  RenameResult,
  ResourceListOptions,
  ResourceMeta,
  ResourceType,
  RestoreOptions,
  RestoreResult,
  VersionInfo,
} from "../domain/resource.js";
import { buildResourceAnalysisMetadata } from "../adapters/resource/resource-analysis.js";
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
import {
  InstalledRegistryStore,
  type InstallScope,
  type InstalledRegistryEntry,
} from "../state/installed-registry-store.js";
import type { SourceState } from "../state/state-store.js";
import { findMissingLockTargets } from "../utils/lock-target-check.js";
import { moveToTrash } from "../utils/trash.js";
import { PathResolver } from "../utils/path-resolver.js";
import { toRepoId } from "../utils/repo-id.js";
import { HimanError, errorCodes } from "../utils/errors.js";
import {
  getGlobalResourcePaths,
  getProjectResourcePaths,
  getResourcePathCandidatesForAgent,
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
const RESOURCE_TYPES: ResourceType[] = ["rule", "command", "skill", "config"];

export interface InstalledResource {
  type: ResourceType;
  name: string;
  version: string;
  source?: string;
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

export interface PublishBatchProgress {
  stage: "start" | "success" | "skip" | "failed";
  current: number;
  total: number;
  item: PublishRequest;
  message: string;
}

export interface PublishOptions {
  installScope?: PublishInstallScope;
  source?: string;
  onProgress?: (progress: PublishProgress) => void;
  onBatchProgress?: (progress: PublishBatchProgress) => void;
}

export interface PublishFollowUp {
  canonicalPath: string;
  legacyPath: string;
  message: string;
}

export interface PublishRequest {
  type: ResourceType;
  name: string;
}

export interface SkillDependencyStatus {
  name: string;
  optional: boolean;
  depth: number;
  installedInProject: boolean;
  installedGlobally: boolean;
  availableAsSystemSkill: boolean;
  projectAgents: string[];
  globalAgents: string[];
  systemAgents: string[];
}

export interface PublishBatchItem {
  type: ResourceType;
  name: string;
  status: "published" | "skipped" | "failed";
  version?: string;
  tag?: string;
  installScope?: PublishInstallScope;
  linkPath?: string;
  followUp?: PublishFollowUp;
  error?: {
    code: string;
    message: string;
  };
}

interface InstallResult {
  type: ResourceType;
  name: string;
  version: string;
  linkPath: string;
  mode: InstallMode;
}

interface InstallOptions {
  includeArchived?: boolean;
  source?: string;
}

interface SkillDependencyRef {
  name: string;
  optional: boolean;
}

interface PreparedInstall {
  type: ResourceType;
  name: string;
  version: string;
  storePath: string;
  effectiveTargets: string[];
  linkPaths: string[];
  mode: InstallMode;
  scope: "project" | "global";
}

interface SourceSelectionOptions {
  source?: string;
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
  private readonly registryStore = new InstalledRegistryStore();
  private readonly paths = new PathResolver();
  private readonly versions = new VersionResolver();

  async initSource(
    type: "git" | "registry" | "local",
    repo?: string,
  ): Promise<{
    sourceType: "git" | "registry" | "local";
    repo?: string;
    repoId?: string;
  }> {
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
    type: "git" | "registry" | "local",
    repo?: string,
    alias: string = name,
  ): Promise<{
    name: string;
    alias: string;
    type: "git" | "registry" | "local";
    repo?: string;
    repoId?: string;
  }> {
    this.validateSourceName(name);
    this.validateSourceAlias(alias);
    await this.stateStore.ensureBaseDirs();
    const sourceConfig = this.buildSourceConfig(type, repo);
    const source = this.createSource(type);
    await source.init(sourceConfig);

    const stateSource: SourceState = {
      type,
      alias,
      repo: sourceConfig.repo,
      repoId: sourceConfig.repoId,
    };

    const current = await this.stateStore.loadConfig();
    const items = { ...(current?.sources?.items ?? {}) };
    this.ensureSourceAliasAvailable(items, alias, name);
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

    return { name, alias, type, repo: sourceConfig.repo, repoId: sourceConfig.repoId };
  }

  async aliasSource(ref: string, alias: string): Promise<{ name: string; alias: string }> {
    this.validateSourceAlias(alias);
    const config = await this.stateStore.loadConfig();
    if (!config?.sources) {
      throw new HimanError(errorCodes.CONFIG_NOT_FOUND, "No source configured.");
    }
    const resolved = this.resolveConfiguredSourceRef(config.sources.items, ref);
    if (!resolved) {
      throw new HimanError(errorCodes.RESOURCE_NOT_FOUND, `Source not found: ${ref}`);
    }
    this.ensureSourceAliasAvailable(config.sources.items, alias, resolved.name);

    const items = {
      ...config.sources.items,
      [resolved.name]: {
        ...resolved.source,
        alias,
      },
    };
    const defaultSource = items[config.sources.default] ?? config.source;
    await this.stateStore.saveConfig({
      source: defaultSource,
      sources: {
        default: config.sources.default,
        items,
      },
      agents: config.agents,
    });
    return { name: resolved.name, alias };
  }

  async renameSource(
    ref: string,
    newName: string,
    options: { alias?: string } = {},
  ): Promise<{ oldName: string; name: string; alias?: string; isDefault: boolean }> {
    this.validateSourceName(newName);
    const nextAlias = options.alias?.trim();
    if (nextAlias) {
      this.validateSourceAlias(nextAlias);
    }

    const config = await this.stateStore.loadConfig();
    if (!config?.sources) {
      throw new HimanError(errorCodes.CONFIG_NOT_FOUND, "No source configured.");
    }
    const resolved = this.resolveConfiguredSourceRef(config.sources.items, ref);
    if (!resolved) {
      throw new HimanError(errorCodes.RESOURCE_NOT_FOUND, `Source not found: ${ref}`);
    }
    if (newName !== resolved.name && config.sources.items[newName]) {
      throw new HimanError(errorCodes.INVALID_INPUT, `Source already exists: ${newName}`);
    }
    if (nextAlias) {
      this.ensureSourceAliasAvailable(config.sources.items, nextAlias, resolved.name);
    }

    const renamedSource = nextAlias
      ? {
        ...resolved.source,
        alias: nextAlias,
      }
      : resolved.source;
    const items = { ...config.sources.items };
    delete items[resolved.name];
    items[newName] = renamedSource;
    const defaultName =
      config.sources.default === resolved.name ? newName : config.sources.default;
    const defaultSource = items[defaultName] ?? config.source;

    await this.stateStore.saveConfig({
      source: defaultSource,
      sources: {
        default: defaultName,
        items,
      },
      agents: config.agents,
    });

    return {
      oldName: resolved.name,
      name: newName,
      alias: renamedSource.alias,
      isDefault: defaultName === newName,
    };
  }

  async useSource(
    ref: string,
    options: { alias?: string } = {},
  ): Promise<{ name: string; alias: string }> {
    const nextAlias = options.alias?.trim();
    if (nextAlias) {
      this.validateSourceAlias(nextAlias);
    }
    const config = await this.stateStore.loadConfig();
    if (!config?.sources) {
      throw new HimanError(errorCodes.CONFIG_NOT_FOUND, "No source configured.");
    }
    const currentName = config.sources.default;
    const current = config.sources.items[currentName] ?? config.source;
    if (!current?.alias) {
      throw new HimanError(
        errorCodes.INVALID_INPUT,
        `Current default source "${currentName}" has no alias. Run \`himan source alias ${currentName} <alias>\` before switching sources.`,
      );
    }
    const resolved = this.resolveConfiguredSourceRef(config.sources.items, ref);
    if (!resolved) {
      throw new HimanError(errorCodes.RESOURCE_NOT_FOUND, `Source not found: ${ref}`);
    }
    if (!resolved.source.alias && !nextAlias) {
      throw new HimanError(
        errorCodes.INVALID_INPUT,
        `Target source "${resolved.name}" has no alias. Run \`himan source alias ${resolved.name} <alias>\`, or \`himan source use ${resolved.name} --alias <alias>\`, before switching to it.`,
      );
    }
    if (nextAlias) {
      this.ensureSourceAliasAvailable(config.sources.items, nextAlias, resolved.name);
    }
    const alias = nextAlias ?? resolved.source.alias;
    if (!alias) {
      throw new Error("Source alias was expected after validation.");
    }
    const nextSource = nextAlias
      ? {
        ...resolved.source,
        alias,
      }
      : resolved.source;
    const items = {
      ...config.sources.items,
      [resolved.name]: nextSource,
    };
    await this.stateStore.saveConfig({
      source: nextSource,
      sources: {
        default: resolved.name,
        items,
      },
      agents: config.agents,
    });
    return { name: resolved.name, alias };
  }

  async listSources(): Promise<
    Array<{
      name: string;
      alias?: string;
      type: "git" | "registry" | "local";
      repo?: string;
      repoId?: string;
      isDefault: boolean;
    }>
  > {
    const config = await this.stateStore.loadConfig();
    if (!config?.sources) return [];
    return Object.entries(config.sources.items).map(([name, source]) => ({
      name,
      alias: source.alias,
      type: source.type,
      repo: source.repo,
      repoId: source.repoId,
      isDefault: name === config.sources?.default,
    }));
  }

  async initSourceDocs(
    options: SourceDocsOptions & SourceSelectionOptions,
  ): Promise<SourceDocsResult> {
    const source = await this.loadSourceFromConfig(options.source);
    return source.initDocs({
      force: options.force,
      repairHistory: options.repairHistory,
      dryRun: options.dryRun,
    });
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
    checks.push(await this.checkProjectArchiveStatus(lockCheck.lock));
    checks.push(await this.checkProjectTargets(projectDir, lockCheck.lock));

    return {
      ok: !checks.some((check) => check.status === "error"),
      checks,
    };
  }

  async systemAudit(
    options: { scope?: "global" | "project" | "all"; agent?: string } = {},
  ): Promise<AuditResult> {
    const auditor = new SystemAuditor({
      registryStore: this.registryStore,
      lockStore: this.lockStore,
    });
    return auditor.run({
      projectDir: process.cwd(),
      homeDir: this.paths.getHomeDir(),
      scope: options.scope ?? "all",
      agent: options.agent,
    });
  }

  async systemCleanup(
    options: {
      scope?: "global" | "project" | "all";
      agent?: string;
      dryRun?: boolean;
    } = {},
  ): Promise<CleanupResult> {
    const scope = options.scope ?? "all";
    const audit = await this.systemAudit({ scope, agent: options.agent });
    const candidates: CleanupCandidate[] = [];

    for (const issue of audit.issues) {
      if (!issue.path) continue;
      if (issue.category === "unmanaged") {
        candidates.push({
          category: "unmanaged",
          path: issue.path,
          reason: issue.message,
        });
        continue;
      }
      if (issue.category !== "orphan-store-cache") continue;
      if (scope === "project") continue;
      candidates.push({
        category: "orphan-store-cache",
        path: issue.path,
        reason: issue.message,
      });
    }

    const uniqueCandidates = [
      ...new Map(
        candidates.map((candidate) => [candidate.path, candidate]),
      ).values(),
    ];
    if (options.dryRun) {
      return { dryRun: true, candidates: uniqueCandidates };
    }

    const moved: Array<{ path: string; trashPath: string }> = [];
    for (const candidate of uniqueCandidates) {
      if (!(await this.exists(candidate.path))) continue;
      const trashPath = await moveToTrash(
        candidate.path,
        this.paths.getHomeDir(),
      );
      moved.push({ path: candidate.path, trashPath });
    }
    return { dryRun: false, candidates: uniqueCandidates, moved };
  }

  async migrate(
    sourcePath: string,
    options: { type?: string; agents?: string[]; dryRun?: boolean } = {},
  ): Promise<MigrateResult> {
    const resolvedPath = path.resolve(sourcePath);
    let stat;
    try {
      stat = await fs.stat(resolvedPath);
    } catch {
      throw new HimanError(
        errorCodes.RESOURCE_NOT_FOUND,
        `Migrate path not found: ${resolvedPath}`,
      );
    }
    if (!stat.isDirectory()) {
      throw new HimanError(
        errorCodes.INVALID_INPUT,
        "Migrate target must be a directory.",
      );
    }

    const type = options.type
      ? this.ensureMigrateResourceType(options.type)
      : await this.inferMigrateResourceType(resolvedPath);
    const name = path.basename(resolvedPath);
    const localRoot = this.getLocalSourceRoot();
    if (resolvedPath.startsWith(`${localRoot}${path.sep}`)) {
      throw new HimanError(
        errorCodes.INVALID_INPUT,
        "Resource is already inside the local managed source.",
      );
    }
    const targetSourceDir = path.join(localRoot, this.getTypeDir(type), name);
    if (await this.exists(targetSourceDir)) {
      throw new HimanError(
        errorCodes.RESOURCE_EXISTS,
        `Resource already managed in local source: ${type}/${name}`,
      );
    }

    const existingMeta = await this.readMigrateResourceMeta(resolvedPath, type);
    const entry = existingMeta?.entry ?? this.getDefaultEntry(type);
    const entryPath = path.join(resolvedPath, entry);
    if (!(await this.exists(entryPath))) {
      throw new HimanError(
        errorCodes.INVALID_RESOURCE_METADATA,
        `Resource is missing its default entry file: ${entryPath}`,
      );
    }

    const files = await this.readResourceFiles(resolvedPath);
    const packageFiles = files.map((file) => ({
      path: file.path,
      content: file.content,
    }));
    const entryContent =
      files.find((file) => file.path === entry)?.content ?? "";
    const analysis = buildResourceAnalysisMetadata({
      entry,
      entryContent,
      packageFiles,
      measuredBy: "himan-migrate",
      generatedBy: "himan-migrate",
    });
    const version = existingMeta?.version ?? "0.0.1";
    const agents = options.agents?.length
      ? normalizeAgents(options.agents)
      : existingMeta?.agents;
    const plannedFiles = [
      ...files.map((file) => ({ path: file.path, action: "copy" })),
      { path: "himan.yaml", action: "create" },
    ];
    const storePath = this.getStorePath(type, name, version);

    if (options.dryRun) {
      return {
        type,
        name,
        version,
        sourceName: "local",
        sourceDir: targetSourceDir,
        storePath,
        files: plannedFiles,
        dryRun: true,
      };
    }

    await this.ensureLocalSourceConfigured();
    await fs.mkdir(targetSourceDir, { recursive: true });
    await fs.cp(resolvedPath, targetSourceDir, { recursive: true });
    await fs.writeFile(
      path.join(targetSourceDir, "himan.yaml"),
      YAML.stringify(
        buildMigrateYaml(existingMeta, {
          name,
          type,
          entry,
          version,
          agents,
          analysis,
        }),
      ),
      "utf8",
    );
    await fs.rm(storePath, { recursive: true, force: true });
    await fs.cp(targetSourceDir, storePath, { recursive: true });

    return {
      type,
      name,
      version,
      sourceName: "local",
      sourceDir: targetSourceDir,
      storePath,
      files: plannedFiles,
      dryRun: false,
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
    if (major >= 20 && major !== 23) {
      return {
        name: "node",
        status: "ok",
        message: `Node.js ${version}.`,
      };
    }

    return {
      name: "node",
      status: "error",
      message: `Node.js ${version} is unsupported. Use Node.js >=20 <23 or >=24.`,
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
        details: { lockPath, source: lock.source, sources: lock.sources },
      },
      lock,
    };
  }

  private async checkProjectArchiveStatus(
    lock: ProjectLock | undefined,
  ): Promise<DoctorCheck> {
    if (!lock || lock.resources.length === 0) {
      return {
        name: "archive",
        status: "ok",
        message: "No locked resources to check for archive status.",
      };
    }

    try {
      const sourceCache = new Map<string, ResourceSourceAdapter>();
      const archived: string[] = [];
      for (const resource of lock.resources) {
        const sourceInfo = this.resolveLockResourceSourceInfo(lock, resource.source);
        const sourceKey = resource.source ?? "__default__";
        let source = sourceCache.get(sourceKey);
        if (!source) {
          source = await this.loadSourceFromLock(sourceInfo);
          sourceCache.set(sourceKey, source);
        }
        if (await source.isArchived(resource.type, resource.name)) {
          archived.push(`${resource.type}/${resource.name}@${resource.version}`);
        }
      }

      if (archived.length > 0) {
        return {
          name: "archive",
          status: "warn",
          message: `${archived.length} locked resources are archived in their recorded source.`,
          details: { resources: archived },
        };
      }

      return {
        name: "archive",
        status: "ok",
        message: "No locked resources are archived in their recorded source.",
      };
    } catch (error) {
      return {
        name: "archive",
        status: "warn",
        message: `Cannot check archived resources. ${error instanceof Error ? error.message : String(error)
          }`,
      };
    }
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

    const missing = await findMissingLockTargets(projectDir, lock);

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

  async list(
    type: ResourceType,
    agents?: string[],
    options: ResourceListOptions & SourceSelectionOptions = {},
  ): Promise<ResourceMeta[]> {
    const source = await this.loadSourceFromConfig(options.source);
    const resources = await source.list(type, options);
    if (!agents?.length) return resources;
    const selected = normalizeAgents(agents);
    return resources.filter((resource) =>
      normalizeAgents(resource.agents).some((agent) => selected.includes(agent)),
    );
  }

  async archive(
    type: ResourceType,
    name: string,
    options: ArchiveOptions = {},
  ): Promise<ArchiveResult> {
    this.validateResourceIdentity(type, name, "archive");
    const source = await this.loadSourceFromConfig();
    return source.archive(type, name, {
      ...options,
      reason: options.reason?.trim(),
    });
  }

  async comment(
    type: ResourceType,
    name: string,
    options: CommentOptions & SourceSelectionOptions,
  ): Promise<CommentResult> {
    this.validateResourceIdentity(type, name, "comment");
    this.validateResourceScore(options.score);
    const hasText = Object.hasOwn(options, "text");
    if (hasText && options.clearText) {
      throw new HimanError(
        errorCodes.CLI_USAGE,
        "Use either comment text or --clear-text, not both.",
      );
    }

    const source = await this.loadSourceFromConfig(options.source);
    const normalizedText = hasText
      ? this.normalizeResourceCommentText(options.text)
      : undefined;
    return source.comment(type, name, {
      score: options.score,
      ...(hasText ? { text: normalizedText } : {}),
      clearText: options.clearText,
      dryRun: options.dryRun,
    });
  }

  async restore(
    type: ResourceType,
    name: string,
    options: RestoreOptions = {},
  ): Promise<RestoreResult> {
    this.validateResourceIdentity(type, name, "restore");
    const source = await this.loadSourceFromConfig();
    return source.restore(type, name, options);
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
        source: resource.source,
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

  async history(
    type: ResourceType,
    name: string,
    options: SourceSelectionOptions = {},
  ): Promise<VersionInfo[]> {
    const source = await this.loadSourceFromConfig(options.source);
    return source.history(type, name);
  }

  async install(
    type: ResourceType,
    name: string,
    version: string | undefined,
    projectDir: string,
    agents?: string[],
    mode: InstallMode = "copy",
    options: InstallOptions = {},
  ): Promise<InstallResult> {
    const { source, sourceInfo } = await this.loadSourceWithInfoFromConfig(options.source);
    return this.installWithSource(
      source,
      sourceInfo,
      type,
      name,
      version,
      projectDir,
      agents,
      mode,
      "project",
      options,
    );
  }

  async installGlobal(
    type: ResourceType,
    name: string,
    version: string | undefined,
    projectDir: string,
    agents?: string[],
    mode: InstallMode = "copy",
    options: InstallOptions = {},
  ): Promise<InstallResult> {
    const source = await this.loadSourceFromConfig(options.source);
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
      options,
    );
  }

  async installWithDependencies(
    name: string,
    version: string | undefined,
    projectDir: string,
    agents?: string[],
    mode: InstallMode = "copy",
    dependencyDepth = 1,
    options: InstallOptions = {},
  ): Promise<InstallResult[]> {
    const { source, sourceInfo } = await this.loadSourceWithInfoFromConfig(options.source);
    return this.installSkillDependencyClosure(
      source,
      sourceInfo,
      name,
      version,
      projectDir,
      agents,
      mode,
      dependencyDepth,
      "project",
      options,
    );
  }

  async installGlobalWithDependencies(
    name: string,
    version: string | undefined,
    projectDir: string,
    agents?: string[],
    mode: InstallMode = "copy",
    dependencyDepth = 1,
    options: InstallOptions = {},
  ): Promise<InstallResult[]> {
    const source = await this.loadSourceFromConfig(options.source);
    return this.installSkillDependencyClosure(
      source,
      undefined,
      name,
      version,
      projectDir,
      agents,
      mode,
      dependencyDepth,
      "global",
      options,
    );
  }

  async getSkillDependencyStatuses(
    name: string,
    version: string | undefined,
    projectDir: string,
    options: InstallOptions & { depth?: number } = {},
  ): Promise<SkillDependencyStatus[]> {
    const source = await this.loadSourceFromConfig(options.source);
    const { storePath } = await this.ensureStoredResource(
      source,
      "skill",
      name,
      version,
    );
    const dependencies = await this.collectSkillDependencyRefs(
      source,
      storePath,
      options.depth ?? 1,
    );

    const statuses: SkillDependencyStatus[] = [];
    for (const dependency of dependencies) {
      const projectTarget = await this.tryResolveInstalledResource(
        projectDir,
        "skill",
        dependency.name,
      );
      const globalTarget = await this.tryResolveGlobalResourceTarget(
        projectDir,
        "skill",
        dependency.name,
      );
      const systemTarget = await this.tryResolveSystemSkillTarget(dependency.name);
      statuses.push({
        ...dependency,
        installedInProject: Boolean(projectTarget),
        installedGlobally: Boolean(globalTarget),
        availableAsSystemSkill: Boolean(systemTarget),
        projectAgents: projectTarget?.agents ?? [],
        globalAgents: globalTarget?.agents ?? [],
        systemAgents: systemTarget?.agents ?? [],
      });
    }

    return statuses;
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
      if (type === "config") {
        await this.activateConfigResource(projectDir, projectTarget.resourcePath);
      }
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
    if (type === "config") {
      await this.activateConfigResource(projectDir, projectLinkPaths[0]);
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
    await this.registryStore.remove({ scope: "project", projectDir, type, name });
    if (type === "config") {
      await this.reactivateProjectConfig(projectDir);
    }
    if (
      installInfo.agents.includes("copilot") &&
      (type === "rule" || type === "skill")
    ) {
      if (type === "rule") {
        await this.syncCopilotInstructions(projectDir);
      } else {
        await this.removeCopilotSkill(projectDir, name);
      }
    }
    return { type, name, linkPath: installInfo.linkPaths[0] };
  }

  async uninstallGlobal(
    type: ResourceType,
    name: string,
    projectDir: string,
  ): Promise<{ type: ResourceType; name: string; linkPath: string }> {
    const globalTarget = await this.tryResolveGlobalResourceTarget(
      projectDir,
      type,
      name,
    );
    if (!globalTarget || globalTarget.linkPaths.length === 0) {
      throw new HimanError(
        errorCodes.INSTALL_NOT_FOUND,
        `Global installed resource link not found for ${type}/${name}.`,
      );
    }

    for (const linkPath of globalTarget.linkPaths) {
      await fs.rm(linkPath, { recursive: true, force: true });
    }
    await this.registryStore.remove({ scope: "global", type, name });
    if (type === "config") {
      await fs.rm(this.getCodexActiveConfigPath(this.paths.getHomeDir()), {
        force: true,
      });
    }
    if (
      globalTarget.agents.includes("copilot") &&
      (type === "rule" || type === "skill")
    ) {
      const homeDir = this.paths.getHomeDir();
      if (type === "rule") {
        await this.syncCopilotInstructions(homeDir);
      } else {
        await this.removeCopilotSkill(homeDir, name);
      }
    }
    return { type, name, linkPath: globalTarget.linkPaths[0] };
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
    followUp?: PublishFollowUp;
  }> {
    const installScope = options.installScope ?? "project";
    this.reportPublishProgress(options, "prepare", `Preparing ${type}/${name}.`);
    const { source, sourceInfo } = await this.loadSourceWithInfoFromConfig(
      options.source,
    );
    let lockResourceSource: string | undefined;
    if (installScope === "project") {
      lockResourceSource = await this.resolveProjectLockResourceSource(
        projectDir,
        sourceInfo,
      );
    }
    if (await source.isArchived(type, name)) {
      throw new HimanError(
        errorCodes.RESOURCE_ARCHIVED,
        `Resource is archived: ${type}/${name}. Restore it before publishing a new version.`,
      );
    }
    const sourceDir = await this.resolvePublishSourceDir(
      type,
      name,
      projectDir,
      sourceInfo,
    );
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
      await this.upsertProjectLockResource(projectDir, sourceInfo, {
        type,
        name,
        version: nextVersion,
        source: lockResourceSource,
        agents: nextAgents,
        mode: installMode,
      });
    }
    await this.registerInstalledTargets({
      scope: installScope,
      projectDir,
      type,
      name,
      version: nextVersion,
      source: lockResourceSource ?? sourceInfo?.name ?? sourceInfo?.repo,
      agents: nextAgents,
      mode: installMode,
      linkPaths,
    });
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
    const followUp =
      installScope === "project"
        ? this.buildCodexPublishFollowUp(type, name, projectDir, sourceDir)
        : undefined;
    return {
      type,
      name,
      version: result.version,
      tag: result.tag,
      installScope,
      linkPath: linkPaths[0],
      followUp,
    };
  }

  async listProjectPublishResources(
    projectDir: string,
    type?: ResourceType,
  ): Promise<PublishRequest[]> {
    const types = type ? [type] : RESOURCE_TYPES;
    const discovered: PublishRequest[] = [];

    for (const currentType of types) {
      const roots = this.getProjectPublishRootCandidates(projectDir, currentType);
      const names = new Set<string>();

      for (const root of roots) {
        if (!(await this.exists(root))) continue;
        const entries = await fs.readdir(root, { withFileTypes: true });
        for (const entry of entries) {
          if (!entry.isDirectory()) continue;
          names.add(entry.name);
        }
      }

      for (const name of [...names].sort((left, right) => left.localeCompare(right))) {
        const sourceDir = await this.tryResolvePublishSourceDir(currentType, name, projectDir);
        if (!sourceDir) continue;
        discovered.push({ type: currentType, name });
      }
    }

    return discovered.sort((left, right) => {
      const typeDelta = RESOURCE_TYPES.indexOf(left.type) - RESOURCE_TYPES.indexOf(right.type);
      if (typeDelta !== 0) return typeDelta;
      return left.name.localeCompare(right.name);
    });
  }

  async publishMany(
    requests: PublishRequest[],
    releaseType: "patch" | "minor" | "major",
    projectDir: string,
    options: PublishOptions = {},
  ): Promise<PublishBatchItem[]> {
    const results: PublishBatchItem[] = [];

    for (const [index, request] of requests.entries()) {
      options.onBatchProgress?.({
        stage: "start",
        current: index + 1,
        total: requests.length,
        item: request,
        message: `Publishing ${request.type}/${request.name}.`,
      });
      try {
        const result = await this.publish(
          request.type,
          request.name,
          releaseType,
          projectDir,
          options,
        );
        results.push({
          type: result.type,
          name: result.name,
          status: "published",
          version: result.version,
          tag: result.tag,
          installScope: result.installScope,
          linkPath: result.linkPath,
          followUp: result.followUp,
        });
        options.onBatchProgress?.({
          stage: "success",
          current: index + 1,
          total: requests.length,
          item: request,
          message: `Published ${result.type}/${result.name}@${result.version}.`,
        });
      } catch (error) {
        if (
          error instanceof HimanError &&
          error.code === errorCodes.PUBLISH_NO_CHANGES
        ) {
          results.push({
            type: request.type,
            name: request.name,
            status: "skipped",
            error: {
              code: error.code,
              message: error.message,
            },
          });
          options.onBatchProgress?.({
            stage: "skip",
            current: index + 1,
            total: requests.length,
            item: request,
            message: error.message,
          });
          continue;
        }

        results.push({
          type: request.type,
          name: request.name,
          status: "failed",
          error: {
            code: error instanceof HimanError ? error.code : "E_UNKNOWN",
            message: error instanceof Error ? error.message : String(error),
          },
        });
        options.onBatchProgress?.({
          stage: "failed",
          current: index + 1,
          total: requests.length,
          item: request,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return results;
  }

  async create(
    type: ResourceType,
    name: string,
    options: CreateOptions,
    projectDir: string,
  ): Promise<CreateResult> {
    this.validateCreateInput(type, name, options);
    await this.loadSourceFromConfig();

    const agents = await this.resolveEffectiveAgents(
      projectDir,
      type,
      options.agents,
    );
    this.validateResourceAgents(type, agents);
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
    const sourceCache = new Map<string, ResourceSourceAdapter>();
    for (const item of lock.resources) {
      const lockSourceInfo = this.resolveLockResourceSourceInfo(lock, item.source);
      const sourceKey = item.source ?? "__default__";
      let lockedSource = sourceCache.get(sourceKey);
      if (!lockedSource) {
        lockedSource = await this.loadSourceFromLock(lockSourceInfo);
        sourceCache.set(sourceKey, lockedSource);
      }
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
        { includeArchived: true },
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
    options: InstallOptions = {},
  ): Promise<InstallResult> {
    const prepared = await this.prepareInstall(
      source,
      type,
      name,
      version,
      projectDir,
      agents,
      mode,
      scope,
      options,
    );
    return this.materializePreparedInstall(prepared, projectDir, sourceInfo);
  }

  private async installSkillDependencyClosure(
    source: ResourceSourceAdapter,
    sourceInfo: LockSourceInfo | undefined,
    name: string,
    version: string | undefined,
    projectDir: string,
    agents: string[] | undefined,
    mode: InstallMode,
    dependencyDepth: number,
    scope: "project" | "global",
    options: InstallOptions,
  ): Promise<InstallResult[]> {
    const installed = new Map<string, InstallResult>();
    const results: InstallResult[] = [];
    await this.installSkillDependencyNode(
      source,
      sourceInfo,
      name,
      version,
      projectDir,
      agents,
      mode,
      dependencyDepth,
      scope,
      options,
      [],
      installed,
      results,
    );
    return results;
  }

  private async collectSkillDependencyRefs(
    source: ResourceSourceAdapter,
    storePath: string,
    maxDepth: number,
  ): Promise<Array<{ name: string; optional: boolean; depth: number }>> {
    if (maxDepth <= 0) {
      return [];
    }

    const collected = new Map<string, { name: string; optional: boolean; depth: number }>();
    const storeCache = new Map<string, string | null>();
    await this.collectSkillDependencyRefsFromStore(
      source,
      storePath,
      0,
      maxDepth,
      collected,
      [],
      storeCache,
    );
    return [...collected.values()];
  }

  private async collectSkillDependencyRefsFromStore(
    source: ResourceSourceAdapter,
    storePath: string,
    currentDepth: number,
    maxDepth: number,
    collected: Map<string, { name: string; optional: boolean; depth: number }>,
    visiting: string[],
    storeCache: Map<string, string | null>,
  ): Promise<void> {
    if (currentDepth >= maxDepth) {
      return;
    }

    const dependencies = await this.readSkillDependenciesFromDir(storePath);
    for (const dependency of dependencies) {
      const existing = collected.get(dependency.name);
      if (existing) {
        existing.optional = existing.optional && dependency.optional;
        existing.depth = Math.min(existing.depth, currentDepth + 1);
      } else {
        collected.set(dependency.name, {
          name: dependency.name,
          optional: dependency.optional,
          depth: currentDepth + 1,
        });
      }

      if (currentDepth + 1 >= maxDepth) {
        continue;
      }

      const dependencyKey = `skill/${dependency.name}`;
      if (visiting.includes(dependencyKey)) {
        continue;
      }

      const dependencyStorePath = await this.tryResolveStoredResource(
        source,
        "skill",
        dependency.name,
        undefined,
        storeCache,
      );
      if (!dependencyStorePath) {
        continue;
      }

      visiting.push(dependencyKey);
      try {
        await this.collectSkillDependencyRefsFromStore(
          source,
          dependencyStorePath,
          currentDepth + 1,
          maxDepth,
          collected,
          visiting,
          storeCache,
        );
      } finally {
        if (visiting[visiting.length - 1] === dependencyKey) {
          visiting.pop();
        }
      }
    }
  }

  private async installSkillDependencyNode(
    source: ResourceSourceAdapter,
    sourceInfo: LockSourceInfo | undefined,
    name: string,
    version: string | undefined,
    projectDir: string,
    agents: string[] | undefined,
    mode: InstallMode,
    remainingDepth: number,
    scope: "project" | "global",
    options: InstallOptions,
    visiting: string[],
    installed: Map<string, InstallResult>,
    results: InstallResult[],
  ): Promise<InstallResult> {
    const key = `skill/${name}`;
    const cached = installed.get(key);
    if (cached) return cached;

    const cycleStartIndex = visiting.indexOf(key);
    if (cycleStartIndex >= 0) {
      const cycle = [...visiting.slice(cycleStartIndex), key];
      throw new HimanError(
        errorCodes.INVALID_RESOURCE_METADATA,
        `Circular skill dependency detected: ${cycle.join(" -> ")}.`,
        { cycle },
      );
    }

    const prepared = await this.prepareInstall(
      source,
      "skill",
      name,
      version,
      projectDir,
      agents,
      mode,
      scope,
      options,
    );

    visiting.push(key);
    try {
      if (remainingDepth > 0) {
        const dependencies = await this.readSkillDependenciesFromDir(prepared.storePath);
        for (const dependency of dependencies) {
          try {
            await this.installSkillDependencyNode(
              source,
              sourceInfo,
              dependency.name,
              undefined,
              projectDir,
              prepared.effectiveTargets,
              mode,
              remainingDepth - 1,
              scope,
              options,
              visiting,
              installed,
              results,
            );
          } catch (error) {
            if (dependency.optional && this.isSkippableOptionalDependencyError(error)) {
              continue;
            }
            throw error;
          }
        }
      }

      const result = await this.materializePreparedInstall(prepared, projectDir, sourceInfo);
      installed.set(key, result);
      results.push(result);
      return result;
    } finally {
      if (visiting[visiting.length - 1] === key) {
        visiting.pop();
      }
    }
  }

  private async prepareInstall(
    source: ResourceSourceAdapter,
    type: ResourceType,
    name: string,
    version: string | undefined,
    projectDir: string,
    agents: string[] | undefined,
    mode: InstallMode,
    scope: "project" | "global",
    options: InstallOptions,
  ): Promise<PreparedInstall> {
    const archived = await source.isArchived(type, name);
    if (archived && !options.includeArchived) {
      throw new HimanError(
        errorCodes.RESOURCE_ARCHIVED,
        `Resource is archived: ${type}/${name}. Use --include-archived to install an archived version explicitly.`,
      );
    }

    const { version: resolvedVersion, storePath } = await this.ensureStoredResource(
      source,
      type,
      name,
      version,
    );
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
          type,
          agents,
          resourceMeta?.agents,
        );
    this.validateResourceAgents(type, effectiveTargets);
    const linkPaths =
      scope === "global"
        ? getGlobalResourcePaths(this.paths.getHomeDir(), type, name, effectiveTargets)
        : getProjectResourcePaths(projectDir, type, name, effectiveTargets);

    return {
      type,
      name,
      version: resolvedVersion,
      storePath,
      effectiveTargets,
      linkPaths,
      mode,
      scope,
    };
  }

  private async materializePreparedInstall(
    prepared: PreparedInstall,
    projectDir: string,
    sourceInfo?: LockSourceInfo,
  ): Promise<InstallResult> {
    let lockResourceSource: string | undefined;
    if (prepared.scope === "project") {
      if (!sourceInfo) {
        throw new Error("Project install requires source lock information.");
      }
      lockResourceSource = await this.resolveProjectLockResourceSource(
        projectDir,
        sourceInfo,
      );
    }

    if (prepared.type === "config") {
      const rootDir =
        prepared.scope === "global" ? this.paths.getHomeDir() : projectDir;
      await this.resetConfigTargets(rootDir);
    }

    for (const linkPath of prepared.linkPaths) {
      await this.materializeResource(prepared.storePath, linkPath, prepared.mode);
    }
    if (prepared.type === "config") {
      await this.activateConfigResource(
        prepared.scope === "global" ? this.paths.getHomeDir() : projectDir,
        prepared.linkPaths[0],
      );
    }
    if (
      prepared.effectiveTargets.includes("copilot") &&
      (prepared.type === "rule" || prepared.type === "skill")
    ) {
      const syncRootDir =
        prepared.scope === "global" ? this.paths.getHomeDir() : projectDir;
      await this.syncCopilotTargets(syncRootDir, prepared.type, [
        prepared.name,
      ]);
    }
    if (prepared.scope === "project") {
      if (!sourceInfo) {
        throw new Error("Project install requires source lock information.");
      }
      if (prepared.type === "config") {
        await this.removeOtherProjectConfigLocks(projectDir, prepared.name);
      }
      await this.upsertProjectLockResource(projectDir, sourceInfo, {
        type: prepared.type,
        name: prepared.name,
        version: prepared.version,
        source: lockResourceSource,
        agents: prepared.effectiveTargets,
        mode: prepared.mode,
      });
    }
    await this.registerInstalledTargets({
      scope: prepared.scope,
      projectDir,
      type: prepared.type,
      name: prepared.name,
      version: prepared.version,
      source: lockResourceSource ?? sourceInfo?.name ?? sourceInfo?.repo,
      agents: prepared.effectiveTargets,
      mode: prepared.mode,
      linkPaths: prepared.linkPaths,
    });

    return {
      type: prepared.type,
      name: prepared.name,
      version: prepared.version,
      linkPath: prepared.linkPaths[0],
      mode: prepared.mode,
    };
  }

  private async loadSourceFromConfig(sourceRef?: string): Promise<ResourceSourceAdapter> {
    return (await this.loadSourceWithInfoFromConfig(sourceRef)).source;
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

  private validateSourceAlias(alias: string): void {
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(alias)) {
      throw new HimanError(errorCodes.INVALID_INPUT, `Invalid source alias: ${alias}`);
    }
  }

  private ensureSourceAliasAvailable(
    items: Record<string, SourceState>,
    alias: string,
    exceptName?: string,
  ): void {
    const existing = Object.entries(items).find(
      ([name, source]) => name !== exceptName && source.alias === alias,
    );
    if (existing) {
      throw new HimanError(
        errorCodes.INVALID_INPUT,
        `Source alias already exists: ${alias}`,
      );
    }
  }

  private resolveConfiguredSourceAlias(
    items: Record<string, SourceState>,
    alias: string,
  ): { name: string; source: SourceState } | undefined {
    const found = Object.entries(items).find(
      ([, source]) => source.alias === alias,
    );
    if (!found) return undefined;
    return { name: found[0], source: found[1] };
  }

  private resolveConfiguredSourceRef(
    items: Record<string, SourceState>,
    ref: string,
  ): { name: string; source: SourceState } | undefined {
    const byName = items[ref];
    if (byName) return { name: ref, source: byName };
    return this.resolveConfiguredSourceAlias(items, ref);
  }

  private async loadSourceWithInfoFromConfig(sourceRef?: string): Promise<{
    source: ResourceSourceAdapter;
    sourceInfo: LockSourceInfo;
  }> {
    const { name, source: stateSource } = await this.getCurrentSourceState(sourceRef);
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

  private async getCurrentSourceState(sourceRef?: string): Promise<{
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
    if (sourceRef && sourceRef !== "default") {
      const resolved = config.sources
        ? this.resolveConfiguredSourceAlias(config.sources.items, sourceRef)
        : undefined;
      if (!resolved) {
        throw new HimanError(
          errorCodes.RESOURCE_NOT_FOUND,
          `Source alias not found: ${sourceRef}`,
        );
      }
      return resolved;
    }

    const currentSource = config.sources?.items[currentName] ?? config.source;
    return { name: currentName, source: currentSource };
  }

  private createSource(type: "git" | "registry" | "local"): ResourceSourceAdapter {
    if (type === "registry") return new RegistrySourceAdapter();
    if (type === "local") return new LocalSourceAdapter();
    return new GitSourceAdapter();
  }

  private async getLockSourceInfo(): Promise<{
    name?: string;
    type: "git" | "registry" | "local";
    repo?: string;
    repoId?: string;
  }> {
    const { name, source } = await this.getCurrentSourceState();
    return this.toLockSourceInfo(source, name);
  }

  private toLockSourceInfo(source: SourceState, name?: string): LockSourceInfo {
    return this.normalizeLockSourceInfo({
      name: source.alias ?? name,
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

  private async upsertProjectLockResource(
    projectDir: string,
    sourceInfo: LockSourceInfo,
    resource: {
      type: ResourceType;
      name: string;
      version: string;
      source?: string;
      agents?: string[];
      mode?: InstallMode;
    },
  ): Promise<void> {
    await this.lockStore.upsertResource(projectDir, sourceInfo, resource);
  }

  private async resolveProjectLockResourceSource(
    projectDir: string,
    sourceInfo: LockSourceInfo,
  ): Promise<string | undefined> {
    const lock = await this.lockStore.load(projectDir);
    if (!lock || lock.resources.length === 0) return undefined;

    const lockSource = this.normalizeLockSourceInfo(lock.source);
    const selectedSource = this.normalizeLockSourceInfo(sourceInfo);
    if (this.isSameLockSource(lockSource, selectedSource)) return undefined;

    const sourceName = selectedSource.name?.trim();
    if (!sourceName) {
      throw new HimanError(
        errorCodes.INVALID_INPUT,
        `Project lock already has a default source. Additional lock sources require a source name.`,
        {
          lockSource,
          selectedSource,
          lockPath: this.lockStore.getLockPath(projectDir),
        },
      );
    }

    if (lockSource.name === sourceName) {
      throw new HimanError(
        errorCodes.INVALID_INPUT,
        `Lock source name conflicts with the default source: ${sourceName}`,
        {
          lockSource,
          selectedSource,
          lockPath: this.lockStore.getLockPath(projectDir),
        },
      );
    }

    const existingSource = lock.sources?.[sourceName];
    if (!existingSource) return sourceName;
    if (this.isSameLockSource(this.normalizeLockSourceInfo(existingSource), selectedSource)) {
      return sourceName;
    }

    throw new HimanError(
      errorCodes.INVALID_INPUT,
      `Lock source name already refers to a different source: ${sourceName}`,
      {
        lockSource,
        existingSource,
        selectedSource,
        lockPath: this.lockStore.getLockPath(projectDir),
      },
    );
  }

  private resolveLockResourceSourceInfo(
    lock: ProjectLock,
    sourceName?: string,
  ): LockSourceInfo {
    if (!sourceName) return this.normalizeLockSourceInfo(lock.source);
    const sourceInfo = lock.sources?.[sourceName];
    if (sourceInfo) {
      return this.normalizeLockSourceInfo({
        name: sourceInfo.name ?? sourceName,
        type: sourceInfo.type,
        repo: sourceInfo.repo,
        repoId: sourceInfo.repoId,
      });
    }
    if (lock.source.name === sourceName) {
      return this.normalizeLockSourceInfo(lock.source);
    }
    throw new HimanError(
      errorCodes.LOCK_INVALID,
      `Lock resource references unknown source: ${sourceName}`,
      {
        source: sourceName,
        availableSources: Object.keys(lock.sources ?? {}),
      },
    );
  }

  private isSameLockSource(a: LockSourceInfo, b: LockSourceInfo): boolean {
    if (a.type !== b.type) return false;
    if (a.type === "git") {
      const leftRepoId = a.repoId ?? (a.repo ? toRepoId(a.repo) : undefined);
      const rightRepoId = b.repoId ?? (b.repo ? toRepoId(b.repo) : undefined);
      if (leftRepoId && rightRepoId) return leftRepoId === rightRepoId;
      if (a.repo && b.repo) return a.repo === b.repo;
    }
    if (a.type === "local") {
      if (a.repo && b.repo) return a.repo === b.repo;
    }
    return true;
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
    type: "git" | "registry" | "local",
    repo?: string,
    repoId?: string,
  ): SourceConfig {
    if (type === "registry") {
      return { type };
    }
    if (type === "local") {
      if (!repo) {
        throw new HimanError(
          errorCodes.INVALID_INPUT,
          "Local source root directory is required.",
        );
      }
      const effectiveRepoId = repoId ?? toRepoId(repo);
      return {
        type,
        repo,
        repoId: effectiveRepoId,
        repoDir: repo,
      };
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

  private resolveVersion(
    history: VersionInfo[],
    type: ResourceType,
    name: string,
    version?: string,
  ): string {
    if (!version) return history[0].version;
    const found = history.find((item) => item.version === version);
    if (!found) {
      const available = history.map((item) => item.version).join(", ");
      throw new HimanError(
        errorCodes.VERSION_NOT_FOUND,
        `Version not found: ${type}/${name}@${version}. Available versions: ${available || "(none)"}`,
      );
    }
    return found.version;
  }

  private async ensureStoredResource(
    source: ResourceSourceAdapter,
    type: ResourceType,
    name: string,
    version: string | undefined,
  ): Promise<{ version: string; storePath: string }> {
    const history = await source.history(type, name);
    if (history.length === 0) {
      throw new HimanError(
        errorCodes.RESOURCE_NOT_FOUND,
        `Resource not found: ${type}/${name}`,
      );
    }

    const resolvedVersion = this.resolveVersion(history, type, name, version);
    const storePath = this.getStorePath(type, name, resolvedVersion);
    if (!(await this.exists(storePath))) {
      await source.pull(type, name, resolvedVersion, storePath);
    }
    return {
      version: resolvedVersion,
      storePath,
    };
  }

  private async tryResolveStoredResource(
    source: ResourceSourceAdapter,
    type: ResourceType,
    name: string,
    version: string | undefined,
    cache: Map<string, string | null>,
  ): Promise<string | undefined> {
    const cacheKey = `${type}/${name}@${version ?? "latest"}`;
    const cached = cache.get(cacheKey);
    if (cached !== undefined) {
      return cached ?? undefined;
    }

    try {
      const { storePath } = await this.ensureStoredResource(source, type, name, version);
      cache.set(cacheKey, storePath);
      return storePath;
    } catch (error) {
      if (
        error instanceof HimanError &&
        (error.code === errorCodes.RESOURCE_NOT_FOUND
          || error.code === errorCodes.VERSION_NOT_FOUND)
      ) {
        cache.set(cacheKey, null);
        return undefined;
      }
      throw error;
    }
  }

  private getStorePath(type: ResourceType, name: string, version: string): string {
    return path.join(this.paths.getStoreDir(), type, name, version);
  }

  private getLocalSourceRoot(): string {
    return path.join(this.paths.getHimanRoot(), "local-source");
  }

  private ensureMigrateResourceType(type: string): ResourceType {
    if (
      type !== "rule"
      && type !== "command"
      && type !== "skill"
      && type !== "config"
    ) {
      throw new HimanError(
        errorCodes.UNSUPPORTED_RESOURCE_TYPE,
        `Unsupported resource type: ${type}`,
      );
    }
    return type;
  }

  private async inferMigrateResourceType(
    resourcePath: string,
  ): Promise<ResourceType> {
    const yamlPath = path.join(resourcePath, "himan.yaml");
    if (await this.exists(yamlPath)) {
      try {
        const raw = await fs.readFile(yamlPath, "utf8");
        const parsed = YAML.parse(raw) as { type?: unknown } | null;
        if (parsed && typeof parsed.type === "string" && parsed.type) {
          return this.ensureMigrateResourceType(parsed.type);
        }
      } catch {
        // Fall through to path inference.
      }
    }

    const parentDir = path.basename(path.dirname(resourcePath));
    const byDir: Record<string, ResourceType> = {
      rules: "rule",
      commands: "command",
      skills: "skill",
      configs: "config",
    };
    if (byDir[parentDir]) return byDir[parentDir];

    throw new HimanError(
      errorCodes.UNSUPPORTED_RESOURCE_TYPE,
      "Cannot infer resource type from path. Pass --type rule|command|skill|config.",
    );
  }

  private async ensureLocalSourceConfigured(): Promise<void> {
    const config = await this.stateStore.loadConfig();
    const existing = config?.sources?.items
      ? Object.values(config.sources.items).some(
        (source) => source.type === "local",
      )
      : false;
    if (existing) return;
    await this.addSource("local", "local", this.getLocalSourceRoot(), "local");
  }

  private async readMigrateResourceMeta(
    resourceDir: string,
    type: ResourceType,
  ): Promise<{
    entry?: string;
    version?: string;
    description?: string;
    category?: string;
    agents?: string[];
    comment?: { score: number; text?: string };
  } | undefined> {
    const yamlPath = path.join(resourceDir, "himan.yaml");
    if (await this.exists(yamlPath)) {
      const raw = await fs.readFile(yamlPath, "utf8");
      const parsed = YAML.parse(raw) as {
        entry?: unknown;
        version?: unknown;
        description?: unknown;
        category?: unknown;
        agents?: unknown;
        targets?: unknown;
        comment?: unknown;
      } | null;
      if (!parsed) return undefined;
      return {
        entry:
          typeof parsed.entry === "string" && parsed.entry
            ? parsed.entry
            : undefined,
        version:
          typeof parsed.version === "string" && parsed.version
            ? parsed.version
            : undefined,
        description:
          typeof parsed.description === "string"
            ? parsed.description
            : undefined,
        category:
          typeof parsed.category === "string" ? parsed.category : undefined,
        agents:
          Array.isArray(parsed.agents)
            ? (parsed.agents as string[]).filter((item): item is string => typeof item === "string")
            : Array.isArray(parsed.targets)
              ? (parsed.targets as string[]).filter((item): item is string => typeof item === "string")
              : undefined,
        comment:
          parsed.comment && typeof parsed.comment === "object"
            ? (parsed.comment as { score: number; text?: string })
            : undefined,
      };
    }

    if (type !== "skill") return undefined;
    const entryPath = path.join(resourceDir, this.getDefaultEntry(type));
    if (!(await this.exists(entryPath))) return undefined;
    const metadata = await this.readFrontMatter(entryPath);
    return {
      description: this.readStringMetadata(metadata, "description"),
      agents:
        this.readStringArrayMetadata(metadata, "agents")
        ?? this.readStringArrayMetadata(metadata, "targets"),
    };
  }

  private async readResourceFiles(
    resourceDir: string,
  ): Promise<Array<{ path: string; content: string }>> {
    const files: Array<{ path: string; content: string }> = [];
    await this.collectResourceFiles(resourceDir, "", files);
    return files;
  }

  private async collectResourceFiles(
    dirPath: string,
    relativeDir: string,
    files: Array<{ path: string; content: string }>,
  ): Promise<void> {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);
      const relativePath = relativeDir
        ? path.join(relativeDir, entry.name)
        : entry.name;
      if (entry.isDirectory()) {
        await this.collectResourceFiles(fullPath, relativePath, files);
      } else if (entry.isFile()) {
        files.push({
          path: relativePath,
          content: await fs.readFile(fullPath, "utf8"),
        });
      }
    }
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

  private async registerInstalledTargets(params: {
    scope: InstallScope;
    projectDir: string;
    type: ResourceType;
    name: string;
    version: string;
    source?: string;
    agents: string[];
    mode: InstallMode;
    linkPaths: string[];
  }): Promise<void> {
    const now = new Date().toISOString();
    const entries: InstalledRegistryEntry[] = params.agents.map((agent, index) => ({
      scope: params.scope,
      projectDir: params.scope === "project" ? params.projectDir : undefined,
      agent,
      type: params.type,
      name: params.name,
      version: params.version,
      source: params.source,
      mode: params.mode,
      targetPath:
        params.linkPaths[index]
        ?? params.linkPaths[params.linkPaths.length - 1],
      updatedAt: now,
    }));
    await this.registryStore.upsertMany(entries);
  }

  private getDefaultAgentsForType(type: ResourceType): string[] {
    return type === "config" ? ["codex"] : normalizeAgents();
  }

  private validateResourceAgents(type: ResourceType, agents: string[]): void {
    const normalizedAgents = normalizeAgents(agents);
    if (type === "config") {
      const invalidAgents = normalizedAgents.filter((agent) => agent !== "codex");
      if (invalidAgents.length > 0) {
        throw new HimanError(
          errorCodes.INVALID_INPUT,
          `Resource type ${type} currently only supports codex.`,
          { type, agents, invalidAgents },
        );
      }
      return;
    }

    if (type === "command") {
      const invalidAgents = normalizedAgents.filter((agent) => agent === "copilot");
      if (invalidAgents.length > 0) {
        throw new HimanError(
          errorCodes.INVALID_INPUT,
          `Resource type ${type} currently does not support copilot.`,
          { type, agents, invalidAgents },
        );
      }
    }
  }

  private getCodexConfigDir(rootDir: string): string {
    return path.join(rootDir, ".codex");
  }

  private getLegacyCodexProjectPath(
    projectDir: string,
    type: ResourceType,
    name: string,
  ): string | undefined {
    if (type === "rule") {
      return path.join(projectDir, ".agents", "rules", name);
    }
    if (type === "skill") {
      return path.join(projectDir, ".codex", "skills", name);
    }
    return undefined;
  }

  private buildCodexPublishFollowUp(
    type: ResourceType,
    name: string,
    projectDir: string,
    sourceDir: string,
  ): PublishFollowUp | undefined {
    const legacyPath = this.getLegacyCodexProjectPath(projectDir, type, name);
    if (!legacyPath) return undefined;
    if (path.resolve(sourceDir) !== path.resolve(legacyPath)) {
      return undefined;
    }

    const canonicalPath = getProjectResourcePaths(projectDir, type, name, ["codex"])[0];
    if (path.resolve(canonicalPath) === path.resolve(legacyPath)) {
      return undefined;
    }

    const resourceLabel = type === "rule" ? "rule" : "skill";
    return {
      legacyPath,
      canonicalPath,
      message:
        `Legacy Codex ${resourceLabel} path detected: ${legacyPath}\n` +
        `Canonical Codex ${resourceLabel} path: ${canonicalPath}`,
    };
  }

  private getCodexActiveConfigPath(rootDir: string): string {
    return path.join(this.getCodexConfigDir(rootDir), "config.toml");
  }

  private async resetConfigTargets(rootDir: string): Promise<void> {
    await fs.rm(this.getCodexActiveConfigPath(rootDir), { force: true });
  }

  private async activateConfigResource(
    rootDir: string,
    resourcePath: string,
  ): Promise<void> {
    const sourcePath = path.join(resourcePath, this.getDefaultEntry("config"));
    if (!(await this.exists(sourcePath))) {
      throw new HimanError(
        errorCodes.INVALID_RESOURCE_METADATA,
        `Config resource entry not found: ${sourcePath}`,
        { resourcePath, sourcePath },
      );
    }
    const targetPath = this.getCodexActiveConfigPath(rootDir);
    await fs.mkdir(path.dirname(targetPath), { recursive: true });
    await fs.copyFile(sourcePath, targetPath);
  }

  private async removeOtherProjectConfigLocks(
    projectDir: string,
    keepName: string,
  ): Promise<void> {
    const installedConfigs = await this.listInstalled(projectDir, "config");
    for (const resource of installedConfigs) {
      if (resource.name === keepName) continue;
      await this.lockStore.removeResource(projectDir, {
        type: resource.type,
        name: resource.name,
      });
    }
  }

  private async reactivateProjectConfig(projectDir: string): Promise<void> {
    const installedConfigs = await this.listInstalled(projectDir, "config");
    if (installedConfigs.length === 0) {
      await fs.rm(this.getCodexActiveConfigPath(projectDir), { force: true });
      return;
    }

    const nextConfig = installedConfigs[installedConfigs.length - 1];
    const nextTarget = await this.tryResolveProjectResourceTarget(
      projectDir,
      "config",
      nextConfig.name,
    );
    if (!nextTarget) {
      await fs.rm(this.getCodexActiveConfigPath(projectDir), { force: true });
      return;
    }
    await this.activateConfigResource(projectDir, nextTarget.resourcePath);
  }

  private resolveInstallMode(mode?: string): InstallMode {
    return mode === "link" ? "link" : "copy";
  }

  // ── copilot agent helpers ──

  private getCopilotInstructionsPath(rootDir: string): string {
    return path.join(rootDir, ".github", "copilot-instructions.md");
  }

  private getCopilotPromptPath(rootDir: string, name: string): string {
    return path.join(rootDir, ".github", "prompts", `${name}.prompt.md`);
  }

  private async syncCopilotInstructions(rootDir: string): Promise<void> {
    const rulesDir = path.join(rootDir, ".github", "copilot", "rules");
    const targetPath = this.getCopilotInstructionsPath(rootDir);

    const sections: string[] = [];
    try {
      const entries = await fs.readdir(rulesDir, { withFileTypes: true });
      const ruleNames = entries
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .sort((a, b) => a.localeCompare(b));
      for (const ruleName of ruleNames) {
        const contentPath = path.join(rulesDir, ruleName, "content.md");
        try {
          const content = await fs.readFile(contentPath, "utf-8");
          sections.push(
            `<!-- himan:rule:${ruleName} -->\n\n${content.trim()}\n`,
          );
        } catch {
          // skip rules with unreadable content
          continue;
        }
      }
    } catch {
      // rules dir does not exist — target will be removed below
    }

    if (sections.length === 0) {
      await fs.rm(targetPath, { force: true });
      return;
    }

    const tmpPath = `${targetPath}.tmp`;
    await fs.mkdir(path.dirname(targetPath), { recursive: true });
    await fs.writeFile(tmpPath, sections.join("\n"));
    await fs.rename(tmpPath, targetPath);
  }

  private async syncCopilotSkill(
    rootDir: string,
    name: string,
  ): Promise<void> {
    const sourcePath = path.join(
      rootDir,
      ".github",
      "copilot",
      "skills",
      name,
      "SKILL.md",
    );
    const targetPath = this.getCopilotPromptPath(rootDir, name);

    try {
      await fs.access(sourcePath);
      await fs.mkdir(path.dirname(targetPath), { recursive: true });
      await fs.copyFile(sourcePath, targetPath);
    } catch {
      // source does not exist — remove stale target
      await fs.rm(targetPath, { force: true });
    }
  }

  private async removeCopilotSkill(
    rootDir: string,
    name: string,
  ): Promise<void> {
    await fs.rm(this.getCopilotPromptPath(rootDir, name), { force: true });
  }

  private async syncCopilotTargets(
    rootDir: string,
    type: ResourceType,
    names?: string[],
  ): Promise<void> {
    if (type === "rule") {
      await this.syncCopilotInstructions(rootDir);
    } else if (type === "skill" && names) {
      for (const name of names) {
        await this.syncCopilotSkill(rootDir, name);
      }
    }
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

  private async tryResolveSystemSkillTarget(
    name: string,
  ): Promise<{ agents: string[]; resourcePath: string } | undefined> {
    const resourcePath = path.join(
      this.paths.getHomeDir(),
      ".codex",
      "skills",
      ".system",
      name,
    );
    if (!(await this.exists(resourcePath))) {
      return undefined;
    }
    return {
      agents: ["codex"],
      resourcePath,
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
      paths: getResourcePathCandidatesForAgent(rootDir, type, name, agent),
    }));
    const existingCandidates: Array<{ agent: string; path: string }> = [];
    for (const candidate of candidates) {
      const existingPath = await this.findFirstExistingPath(candidate.paths);
      if (existingPath) {
        existingCandidates.push({ agent: candidate.agent, path: existingPath });
      }
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
    const existingFromLock: string[] = [];
    for (const agent of lockedTargets) {
      const candidates = getResourcePathCandidatesForAgent(
        projectDir,
        type,
        name,
        agent,
      );
      const existingPath = await this.findFirstExistingPath(candidates);
      if (existingPath) {
        existingFromLock.push(existingPath);
      }
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
      paths: getResourcePathCandidatesForAgent(projectDir, type, name, agent),
    }));
    const existingCandidates: Array<{ agent: string; path: string }> = [];
    for (const candidate of allCandidates) {
      const existingPath = await this.findFirstExistingPath(candidate.paths);
      if (existingPath) {
        existingCandidates.push({ agent: candidate.agent, path: existingPath });
      }
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
    type: ResourceType,
    explicitAgents?: string[],
    fallbackAgents?: string[],
  ): Promise<string[]> {
    if (explicitAgents?.length) {
      return normalizeAgents(explicitAgents);
    }
    const configuredAgents = await this.getConfiguredAgents(projectDir);
    if (configuredAgents?.length && type !== "config") {
      return configuredAgents;
    }
    const resolved =
      fallbackAgents && fallbackAgents.length > 0
        ? normalizeAgents(fallbackAgents)
        : this.getDefaultAgentsForType(type);
    return resolved;
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
    return this.resolveEffectiveAgents(projectDir, type, undefined, fallbackAgents);
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
      return {
        agents:
          parsed.agents ??
          parsed.targets ??
          (type === "config" ? this.getDefaultAgentsForType(type) : undefined),
      };
    }

    if (type === "config") {
      return { agents: this.getDefaultAgentsForType(type) };
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

  private async readSkillDependenciesFromDir(
    resourceDir: string,
  ): Promise<SkillDependencyRef[]> {
    const yamlPath = path.join(resourceDir, "himan.yaml");
    if (!(await this.exists(yamlPath))) {
      return [];
    }

    let parsed: unknown;
    try {
      parsed = YAML.parse(await fs.readFile(yamlPath, "utf8"));
    } catch {
      throw new HimanError(
        errorCodes.INVALID_RESOURCE_METADATA,
        "himan.yaml is not valid YAML.",
        { yamlPath },
      );
    }

    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      throw new HimanError(
        errorCodes.INVALID_RESOURCE_METADATA,
        "himan.yaml must be an object.",
        { yamlPath },
      );
    }

    const dependencies = (
      parsed as {
        analysis?: {
          dependencies?: {
            skills?: unknown;
          };
        };
      }
    ).analysis?.dependencies?.skills;
    if (dependencies === undefined) {
      return [];
    }
    if (!Array.isArray(dependencies)) {
      throw new HimanError(
        errorCodes.INVALID_RESOURCE_METADATA,
        "analysis.dependencies.skills must be an array when present.",
        { yamlPath },
      );
    }

    const seen = new Set<string>();
    const refs: SkillDependencyRef[] = [];
    for (const entry of dependencies) {
      const dependency = this.parseSkillDependencyEntry(entry, yamlPath);
      if (seen.has(dependency.name)) {
        continue;
      }
      seen.add(dependency.name);
      refs.push(dependency);
    }
    return refs;
  }

  private parseSkillDependencyEntry(
    entry: unknown,
    yamlPath: string,
  ): SkillDependencyRef {
    if (typeof entry === "string") {
      const name = entry.trim();
      if (name) {
        return { name, optional: false };
      }
    } else if (typeof entry === "object" && entry !== null && !Array.isArray(entry)) {
      const { name, optional } = entry as { name?: unknown; optional?: unknown };
      if (typeof name === "string" && name.trim()) {
        if (optional !== undefined && typeof optional !== "boolean") {
          throw new HimanError(
            errorCodes.INVALID_RESOURCE_METADATA,
            "Skill dependency optional flag must be boolean when present.",
            { yamlPath, dependency: entry },
          );
        }
        return { name: name.trim(), optional: optional === true };
      }
    }

    throw new HimanError(
      errorCodes.INVALID_RESOURCE_METADATA,
      "Skill dependency entries must be a non-empty string or an object with a name field.",
      { yamlPath, dependency: entry },
    );
  }

  private isSkippableOptionalDependencyError(error: unknown): boolean {
    const skippableCodes = new Set<string>([
      errorCodes.RESOURCE_NOT_FOUND,
      errorCodes.VERSION_NOT_FOUND,
      errorCodes.RESOURCE_ARCHIVED,
    ]);
    return error instanceof HimanError
      && skippableCodes.has(error.code);
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

  private readStringMetadata(
    metadata: Record<string, unknown> | null,
    key: string,
  ): string | undefined {
    const value = metadata?.[key];
    return typeof value === "string" && value.trim() ? value.trim() : undefined;
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
    sourceInfo: LockSourceInfo,
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

    const repoResourceDir = this.getRepoResourceDirFromInfo(sourceInfo, type, name);
    if (await this.exists(repoResourceDir)) {
      return repoResourceDir;
    }

    throw new HimanError(
      errorCodes.RESOURCE_NOT_FOUND,
      `No publish source found for ${type}/${name}. Create resource or switch to dev mode first.`,
    );
  }

  private async tryResolvePublishSourceDir(
    type: ResourceType,
    name: string,
    projectDir: string,
  ): Promise<string | undefined> {
    try {
      const sourceInfo = await this.getLockSourceInfo();
      return await this.resolvePublishSourceDir(type, name, projectDir, sourceInfo);
    } catch (error) {
      if (
        error instanceof HimanError &&
        (error.code === errorCodes.CONFIG_NOT_FOUND ||
          error.code === errorCodes.RESOURCE_NOT_FOUND)
      ) {
        return undefined;
      }
      throw error;
    }
  }

  private getProjectPublishRootCandidates(
    projectDir: string,
    type: ResourceType,
  ): string[] {
    const probeName = "__himan_probe__";
    const roots = new Set<string>([
      path.join(projectDir, ".himan", "dev", type),
    ]);

    for (const agent of getSupportedAgentNames()) {
      for (const candidate of getResourcePathCandidatesForAgent(
        projectDir,
        type,
        probeName,
        agent,
      )) {
        roots.add(path.dirname(candidate));
      }
    }

    return [...roots];
  }

  private getRepoResourceDirFromInfo(
    sourceInfo: LockSourceInfo,
    type: ResourceType,
    name: string,
  ): string {
    const sourceConfig = this.buildSourceConfig(
      sourceInfo.type,
      sourceInfo.repo,
      sourceInfo.repoId,
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
    if (type === "config") return "configs";
    return "skills";
  }

  private getDefaultEntry(type: ResourceType): string {
    if (type === "config") return "config.toml";
    return type === "skill" ? "SKILL.md" : "content.md";
  }

  private getDefaultContent(type: ResourceType, name: string): string {
    if (type === "rule") {
      return `# ${name}\n\nDescribe rule instructions here.\n`;
    }
    if (type === "command") {
      return `# ${name}\n\nDescribe command behavior here.\n`;
    }
    if (type === "config") {
      return [
        "# Codex config resource generated by Himan.",
        "",
        'model = "gpt-5.5"',
        'approval_policy = "on-request"',
        'sandbox_mode = "workspace-write"',
        "",
      ].join("\n");
    }
    return `# ${name}\n\nDescribe skill workflow here.\n`;
  }

  private validateCreateInput(
    type: ResourceType,
    name: string,
    options: CreateOptions,
  ): void {
    if (!["rule", "command", "skill", "config"].includes(type)) {
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

  private validateResourceIdentity(
    type: ResourceType,
    name: string,
    action: string,
  ): void {
    if (!["rule", "command", "skill", "config"].includes(type)) {
      throw new HimanError(
        errorCodes.UNSUPPORTED_RESOURCE_TYPE,
        `Unsupported resource type for ${action}: ${type}`,
      );
    }

    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name)) {
      throw new HimanError(
        errorCodes.INVALID_RESOURCE_NAME,
        `Invalid resource name: ${name}. Use kebab-case only.`,
      );
    }
  }

  private validateResourceScore(score: number): void {
    if (!Number.isInteger(score) || score < 1 || score > 10) {
      throw new HimanError(
        errorCodes.INVALID_INPUT,
        "Resource comment score must be an integer from 1 to 10.",
      );
    }
  }

  private normalizeResourceCommentText(text: string | undefined): string | undefined {
    const trimmed = text?.trim();
    if (!trimmed) return undefined;

    const tokenCount = this.countResourceCommentTextTokens(trimmed);
    if (tokenCount > 64) {
      throw new HimanError(
        errorCodes.INVALID_INPUT,
        "Resource comment text must be at most 64 words or Chinese characters.",
        { tokenCount, limit: 64 },
      );
    }
    return trimmed;
  }

  private countResourceCommentTextTokens(input: string): number {
    const tokens = input.match(/\p{Script=Han}|[\p{Letter}\p{Number}]+/gu);
    return tokens?.length ?? 0;
  }

  private validateRenameInput(
    type: ResourceType,
    oldName: string,
    newName: string,
  ): void {
    if (!["rule", "command", "skill", "config"].includes(type)) {
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

interface MigrateYamlInput {
  name: string;
  type: ResourceType;
  entry: string;
  version: string;
  agents?: string[];
  analysis: ReturnType<typeof buildResourceAnalysisMetadata>;
}

function buildMigrateYaml(
  meta:
    | {
      entry?: string;
      version?: string;
      description?: string;
      category?: string;
      agents?: string[];
      comment?: { score: number; text?: string };
    }
    | undefined,
  input: MigrateYamlInput,
): Record<string, unknown> {
  return {
    name: input.name,
    type: input.type,
    entry: input.entry,
    version: input.version,
    ...(meta?.description ? { description: meta.description } : {}),
    ...(input.agents?.length ? { agents: input.agents } : {}),
    ...(meta?.category ? { category: meta.category } : {}),
    ...(meta?.comment ? { comment: meta.comment } : {}),
    analysis: input.analysis,
  };
}
