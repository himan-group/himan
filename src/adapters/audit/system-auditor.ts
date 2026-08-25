import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import type {
  AuditAgentStats,
  AuditIssue,
  AuditIssueCategory,
  AuditResource,
  AuditResult,
  AuditScope,
  AuditScopeStats,
  AuditStats,
  AuditStatus,
} from "../../domain/audit.js";
import type { ResourceType } from "../../domain/resource.js";
import type {
  InstalledRegistry,
  InstalledRegistryEntry,
  InstalledRegistryStore,
} from "../../state/installed-registry-store.js";
import type { LockResourceEntry, ProjectLock, ProjectLockStore } from "../../state/project-lock-store.js";
import {
  getAgentBaseDirCandidates,
  getSupportedAgentNames,
  normalizeAgent,
  normalizeAgents,
} from "../../utils/agent-configs.js";
import { findMissingLockTargets } from "../../utils/lock-target-check.js";

const RESOURCE_TYPES: ResourceType[] = ["rule", "command", "skill", "config"];
const TYPE_DIRS: Record<ResourceType, string> = {
  rule: "rules",
  command: "commands",
  skill: "skills",
  config: "configs",
};
const DEFAULT_ENTRY: Record<ResourceType, string> = {
  rule: "content.md",
  command: "content.md",
  skill: "SKILL.md",
  config: "config.toml",
};
const ISSUE_CATEGORIES: AuditIssueCategory[] = [
  "duplicate",
  "version-drift",
  "lock-missing-target",
  "lock-modified",
  "unmanaged",
  "orphan-store-cache",
];

export interface SystemAuditOptions {
  projectDir: string;
  homeDir: string;
  scope: "global" | "project" | "all";
  agent?: string;
}

interface ScanParams {
  scope: AuditScope;
  agent: string;
  type: ResourceType;
  name: string;
  resourcePath: string;
  registered?: InstalledRegistryEntry;
  lockEntry?: LockResourceEntry;
}

export class SystemAuditor {
  constructor(
    private readonly deps: {
      registryStore: InstalledRegistryStore;
      lockStore: ProjectLockStore;
    },
  ) {}

  async run(options: SystemAuditOptions): Promise<AuditResult> {
    const registry = await this.deps.registryStore.load();
    const lock = await this.deps.lockStore.load(options.projectDir);
    const scopes: AuditScope[] =
      options.scope === "all" ? ["global", "project"] : [options.scope];
    const agentFilter = options.agent
      ? normalizeAgent(options.agent)
      : undefined;

    const resources: AuditResource[] = [];
    for (const scope of scopes) {
      const rootDir = scope === "global" ? options.homeDir : options.projectDir;
      resources.push(
        ...(await this.scanScope(
          rootDir,
          scope,
          registry,
          lock,
          options.projectDir,
          options.homeDir,
          agentFilter,
        )),
      );
    }

    const issues = await this.buildIssues(
      resources,
      registry,
      lock,
      options.projectDir,
      options.homeDir,
      scopes,
    );
    return {
      resources,
      issues,
      stats: buildStats(resources, issues, scopes),
    };
  }

  private async scanScope(
    rootDir: string,
    scope: AuditScope,
    registry: InstalledRegistry,
    lock: ProjectLock | null,
    projectDir: string,
    homeDir: string,
    agentFilter?: string,
  ): Promise<AuditResource[]> {
    const resources: AuditResource[] = [];
    const agents = getSupportedAgentNames().filter(
      (agent) => !agentFilter || agent === agentFilter,
    );
    for (const agent of agents) {
      const baseDirs = getAgentBaseDirCandidates(agent);
      for (const baseDir of baseDirs) {
        const basePath = path.join(rootDir, baseDir);
        if (!(await this.exists(basePath))) continue;
        for (const type of RESOURCE_TYPES) {
          const typeDir = path.join(basePath, TYPE_DIRS[type]);
          if (!(await this.exists(typeDir))) continue;
          const entries = await fs.readdir(typeDir, { withFileTypes: true });
          for (const entry of entries) {
            if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
            const resourcePath = path.join(typeDir, entry.name);
            if (!(await this.looksLikeResource(resourcePath, type))) continue;
            const registered = this.findRegistryEntry(
              registry,
              scope,
              projectDir,
              agent,
              type,
              entry.name,
              resourcePath,
            );
            const lockEntry =
              scope === "project"
                ? this.findLockEntry(lock, agent, type, entry.name)
                : undefined;
            resources.push(
              await this.classifyResource({
                scope,
                agent,
                type,
                name: entry.name,
                resourcePath,
                registered,
                lockEntry,
              }),
            );
          }
        }
      }
      resources.push(
        ...(await this.scanCopilot(
          rootDir,
          scope,
          agent,
          registry,
          lock,
          projectDir,
          homeDir,
        )),
      );
    }
    return resources;
  }

  /**
   * Copilot stores rules in a merged `.github/copilot-instructions.md` and
   * skills as `.github/prompts/<name>.prompt.md`, so the regular directory
   * scan does not apply. Skills are discovered per file; rules are only
   * tracked through the registry because they cannot be split reliably.
   */
  private async scanCopilot(
    rootDir: string,
    scope: AuditScope,
    agent: string,
    registry: InstalledRegistry,
    lock: ProjectLock | null,
    projectDir: string,
    homeDir: string,
  ): Promise<AuditResource[]> {
    if (agent !== "copilot") return [];
    const basePath = path.join(rootDir, ".github", "copilot");
    if (!(await this.exists(basePath))) return [];

    const resources: AuditResource[] = [];
    const promptsDir = path.join(basePath, "prompts");
    if (await this.exists(promptsDir)) {
      const entries = await fs.readdir(promptsDir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isFile() || !entry.name.endsWith(".prompt.md")) continue;
        const name = entry.name.slice(0, -".prompt.md".length);
        const resourcePath = path.join(promptsDir, entry.name);
        const registered = this.findRegistryEntry(
          registry,
          scope,
          projectDir,
          agent,
          "skill",
          name,
          resourcePath,
        );
        const lockEntry =
          scope === "project"
            ? this.findLockEntry(lock, agent, "skill", name)
            : undefined;
        resources.push(
          await this.classifyResource({
            scope,
            agent,
            type: "skill",
            name,
            resourcePath,
            registered,
            lockEntry,
          }),
        );
      }
    }

    const instructionsPath = path.join(basePath, "copilot-instructions.md");
    if (await this.exists(instructionsPath)) {
      const registeredRules = registry.entries.filter(
        (entry) =>
          entry.scope === scope
          && entry.agent === "copilot"
          && entry.type === "rule"
          && (entry.scope === "global" || entry.projectDir === projectDir)
          && entry.targetPath === instructionsPath,
      );
      for (const entry of registeredRules) {
        resources.push(
          await this.classifyResource({
            scope,
            agent: "copilot",
            type: "rule",
            name: entry.name,
            resourcePath: instructionsPath,
            registered: entry,
          }),
        );
      }
    }
    return resources;
  }

  private async classifyResource(
    params: ScanParams,
  ): Promise<AuditResource> {
    const registration = params.registered
      ?? (params.lockEntry ? lockEntryToRegistration(params.lockEntry) : undefined);
    if (!registration) {
      return {
        scope: params.scope,
        agent: params.agent,
        type: params.type,
        name: params.name,
        status: "unmanaged",
        path: params.resourcePath,
      };
    }

    const status = await this.classifyDrift(
      params.resourcePath,
      registration,
    );
    return {
      scope: params.scope,
      agent: params.agent,
      type: params.type,
      name: params.name,
      version: registration.version,
      source: registration.source,
      status,
      mode: registration.mode,
      path: params.resourcePath,
    };
  }

  private async classifyDrift(
    resourcePath: string,
    registration: InstalledRegistryEntry,
  ): Promise<AuditStatus> {
    const storePath = path.join(
      this.registryHomeDir,
      "store",
      registration.type,
      registration.name,
      registration.version,
    );
    if (!(await this.exists(storePath))) return "drifted";
    if (registration.mode === "link") {
      return (await this.isSymlinkTo(resourcePath, storePath))
        ? "managed"
        : "drifted";
    }
    return (await this.hashMatches(resourcePath, storePath))
      ? "managed"
      : "drifted";
  }

  private get registryHomeDir(): string {
    return path.dirname(this.deps.registryStore.getRegistryPath());
  }

  private async buildIssues(
    resources: AuditResource[],
    registry: InstalledRegistry,
    lock: ProjectLock | null,
    projectDir: string,
    homeDir: string,
    scopes: AuditScope[],
  ): Promise<AuditIssue[]> {
    const issues: AuditIssue[] = [];

    for (const resource of resources) {
      if (resource.status !== "unmanaged") continue;
      issues.push({
        level: "warn",
        category: "unmanaged",
        message: `Unmanaged ${resource.type}/${resource.name} in ${resource.scope} scope.`,
        path: resource.path,
        suggestion:
          "Migrate it with `himan system migrate <path>` or remove it if no longer needed.",
      });
    }

    if (lock && scopes.includes("project")) {
      const missing = await findMissingLockTargets(projectDir, lock);
      for (const target of missing) {
        issues.push({
          level: "error",
          category: "lock-missing-target",
          message: `Locked target missing: ${target.resource}.`,
          path: target.path,
          suggestion: "Run `himan install` to restore locked resources.",
        });
      }
    }

    for (const entry of registry.entries) {
      if (!scopes.includes(entry.scope)) continue;
      if (
        entry.scope === "project"
        && entry.projectDir !== projectDir
      ) {
        continue;
      }
      if (!(await this.exists(entry.targetPath))) {
        issues.push({
          level: "error",
          category: "lock-missing-target",
          message: `Registered target missing: ${entry.type}/${entry.name}@${entry.version}.`,
          path: entry.targetPath,
          suggestion:
            "Reinstall the resource or clean up the stale registry entry.",
        });
        continue;
      }
      const storePath = path.join(
        this.registryHomeDir,
        "store",
        entry.type,
        entry.name,
        entry.version,
      );
      const drifted =
        entry.mode === "link"
          ? !(await this.isSymlinkTo(entry.targetPath, storePath))
          : !(await this.hashMatches(entry.targetPath, storePath));
      if (drifted) {
        issues.push({
          level: "warn",
          category: "lock-modified",
          message: `Registered resource modified: ${entry.type}/${entry.name}@${entry.version}.`,
          path: entry.targetPath,
          suggestion:
            "Reinstall the resource to restore the managed version.",
        });
      }
    }

    const groups = new Map<string, AuditResource[]>();
    for (const resource of resources) {
      const key = `${resource.type}/${resource.name}`;
      const group = groups.get(key) ?? [];
      group.push(resource);
      groups.set(key, group);
    }
    for (const group of groups.values()) {
      if (group.length < 2) continue;
      const versions = new Set(group.map((r) => r.version).filter(Boolean));
      if (versions.size > 1) {
        for (const resource of group) {
          if (!resource.version) continue;
          issues.push({
            level: "warn",
            category: "version-drift",
            message:
              `Version drift: ${resource.type}/${resource.name} installed as `
              + `${resource.version} (${resource.scope}/${resource.agent}).`,
            path: resource.path,
            suggestion:
              `Align versions with \`himan install ${resource.type} `
              + `${resource.name}@<version>\` and remove redundant copies.`,
          });
        }
      } else if (versions.size === 1) {
        for (const resource of group.slice(1)) {
          issues.push({
            level: "warn",
            category: "duplicate",
            message:
              `Duplicate ${resource.type}/${resource.name}@${resource.version} `
              + `across ${resource.scope}/${resource.agent}.`,
            path: resource.path,
            suggestion:
              "Remove redundant copies with `himan system cleanup --dry-run`.",
          });
        }
      }
    }

    issues.push(
      ...(await this.findOrphanStoreIssues(
        registry,
        lock,
        scopes,
        homeDir,
      )),
    );
    return issues;
  }

  private async findOrphanStoreIssues(
    registry: InstalledRegistry,
    lock: ProjectLock | null,
    scopes: AuditScope[],
    homeDir: string,
  ): Promise<AuditIssue[]> {
    const issues: AuditIssue[] = [];
    const storeRoot = path.join(homeDir, ".himan", "store");
    if (!(await this.exists(storeRoot))) return issues;

    for (const type of RESOURCE_TYPES) {
      const typeRoot = path.join(storeRoot, type);
      if (!(await this.exists(typeRoot))) continue;
      const names = await fs.readdir(typeRoot, { withFileTypes: true });
      for (const nameEntry of names) {
        if (!nameEntry.isDirectory()) continue;
        const nameDir = path.join(typeRoot, nameEntry.name);
        const versions = await fs.readdir(nameDir, { withFileTypes: true });
        for (const versionEntry of versions) {
          if (!versionEntry.isDirectory()) continue;
          const version = versionEntry.name;
          const storePath = path.join(nameDir, version);
          const referenced =
            registry.entries.some(
              (entry) =>
                scopes.includes(entry.scope)
                && entry.type === type
                && entry.name === nameEntry.name
                && entry.version === version,
            )
            || (lock?.resources.some(
              (resource) =>
                resource.type === type
                && resource.name === nameEntry.name
                && resource.version === version,
            ) ?? false);
          if (referenced) continue;
          issues.push({
            level: "warn",
            category: "orphan-store-cache",
            message:
              `Orphan store cache: ${type}/${nameEntry.name}@${version} is not referenced by any install.`,
            path: storePath,
            suggestion:
              "Preview removal with `himan system cleanup --dry-run`.",
          });
        }
      }
    }
    return issues;
  }

  private findRegistryEntry(
    registry: InstalledRegistry,
    scope: AuditScope,
    projectDir: string,
    agent: string,
    type: ResourceType,
    name: string,
    resourcePath: string,
  ): InstalledRegistryEntry | undefined {
    const candidates = registry.entries.filter(
      (entry) =>
        entry.scope === scope
        && entry.agent === agent
        && entry.type === type
        && entry.name === name
        && (entry.scope === "global" || entry.projectDir === projectDir),
    );
    return (
      candidates.find((entry) => entry.targetPath === resourcePath)
      ?? candidates[0]
    );
  }

  private findLockEntry(
    lock: ProjectLock | null,
    agent: string,
    type: ResourceType,
    name: string,
  ): LockResourceEntry | undefined {
    return lock?.resources.find(
      (resource) =>
        resource.type === type
        && resource.name === name
        && (!resource.agents?.length
          || (normalizeAgents(resource.agents) as string[]).includes(agent)),
    );
  }

  private async looksLikeResource(
    resourcePath: string,
    type: ResourceType,
  ): Promise<boolean> {
    if (await this.exists(path.join(resourcePath, "himan.yaml"))) return true;
    return this.exists(path.join(resourcePath, DEFAULT_ENTRY[type]));
  }

  private async hashMatches(dirA: string, dirB: string): Promise<boolean> {
    if (!(await this.exists(dirA)) || !(await this.exists(dirB))) return false;
    const [hashA, hashB] = await Promise.all([
      hashDirectory(dirA),
      hashDirectory(dirB),
    ]);
    return hashA === hashB;
  }

  private async isSymlinkTo(targetPath: string, storePath: string): Promise<boolean> {
    try {
      const stat = await fs.lstat(targetPath);
      if (!stat.isSymbolicLink()) return false;
      const resolved = await fs.realpath(targetPath);
      return resolved === (await fs.realpath(storePath));
    } catch {
      return false;
    }
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

function lockEntryToRegistration(
  entry: LockResourceEntry,
): InstalledRegistryEntry {
  return {
    scope: "project",
    agent: normalizeAgents(entry.agents)[0],
    type: entry.type,
    name: entry.name,
    version: entry.version,
    source: entry.source,
    mode: entry.mode ?? "copy",
    targetPath: "",
    updatedAt: entry.updatedAt,
  };
}

function buildStats(
  resources: AuditResource[],
  issues: AuditIssue[],
  scopes: AuditScope[],
): AuditStats {
  const emptyScopeStats = (): AuditScopeStats => ({
    resources: 0,
    byType: { rule: 0, command: 0, skill: 0, config: 0 },
    managed: 0,
    unmanaged: 0,
    drifted: 0,
  });
  const scopeStats: Record<AuditScope, AuditScopeStats> = {
    global: emptyScopeStats(),
    project: emptyScopeStats(),
  };
  for (const scope of scopes) {
    const scopeResources = resources.filter((resource) => resource.scope === scope);
    for (const resource of scopeResources) {
      scopeStats[scope].resources += 1;
      scopeStats[scope].byType[resource.type] += 1;
      if (resource.status === "managed") scopeStats[scope].managed += 1;
      else if (resource.status === "unmanaged") scopeStats[scope].unmanaged += 1;
      else scopeStats[scope].drifted += 1;
    }
  }

  const agentTotals = new Map<
    string,
    { resources: number; byType: Record<ResourceType, number> }
  >();
  for (const resource of resources) {
    const total = agentTotals.get(resource.agent) ?? {
      resources: 0,
      byType: { rule: 0, command: 0, skill: 0, config: 0 },
    };
    total.resources += 1;
    total.byType[resource.type] += 1;
    agentTotals.set(resource.agent, total);
  }
  const agents: AuditAgentStats[] = [...agentTotals.entries()].map(
    ([agent, total]) => ({ agent, ...total }),
  );

  const issueCounts = Object.fromEntries(
    ISSUE_CATEGORIES.map((category) => [category, 0]),
  ) as Record<AuditIssueCategory, number>;
  for (const issue of issues) {
    issueCounts[issue.category] += 1;
  }

  return {
    agents,
    scopes: scopeStats,
    totals: {
      resources: resources.length,
      managed: resources.filter((resource) => resource.status === "managed").length,
      unmanaged: resources.filter((resource) => resource.status === "unmanaged").length,
      drifted: resources.filter((resource) => resource.status === "drifted").length,
    },
    issues: issueCounts,
  };
}

async function hashDirectory(dirPath: string): Promise<string> {
  const hash = createHash("sha256");
  const files: string[] = [];
  await collectFiles(dirPath, files);
  for (const file of [...files].sort()) {
    const content = await fs.readFile(file);
    hash.update(path.relative(dirPath, file));
    hash.update("\0");
    hash.update(content);
    hash.update("\0");
  }
  return `sha256:${hash.digest("hex")}`;
}

async function collectFiles(dirPath: string, files: string[]): Promise<void> {
  const entries = await fs.readdir(dirPath, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      await collectFiles(fullPath, files);
    } else if (entry.isFile() || entry.isSymbolicLink()) {
      files.push(fullPath);
    }
  }
}
