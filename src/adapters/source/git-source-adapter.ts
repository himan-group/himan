import type {
  ArchiveOptions,
  ArchiveResult,
  CreateOptions,
  CreateResult,
  PublishResult,
  RenameOptions,
  RenameResult,
  ResourceListOptions,
  ResourceMeta,
  ResourceType,
  RestoreOptions,
  RestoreResult,
  VersionInfo,
} from "../../domain/resource.js";
import type {
  SourceDocsFileResult,
  SourceDocsOptions,
  SourceDocsResult,
} from "../../domain/source-docs.js";
import type {
  ResourceSourceAdapter,
  SourceConfig,
} from "./resource-source-adapter.js";
import type {
  GitSourceCloneResult,
  GitSourceSyncResult,
  SourceCloneOptions,
  SourceSyncOptions,
  SourceSyncResource,
} from "../../domain/source-transfer.js";
import { RepoManager } from "../git/repo-manager.js";
import { ResourceScanner } from "../resource/resource-scanner.js";
import { buildResourceAnalysisMetadata } from "../resource/resource-analysis.js";
import semver from "semver";
import { HimanError, errorCodes } from "../../utils/errors.js";
import { promises as fs } from "node:fs";
import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";
import YAML from "yaml";
import { IndexCacheStore } from "../../state/index-cache-store.js";

type PublishMetadata = Record<string, unknown> & {
  name: string;
  type: ResourceType;
  entry: string;
};

interface PublishMetadataResult {
  metadata: PublishMetadata;
  shouldWriteMetadata: boolean;
}

const RESOURCE_TYPES: ResourceType[] = ["rule", "command", "skill"];
const README_RESOURCES_START = "<!-- himan:resources:start -->";
const README_RESOURCES_END = "<!-- himan:resources:end -->";

type ChangelogSection = "Added" | "Changed" | "Deprecated" | "Removed";

interface ChangelogEntry {
  section: ChangelogSection;
  line: string;
}

interface ResourceDocsItem {
  name: string;
  type: ResourceType;
  description?: string;
}

export class GitSourceAdapter implements ResourceSourceAdapter {
  private readonly repoManager = new RepoManager();
  private readonly scanner = new ResourceScanner();
  private readonly indexStore = new IndexCacheStore();
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

  async list(
    type: ResourceType,
    options: ResourceListOptions = {},
  ): Promise<ResourceMeta[]> {
    const repoDir = this.getRepoDir();
    if (options.archived) {
      return this.scanner.scanByType(repoDir, type, { archived: true });
    }

    const repoId = this.sourceConfig?.repoId ?? "default";
    const typeDir = this.getTypeDir(type);
    const baseDir = path.join(repoDir, typeDir);
    const metadataHash = await this.getResourceMetadataHash(baseDir, type);

    const cached = await this.indexStore.get(repoId, type);
    let active: ResourceMeta[];
    if (cached && cached.metadataHash === metadataHash) {
      active = cached.resources;
    } else {
      active = await this.scanner.scanByType(repoDir, type);
      await this.indexStore.upsert(repoId, type, metadataHash, active);
    }

    if (!options.includeArchived) {
      return active;
    }

    const archived = await this.scanner.scanByType(repoDir, type, {
      archived: true,
    });
    return [...active, ...archived].sort((a, b) => a.name.localeCompare(b.name));
  }

  async history(type: ResourceType, name: string): Promise<VersionInfo[]> {
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

  async isArchived(type: ResourceType, name: string): Promise<boolean> {
    return this.exists(path.join(this.getRepoDir(), "archive", this.getTypeDir(type), name));
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
    type: ResourceType,
    name: string,
    version: string,
    sourceDir: string,
  ): Promise<PublishResult> {
    const repoDir = this.getRepoDir();
    const targetDir = path.join(repoDir, `${type}s`, name);
    const metadataResult = await this.validatePublishResource(type, name, sourceDir);
    await this.ensurePublishHasContentChanges(type, name, sourceDir);
    const sameDir = await this.isSameDirectory(sourceDir, targetDir);
    if (!sameDir) {
      await fs.rm(targetDir, { recursive: true, force: true });
      await fs.mkdir(path.dirname(targetDir), { recursive: true });
      await fs.cp(sourceDir, targetDir, { recursive: true });
    }

    if (metadataResult.shouldWriteMetadata) {
      const yamlPath = path.join(targetDir, "himan.yaml");
      const metadata = { ...metadataResult.metadata, version };
      await fs.writeFile(yamlPath, YAML.stringify(metadata), "utf8");
    }

    const docsPaths = await this.maintainSourceDocs(
      repoDir,
      {
        section: "Changed",
        line: `- Published \`${type}/${name}@${version}\`.`,
      },
      new Map([[this.getResourceVersionOverrideKey(type, name), version]]),
    );
    const tag = `${type}/${name}@${version}`;
    await this.repoManager.commitTagAndPush(
      repoDir,
      `publish ${type}/${name}@${version}`,
      tag,
      undefined,
      [
        path.relative(repoDir, targetDir),
        ...docsPaths.map((docPath) => path.relative(repoDir, docPath)),
      ],
    );
    return { version, tag };
  }

  async create(
    type: ResourceType,
    name: string,
    options: CreateOptions,
  ): Promise<CreateResult> {
    const repoDir = this.getRepoDir();
    const resourceDir = path.join(repoDir, this.getTypeDir(type), name);
    const entry = options.entry ?? this.getDefaultEntry(type);
    const agents = options.agents?.length ? options.agents : ["cursor"];
    const resourceExists = await this.exists(resourceDir);

    if (resourceExists && !options.force) {
      throw new HimanError(
        errorCodes.RESOURCE_EXISTS,
        `Resource already exists: ${type}/${name}`,
      );
    }

    const entryContent = this.getDefaultContent(type, name);
    const files = [path.join(resourceDir, "himan.yaml"), path.join(resourceDir, entry)];
    if (!options.dryRun) {
      await fs.rm(resourceDir, { recursive: true, force: true });
      await fs.mkdir(resourceDir, { recursive: true });
      await fs.writeFile(
        path.join(resourceDir, "himan.yaml"),
        YAML.stringify(
          this.buildCreateResourceMetadata(
            type,
            name,
            entry,
            entryContent,
            options.description ?? `${type} resource ${name}`,
            agents,
          ),
        ),
        "utf8",
      );
      await fs.writeFile(path.join(resourceDir, entry), entryContent, "utf8");
      await this.maintainSourceDocs(repoDir, {
        section: resourceExists ? "Changed" : "Added",
        line: resourceExists
          ? `- Updated \`${type}/${name}\`.`
          : `- Added \`${type}/${name}\`.`,
      });
    }

    return {
      type,
      name,
      resourceDir,
      files,
      dryRun: Boolean(options.dryRun),
    };
  }

  async rename(
    type: ResourceType,
    oldName: string,
    newName: string,
    options: RenameOptions = {},
  ): Promise<RenameResult> {
    const repoDir = this.getRepoDir();
    const typeDir = this.getTypeDir(type);
    const previousResourceDir = path.join(repoDir, typeDir, oldName);
    const resourceDir = path.join(repoDir, typeDir, newName);

    if (!(await this.exists(previousResourceDir))) {
      throw new HimanError(
        errorCodes.RESOURCE_NOT_FOUND,
        `Resource not found: ${type}/${oldName}`,
      );
    }
    await this.ensureRenameTargetAvailable(repoDir, type, newName, resourceDir);

    const history = await this.history(type, oldName);
    const latestVersion = history[0]?.version;
    const tag = latestVersion ? `${type}/${newName}@${latestVersion}` : undefined;

    if (options.dryRun) {
      return {
        type,
        oldName,
        newName,
        previousResourceDir,
        resourceDir,
        latestVersion,
        tag,
        committed: false,
        dryRun: true,
      };
    }

    await fs.mkdir(path.dirname(resourceDir), { recursive: true });
    await fs.rename(previousResourceDir, resourceDir);
    await this.updateRenamedResourceMetadata(resourceDir, type, oldName, newName);

    const versionOverrides = latestVersion
      ? new Map([[this.getResourceVersionOverrideKey(type, newName), latestVersion]])
      : new Map<string, string>();
    const docsPaths = await this.maintainSourceDocs(
      repoDir,
      {
        section: "Changed",
        line: `- Renamed \`${type}/${oldName}\` to \`${type}/${newName}\`.`,
      },
      versionOverrides,
    );
    const changedPaths = [
      path.relative(repoDir, previousResourceDir),
      path.relative(repoDir, resourceDir),
      ...docsPaths.map((docPath) => path.relative(repoDir, docPath)),
    ];

    if (tag) {
      await this.repoManager.commitTagAndPush(
        repoDir,
        `rename ${type}/${oldName} to ${type}/${newName}`,
        tag,
        undefined,
        changedPaths,
      );
      return {
        type,
        oldName,
        newName,
        previousResourceDir,
        resourceDir,
        latestVersion,
        tag,
        committed: true,
        dryRun: false,
      };
    }

    const committed = await this.repoManager.commitAndPush(
      repoDir,
      `rename ${type}/${oldName} to ${type}/${newName}`,
      undefined,
      changedPaths,
    );
    return {
      type,
      oldName,
      newName,
      previousResourceDir,
      resourceDir,
      latestVersion,
      tag,
      committed,
      dryRun: false,
    };
  }

  async archive(
    type: ResourceType,
    name: string,
    options: ArchiveOptions = {},
  ): Promise<ArchiveResult> {
    const repoDir = this.getRepoDir();
    const typeDir = this.getTypeDir(type);
    const previousResourceDir = path.join(repoDir, typeDir, name);
    const archiveDir = path.join(repoDir, "archive", typeDir, name);
    const archiveReason = this.normalizeArchiveReason(options.reason);
    const archivedAt = new Date().toISOString();

    if (!(await this.exists(previousResourceDir))) {
      if (await this.exists(archiveDir)) {
        throw new HimanError(
          errorCodes.RESOURCE_ARCHIVED,
          `Resource already archived: ${type}/${name}`,
        );
      }
      throw new HimanError(
        errorCodes.RESOURCE_NOT_FOUND,
        `Resource not found: ${type}/${name}`,
      );
    }
    if (await this.exists(archiveDir)) {
      throw new HimanError(
        errorCodes.RESOURCE_EXISTS,
        `Archived resource already exists: ${type}/${name}`,
      );
    }

    if (options.dryRun) {
      return {
        type,
        name,
        previousResourceDir,
        archiveDir,
        archivedAt,
        archiveReason,
        committed: false,
        dryRun: true,
      };
    }

    await this.markArchivedResourceMetadata(
      previousResourceDir,
      type,
      name,
      archivedAt,
      archiveReason,
    );
    await fs.mkdir(path.dirname(archiveDir), { recursive: true });
    await fs.rename(previousResourceDir, archiveDir);

    const docsPaths = await this.maintainSourceDocs(repoDir, {
      section: "Deprecated",
      line: archiveReason
        ? `- Archived \`${type}/${name}\`: ${archiveReason}.`
        : `- Archived \`${type}/${name}\`.`,
    });
    const committed = await this.repoManager.commitAndPush(
      repoDir,
      `archive ${type}/${name}`,
      undefined,
      [
        path.relative(repoDir, previousResourceDir),
        path.relative(repoDir, archiveDir),
        ...docsPaths.map((docPath) => path.relative(repoDir, docPath)),
      ],
    );

    return {
      type,
      name,
      previousResourceDir,
      archiveDir,
      archivedAt,
      archiveReason,
      committed,
      dryRun: false,
    };
  }

  async restore(
    type: ResourceType,
    name: string,
    options: RestoreOptions = {},
  ): Promise<RestoreResult> {
    const repoDir = this.getRepoDir();
    const typeDir = this.getTypeDir(type);
    const previousArchiveDir = path.join(repoDir, "archive", typeDir, name);
    const resourceDir = path.join(repoDir, typeDir, name);

    if (!(await this.exists(previousArchiveDir))) {
      throw new HimanError(
        errorCodes.RESOURCE_NOT_FOUND,
        `Archived resource not found: ${type}/${name}`,
      );
    }
    if (await this.exists(resourceDir)) {
      throw new HimanError(
        errorCodes.RESOURCE_EXISTS,
        `Resource already exists: ${type}/${name}`,
      );
    }

    if (options.dryRun) {
      return {
        type,
        name,
        previousArchiveDir,
        resourceDir,
        committed: false,
        dryRun: true,
      };
    }

    await this.clearArchivedResourceMetadata(previousArchiveDir, type, name);
    await fs.mkdir(path.dirname(resourceDir), { recursive: true });
    await fs.rename(previousArchiveDir, resourceDir);

    const docsPaths = await this.maintainSourceDocs(repoDir, {
      section: "Changed",
      line: `- Restored \`${type}/${name}\` from archive.`,
    });
    const committed = await this.repoManager.commitAndPush(
      repoDir,
      `restore ${type}/${name}`,
      undefined,
      [
        path.relative(repoDir, previousArchiveDir),
        path.relative(repoDir, resourceDir),
        ...docsPaths.map((docPath) => path.relative(repoDir, docPath)),
      ],
    );

    return {
      type,
      name,
      previousArchiveDir,
      resourceDir,
      committed,
      dryRun: false,
    };
  }

  async initDocs(options: SourceDocsOptions = {}): Promise<SourceDocsResult> {
    const repoDir = this.getRepoDir();
    const files = [
      {
        path: path.join(repoDir, "README.md"),
        content: await this.buildReadmeContent(repoDir),
      },
      {
        path: path.join(repoDir, "CHANGELOG.md"),
        content: await this.buildChangelogContent(repoDir),
      },
    ];
    const results: SourceDocsFileResult[] = [];
    const changedPaths: string[] = [];

    for (const file of files) {
      const exists = await this.exists(file.path);
      const action = exists ? (options.force ? "updated" : "skipped") : "created";
      const reason = action === "skipped" ? "file already exists" : undefined;
      results.push({ path: file.path, action, reason });

      if (!options.dryRun && action !== "skipped") {
        await fs.writeFile(file.path, file.content, "utf8");
        changedPaths.push(path.relative(repoDir, file.path));
      }
    }

    const committed =
      !options.dryRun &&
      changedPaths.length > 0 &&
      (await this.repoManager.commitAndPush(
        repoDir,
        "docs: init source docs",
        undefined,
        changedPaths,
      ));

    return {
      sourceDir: repoDir,
      files: results,
      dryRun: Boolean(options.dryRun),
      committed,
    };
  }

  async cloneTo(
    targetRepo: string,
    options: SourceCloneOptions = {},
  ): Promise<GitSourceCloneResult> {
    return this.repoManager.cloneManagedSourceRefs(
      this.getRepoDir(),
      targetRepo,
      options,
    );
  }

  async syncLatestTo(
    targetRepo: string,
    options: SourceSyncOptions = {},
  ): Promise<GitSourceSyncResult> {
    const resources = await this.collectLatestVersionedResources();
    return this.repoManager.syncLatestSourceSnapshot(
      this.getRepoDir(),
      targetRepo,
      resources,
      options,
    );
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

  private async exists(targetPath: string): Promise<boolean> {
    try {
      await fs.access(targetPath);
      return true;
    } catch {
      return false;
    }
  }

  private async isSameDirectory(a: string, b: string): Promise<boolean> {
    try {
      const [ra, rb] = await Promise.all([fs.realpath(a), fs.realpath(b)]);
      return ra === rb;
    } catch {
      return false;
    }
  }

  private async ensureRenameTargetAvailable(
    repoDir: string,
    type: ResourceType,
    newName: string,
    resourceDir: string,
  ): Promise<void> {
    if (await this.exists(resourceDir)) {
      throw new HimanError(
        errorCodes.RESOURCE_EXISTS,
        `Resource already exists: ${type}/${newName}`,
      );
    }

    const [resources, history] = await Promise.all([
      this.scanner.scanByType(repoDir, type),
      this.history(type, newName),
    ]);
    if (resources.some((resource) => resource.name === newName) || history.length > 0) {
      throw new HimanError(
        errorCodes.RESOURCE_EXISTS,
        `Resource already exists: ${type}/${newName}`,
      );
    }
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
      let parsed: unknown;
      try {
        parsed = YAML.parse(raw);
      } catch (error) {
        throw this.invalidResourceMetadata(
          type,
          oldName,
          "himan.yaml is not valid YAML.",
          { yamlPath, reason: error instanceof Error ? error.message : String(error) },
        );
      }
      if (!this.isRecord(parsed)) {
        throw this.invalidResourceMetadata(
          type,
          oldName,
          "himan.yaml must be an object.",
          { yamlPath },
        );
      }
      await fs.writeFile(
        yamlPath,
        YAML.stringify({
          ...parsed,
          name: newName,
        }),
        "utf8",
      );
      return;
    }

    if (type !== "skill") return;
    await this.updateSkillFrontMatterName(
      path.join(resourceDir, this.getDefaultEntry(type)),
      oldName,
      newName,
    );
  }

  private async updateSkillFrontMatterName(
    skillPath: string,
    oldName: string,
    newName: string,
  ): Promise<void> {
    if (!(await this.exists(skillPath))) return;

    const raw = await fs.readFile(skillPath, "utf8");
    const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(raw);
    if (!match) return;

    let parsed: unknown;
    try {
      parsed = YAML.parse(match[1]);
    } catch {
      return;
    }
    if (!this.isRecord(parsed) || parsed.name !== oldName) return;

    const frontMatter = YAML.stringify({
      ...parsed,
      name: newName,
    }).trimEnd();
    const updated = `---\n${frontMatter}\n---\n${raw.slice(match[0].length)}`;
    await fs.writeFile(skillPath, updated, "utf8");
  }

  private normalizeArchiveReason(reason: string | undefined): string | undefined {
    const trimmed = reason?.trim();
    return trimmed ? trimmed : undefined;
  }

  private async markArchivedResourceMetadata(
    resourceDir: string,
    type: ResourceType,
    name: string,
    archivedAt: string,
    archiveReason: string | undefined,
  ): Promise<void> {
    const yamlPath = path.join(resourceDir, "himan.yaml");
    if (!(await this.exists(yamlPath))) return;

    const parsed = await this.readResourceYamlObject(yamlPath, type, name);
    await fs.writeFile(
      yamlPath,
      YAML.stringify({
        ...parsed,
        archived: true,
        archivedAt,
        ...(archiveReason ? { archiveReason } : {}),
      }),
      "utf8",
    );
  }

  private async clearArchivedResourceMetadata(
    resourceDir: string,
    type: ResourceType,
    name: string,
  ): Promise<void> {
    const yamlPath = path.join(resourceDir, "himan.yaml");
    if (!(await this.exists(yamlPath))) return;

    const parsed = await this.readResourceYamlObject(yamlPath, type, name);
    const {
      archived: _archived,
      archivedAt: _archivedAt,
      archiveReason: _archiveReason,
      ...rest
    } = parsed;
    await fs.writeFile(yamlPath, YAML.stringify(rest), "utf8");
  }

  private async readResourceYamlObject(
    yamlPath: string,
    type: ResourceType,
    name: string,
  ): Promise<Record<string, unknown>> {
    const raw = await fs.readFile(yamlPath, "utf8");
    let parsed: unknown;
    try {
      parsed = YAML.parse(raw);
    } catch (error) {
      throw this.invalidResourceMetadata(
        type,
        name,
        "himan.yaml is not valid YAML.",
        { yamlPath, reason: error instanceof Error ? error.message : String(error) },
      );
    }
    if (!this.isRecord(parsed)) {
      throw this.invalidResourceMetadata(
        type,
        name,
        "himan.yaml must be an object.",
        { yamlPath },
      );
    }
    return parsed;
  }

  private async validatePublishResource(
    type: ResourceType,
    name: string,
    resourceDir: string,
  ): Promise<PublishMetadataResult> {
    const yamlPath = path.join(resourceDir, "himan.yaml");
    if (!(await this.exists(yamlPath))) {
      return {
        metadata: await this.inferPublishResourceMetadata(type, name, resourceDir),
        shouldWriteMetadata: false,
      };
    }

    const raw = await fs.readFile(yamlPath, "utf8");
    let parsed: unknown;
    try {
      parsed = YAML.parse(raw);
    } catch (error) {
      throw this.invalidResourceMetadata(
        type,
        name,
        "himan.yaml is not valid YAML.",
        { yamlPath, reason: error instanceof Error ? error.message : String(error) },
      );
    }

    if (!this.isRecord(parsed)) {
      throw this.invalidResourceMetadata(
        type,
        name,
        "himan.yaml must be an object.",
        { yamlPath },
      );
    }
    if (parsed.name !== name) {
      throw this.invalidResourceMetadata(
        type,
        name,
        `himan.yaml name must be "${name}".`,
        { yamlPath, actual: parsed.name },
      );
    }
    if (parsed.type !== type) {
      throw this.invalidResourceMetadata(
        type,
        name,
        `himan.yaml type must be "${type}".`,
        { yamlPath, actual: parsed.type },
      );
    }
    if (typeof parsed.entry !== "string" || parsed.entry.trim().length === 0) {
      throw this.invalidResourceMetadata(
        type,
        name,
        "himan.yaml entry is required.",
        { yamlPath },
      );
    }

    const entry = parsed.entry.trim();
    const entryPath = path.resolve(resourceDir, entry);
    const resourceRoot = path.resolve(resourceDir);
    const relativeEntryPath = path.relative(resourceRoot, entryPath);
    if (
      path.isAbsolute(entry) ||
      relativeEntryPath === "" ||
      relativeEntryPath.startsWith("..") ||
      path.isAbsolute(relativeEntryPath)
    ) {
      throw this.invalidResourceMetadata(
        type,
        name,
        "himan.yaml entry must point to a file inside the resource directory.",
        { yamlPath, entry },
      );
    }

    let entryStat;
    try {
      entryStat = await fs.stat(entryPath);
    } catch (error) {
      if (!this.isNotFoundError(error)) {
        throw error;
      }
      throw this.invalidResourceMetadata(
        type,
        name,
        `Resource entry file not found: ${entry}`,
        { yamlPath, entry, entryPath },
      );
    }
    if (!entryStat.isFile()) {
      throw this.invalidResourceMetadata(
        type,
        name,
        `Resource entry is not a file: ${entry}`,
        { yamlPath, entry, entryPath },
      );
    }

    return {
      metadata: {
        ...parsed,
        name,
        type,
        entry,
      },
      shouldWriteMetadata: true,
    };
  }

  private async inferPublishResourceMetadata(
    type: ResourceType,
    name: string,
    resourceDir: string,
  ): Promise<PublishMetadata> {
    const entry = this.getDefaultEntry(type);
    const entryPath = path.join(resourceDir, entry);
    let entryStat;
    try {
      entryStat = await fs.stat(entryPath);
    } catch (error) {
      if (!this.isNotFoundError(error)) {
        throw error;
      }
      throw this.invalidResourceMetadata(
        type,
        name,
        `Missing himan.yaml and default entry file for publish: ${entry}`,
        { yamlPath: path.join(resourceDir, "himan.yaml"), entry, entryPath },
      );
    }
    if (!entryStat.isFile()) {
      throw this.invalidResourceMetadata(
        type,
        name,
        `Default resource entry is not a file: ${entry}`,
        { entry, entryPath },
      );
    }

    const frontMatter =
      type === "skill" ? await this.readSkillFrontMatter(entryPath) : null;
    const metadata: PublishMetadata = {
      name,
      type,
      entry,
    };
    const description = this.readStringMetadata(frontMatter, "description");
    if (description) metadata.description = description;
    const agents =
      this.readStringArrayMetadata(frontMatter, "agents") ??
      this.readStringArrayMetadata(frontMatter, "targets");
    if (agents) metadata.agents = agents;
    return metadata;
  }

  private async ensurePublishHasContentChanges(
    type: ResourceType,
    name: string,
    sourceDir: string,
  ): Promise<void> {
    const latest = (await this.history(type, name))[0];
    if (!latest) return;

    const previousDir = await fs.mkdtemp(path.join(os.tmpdir(), "himan-publish-"));
    try {
      await this.repoManager.archiveResource(
        this.getRepoDir(),
        latest.raw,
        `${type}s/${name}`,
        previousDir,
      );
      const [nextSnapshot, previousSnapshot] = await Promise.all([
        this.readComparableResourceSnapshot(sourceDir),
        this.readComparableResourceSnapshot(previousDir),
      ]);
      if (this.resourceSnapshotsEqual(nextSnapshot, previousSnapshot)) {
        throw new HimanError(
          errorCodes.PUBLISH_NO_CHANGES,
          `No changes to publish for ${type}/${name}.`,
        );
      }
    } finally {
      await fs.rm(previousDir, { recursive: true, force: true });
    }
  }

  private async readComparableResourceSnapshot(
    resourceDir: string,
  ): Promise<Map<string, string>> {
    const files = await this.listResourceFiles(resourceDir);
    const snapshot = new Map<string, string>();

    for (const file of files) {
      const relative = this.toPosixPath(path.relative(resourceDir, file));
      const content = await fs.readFile(file, "utf8");
      snapshot.set(
        relative,
        relative === "himan.yaml"
          ? this.normalizeComparableResourceMetadata(content)
          : content,
      );
    }

    return snapshot;
  }

  private async listResourceFiles(resourceDir: string): Promise<string[]> {
    const result: string[] = [];
    const entries = await fs.readdir(resourceDir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(resourceDir, entry.name);
      if (entry.isDirectory()) {
        result.push(...(await this.listResourceFiles(fullPath)));
      } else if (entry.isFile()) {
        result.push(fullPath);
      }
    }

    return result.sort((a, b) => a.localeCompare(b));
  }

  private normalizeComparableResourceMetadata(content: string): string {
    try {
      const parsed = YAML.parse(content) as unknown;
      if (!this.isRecord(parsed)) return content;
      const normalized = { ...parsed };
      delete normalized.version;
      return YAML.stringify(normalized);
    } catch {
      return content;
    }
  }

  private resourceSnapshotsEqual(
    a: Map<string, string>,
    b: Map<string, string>,
  ): boolean {
    if (a.size !== b.size) return false;
    for (const [file, content] of a) {
      if (b.get(file) !== content) return false;
    }
    return true;
  }

  private toPosixPath(filePath: string): string {
    return filePath.split(path.sep).join("/");
  }

  private invalidResourceMetadata(
    type: ResourceType,
    name: string,
    message: string,
    details: Record<string, unknown>,
  ): HimanError {
    return new HimanError(
      errorCodes.INVALID_RESOURCE_METADATA,
      `Invalid metadata for ${type}/${name}: ${message}`,
      details,
    );
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
  }

  private getTypeDir(type: ResourceType): string {
    if (type === "rule") return "rules";
    if (type === "command") return "commands";
    return "skills";
  }

  private async getResourceMetadataHash(
    baseDir: string,
    type: ResourceType,
  ): Promise<string> {
    const hash = createHash("sha256");
    hash.update("himan-resource-index-v1");

    if (!(await this.exists(baseDir))) {
      hash.update("\0missing");
      return hash.digest("hex");
    }

    const entries = await fs.readdir(baseDir, { withFileTypes: true });
    const resourceDirNames = entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();

    for (const resourceDirName of resourceDirNames) {
      hash.update("\0dir:");
      hash.update(resourceDirName);

      const yamlPath = path.join(baseDir, resourceDirName, "himan.yaml");
      try {
        const raw = await fs.readFile(yamlPath);
        hash.update("\0yaml:");
        hash.update(raw);
      } catch (error) {
        if (!this.isNotFoundError(error)) {
          throw error;
        }
        hash.update("\0yaml-missing");
        const entryPath = path.join(baseDir, resourceDirName, this.getDefaultEntry(type));
        try {
          const raw = await fs.readFile(entryPath);
          hash.update("\0entry:");
          hash.update(raw);
        } catch (entryError) {
          if (!this.isNotFoundError(entryError)) {
            throw entryError;
          }
          hash.update("\0entry-missing");
        }
      }
    }

    return hash.digest("hex");
  }

  private isNotFoundError(error: unknown): boolean {
    return (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      (error as NodeJS.ErrnoException).code === "ENOENT"
    );
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

  private buildCreateResourceMetadata(
    type: ResourceType,
    name: string,
    entry: string,
    entryContent: string,
    description: string,
    agents: string[],
  ): PublishMetadata {
    const metadata: PublishMetadata = {
      name,
      type,
      version: "0.1.0",
      entry,
      description,
      agents,
    };

    if (type === "skill") {
      metadata.analysis = buildResourceAnalysisMetadata({
        entry,
        entryContent,
        measuredBy: "himan",
        generatedBy: "himan",
      });
    }

    return metadata;
  }

  private async buildReadmeContent(
    repoDir: string,
    versionOverrides = new Map<string, string>(),
  ): Promise<string> {
    const resourceLines = await this.buildResourceIndex(repoDir, versionOverrides);
    const repo = this.sourceConfig?.repo ?? "<git_url>";
    return [
      `# ${this.getSourceTitle()}`,
      "",
      "Himan source repository for reusable agent resources.",
      "",
      "## Resources",
      "",
      README_RESOURCES_START,
      ...resourceLines,
      README_RESOURCES_END,
      "",
      "## Usage",
      "",
      "```bash",
      `himan source add team ${repo} --alias team`,
      "himan source alias default primary  # only needed when current default has no alias",
      "himan source use team",
      "himan list rule",
      "himan install rule <name>",
      "```",
      "",
      "## Maintenance",
      "",
      "- Add resources with `himan create <type> <name>`.",
      "- Publish resource versions with `himan publish <type> <name>`.",
      "- Record source-level changes in `CHANGELOG.md`.",
      "- Resource versions are tracked by Git tags such as `rule/code-review@1.0.0`.",
      "",
    ].join("\n");
  }

  private async buildChangelogContent(repoDir: string): Promise<string> {
    const resourceLines = await this.buildExistingResourceChangelogLines(repoDir);
    return [
      "# Changelog",
      "",
      "All notable source-level resource changes are documented in this file.",
      "",
      "## [Unreleased]",
      "",
      "### Added",
      "",
      "- Initial source README/CHANGELOG scaffold.",
      ...resourceLines,
      "",
    ].join("\n");
  }

  private async buildResourceIndex(
    repoDir: string,
    versionOverrides = new Map<string, string>(),
  ): Promise<string[]> {
    const sections: string[] = [];
    for (const type of RESOURCE_TYPES) {
      const resources = await this.collectResourceDocsItems(repoDir, type);
      sections.push(`### ${this.getTypeLabel(type)}`, "");
      if (resources.length === 0) {
        sections.push(`- No ${type} resources yet.`, "");
        continue;
      }
      for (const resource of resources) {
        const ref = await this.getResourceRef(
          repoDir,
          resource.type,
          resource.name,
          versionOverrides,
        );
        sections.push(
          `- \`${ref}\`${
            resource.description ? `: ${resource.description}` : ""
          }`,
        );
      }
      sections.push("");
    }
    while (sections.at(-1) === "") {
      sections.pop();
    }
    return sections;
  }

  private async buildExistingResourceChangelogLines(repoDir: string): Promise<string[]> {
    const lines: string[] = [];
    for (const type of RESOURCE_TYPES) {
      const resources = await this.collectResourceDocsItems(repoDir, type);
      for (const resource of resources) {
        const ref = await this.getResourceRef(repoDir, resource.type, resource.name);
        lines.push(`- Documented existing resource \`${ref}\`.`);
      }
    }
    return lines;
  }

  private async collectResourceDocsItems(
    repoDir: string,
    type: ResourceType,
  ): Promise<ResourceDocsItem[]> {
    const resources = await this.scanner.scanByType(repoDir, type);
    const items: ResourceDocsItem[] = resources.map((resource) => ({
      name: resource.name,
      type: resource.type,
      description: resource.description,
    }));

    const managedNames = new Set(resources.map((resource) => resource.name));
    items.push(...(await this.scanEntryBasedDocsItems(repoDir, type, managedNames)));

    return items.sort((a, b) => a.name.localeCompare(b.name));
  }

  private async scanEntryBasedDocsItems(
    repoDir: string,
    type: ResourceType,
    managedNames: Set<string>,
  ): Promise<ResourceDocsItem[]> {
    const baseDir = path.join(repoDir, this.getTypeDir(type));
    if (!(await this.exists(baseDir))) return [];

    const entries = await fs.readdir(baseDir, { withFileTypes: true });
    const items: ResourceDocsItem[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const resourceEntry = this.getDefaultEntry(type);
      const entryPath = path.join(baseDir, entry.name, resourceEntry);
      if (!(await this.exists(entryPath))) continue;

      const metadata =
        type === "skill" ? await this.readSkillFrontMatter(entryPath) : null;
      const name = this.readStringMetadata(metadata, "name") ?? entry.name;
      if (managedNames.has(name) || managedNames.has(entry.name)) continue;

      items.push({
        name,
        type,
        description: this.readStringMetadata(metadata, "description"),
      });
    }
    return items;
  }

  private async readSkillFrontMatter(
    skillPath: string,
  ): Promise<Record<string, unknown> | null> {
    const raw = await fs.readFile(skillPath, "utf8");
    const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(raw.trimStart());
    if (!match) return null;

    try {
      const parsed = YAML.parse(match[1]) as unknown;
      return this.isRecord(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }

  private readStringMetadata(
    metadata: Record<string, unknown> | null,
    key: string,
  ): string | undefined {
    const value = metadata?.[key];
    if (typeof value !== "string") return undefined;
    const trimmed = value.trim();
    return trimmed ? trimmed : undefined;
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

  private async maintainSourceDocs(
    repoDir: string,
    changelogEntry: ChangelogEntry,
    versionOverrides = new Map<string, string>(),
  ): Promise<string[]> {
    const readmePath = await this.updateReadmeResourceIndex(repoDir, versionOverrides);
    const changelogPath = await this.updateChangelog(repoDir, changelogEntry);
    return [readmePath, changelogPath];
  }

  private async updateReadmeResourceIndex(
    repoDir: string,
    versionOverrides = new Map<string, string>(),
  ): Promise<string> {
    const readmePath = path.join(repoDir, "README.md");
    if (!(await this.exists(readmePath))) {
      await fs.writeFile(
        readmePath,
        await this.buildReadmeContent(repoDir, versionOverrides),
        "utf8",
      );
      return readmePath;
    }

    const current = await fs.readFile(readmePath, "utf8");
    const resourceSection = [
      README_RESOURCES_START,
      ...(await this.buildResourceIndex(repoDir, versionOverrides)),
      README_RESOURCES_END,
    ].join("\n");
    const updated = this.replaceOrAppendReadmeResourceSection(
      current,
      resourceSection,
    );
    if (updated !== current) {
      await fs.writeFile(readmePath, updated, "utf8");
    }
    return readmePath;
  }

  private replaceOrAppendReadmeResourceSection(
    content: string,
    resourceSection: string,
  ): string {
    const startIndex = content.indexOf(README_RESOURCES_START);
    const endIndex = content.indexOf(README_RESOURCES_END);
    if (startIndex >= 0 && endIndex > startIndex) {
      const before = content.slice(0, startIndex).replace(/\s*$/, "\n");
      const after = content
        .slice(endIndex + README_RESOURCES_END.length)
        .replace(/^\s*/, "\n\n");
      return `${before}${resourceSection}${after}`.replace(/\s*$/, "\n");
    }

    const base = content.replace(/\s*$/, "");
    return `${base}\n\n## Resources\n\n${resourceSection}\n`;
  }

  private async updateChangelog(
    repoDir: string,
    entry: ChangelogEntry,
  ): Promise<string> {
    const changelogPath = path.join(repoDir, "CHANGELOG.md");
    const current = (await this.exists(changelogPath))
      ? await fs.readFile(changelogPath, "utf8")
      : this.buildChangelogBaseContent();
    const updated = this.insertChangelogEntry(current, entry);
    if (updated !== current) {
      await fs.writeFile(changelogPath, updated, "utf8");
    }
    return changelogPath;
  }

  private buildChangelogBaseContent(): string {
    return [
      "# Changelog",
      "",
      "All notable source-level resource changes are documented in this file.",
      "",
      "## [Unreleased]",
      "",
    ].join("\n");
  }

  private insertChangelogEntry(
    content: string,
    entry: ChangelogEntry,
  ): string {
    const lines = content.replace(/\s*$/, "").split("\n");
    let unreleasedIndex = lines.findIndex((line) => line.trim() === "## [Unreleased]");
    if (unreleasedIndex === -1) {
      const firstVersionIndex = lines.findIndex((line) => line.startsWith("## "));
      const insertIndex = firstVersionIndex === -1 ? lines.length : firstVersionIndex;
      lines.splice(insertIndex, 0, "## [Unreleased]", "");
      unreleasedIndex = insertIndex;
    }

    const blockEnd = this.findNextHeadingIndex(lines, unreleasedIndex + 1, "## ");
    const unreleasedLines = lines.slice(unreleasedIndex, blockEnd);
    if (unreleasedLines.includes(entry.line)) {
      return `${lines.join("\n")}\n`;
    }

    const sectionHeading = `### ${entry.section}`;
    const sectionIndex = lines.findIndex(
      (line, index) =>
        index > unreleasedIndex && index < blockEnd && line.trim() === sectionHeading,
    );
    if (sectionIndex >= 0) {
      const insertIndex = lines[sectionIndex + 1] === "" ? sectionIndex + 2 : sectionIndex + 1;
      lines.splice(insertIndex, 0, entry.line);
      return `${lines.join("\n")}\n`;
    }

    const insertIndex = this.findChangelogSectionInsertIndex(
      lines,
      unreleasedIndex,
      blockEnd,
      entry.section,
    );
    lines.splice(insertIndex, 0, `### ${entry.section}`, "", entry.line, "");
    return `${lines.join("\n").replace(/\s*$/, "")}\n`;
  }

  private findNextHeadingIndex(
    lines: string[],
    startIndex: number,
    headingPrefix: string,
  ): number {
    const found = lines.findIndex(
      (line, index) => index >= startIndex && line.startsWith(headingPrefix),
    );
    return found === -1 ? lines.length : found;
  }

  private findChangelogSectionInsertIndex(
    lines: string[],
    unreleasedIndex: number,
    blockEnd: number,
    section: ChangelogSection,
  ): number {
    const sectionOrder: ChangelogSection[] = [
      "Added",
      "Changed",
      "Deprecated",
      "Removed",
    ];
    const sectionRank = sectionOrder.indexOf(section);
    for (let index = unreleasedIndex + 1; index < blockEnd; index += 1) {
      const line = lines[index].trim();
      if (!line.startsWith("### ")) continue;
      const foundSection = line.slice(4) as ChangelogSection;
      const foundRank = sectionOrder.indexOf(foundSection);
      if (foundRank > sectionRank) {
        return index;
      }
    }
    return blockEnd;
  }

  private async readResourceVersion(
    repoDir: string,
    type: ResourceType,
    name: string,
  ): Promise<string | undefined> {
    const yamlPath = path.join(repoDir, this.getTypeDir(type), name, "himan.yaml");
    try {
      const raw = await fs.readFile(yamlPath, "utf8");
      const parsed = YAML.parse(raw) as { version?: unknown } | null;
      return typeof parsed?.version === "string" ? parsed.version : undefined;
    } catch (error) {
      if (!this.isNotFoundError(error)) {
        throw error;
      }
      return undefined;
    }
  }

  private async collectLatestVersionedResources(): Promise<SourceSyncResource[]> {
    const repoDir = this.getRepoDir();
    const resources: SourceSyncResource[] = [];

    for (const type of RESOURCE_TYPES) {
      const scanned = await this.scanner.scanByType(repoDir, type);
      for (const resource of scanned) {
        const history = await this.history(type, resource.name);
        const latest = history[0];
        const metadataVersion = await this.readResourceVersion(
          repoDir,
          type,
          resource.name,
        );
        const version = latest?.version ?? metadataVersion;

        if (!version || !semver.valid(version)) {
          throw new HimanError(
            errorCodes.VERSION_NOT_FOUND,
            `Latest version not found for ${type}/${resource.name}.`,
          );
        }

        resources.push({
          type,
          name: resource.name,
          version,
          tag: `${type}/${resource.name}@${version}`,
          sourceRef: latest ? latest.raw : undefined,
          sourcePath: latest
            ? undefined
            : path.join(repoDir, this.getTypeDir(type), resource.name),
        });
      }
    }

    return resources.sort((a, b) => {
      const typeOrder = RESOURCE_TYPES.indexOf(a.type) - RESOURCE_TYPES.indexOf(b.type);
      if (typeOrder !== 0) return typeOrder;
      return a.name.localeCompare(b.name);
    });
  }

  private async getResourceRef(
    repoDir: string,
    type: ResourceType,
    name: string,
    versionOverrides = new Map<string, string>(),
  ): Promise<string> {
    const version =
      versionOverrides.get(this.getResourceVersionOverrideKey(type, name)) ??
      (await this.readLatestTaggedResourceVersion(repoDir, type, name)) ??
      (await this.readResourceVersion(repoDir, type, name));
    return this.formatResourceRef(type, name, version);
  }

  private getResourceVersionOverrideKey(type: ResourceType, name: string): string {
    return `${type}/${name}`;
  }

  private async readLatestTaggedResourceVersion(
    repoDir: string,
    type: ResourceType,
    name: string,
  ): Promise<string | undefined> {
    const versions = (await this.repoManager.listTags(repoDir, `${type}/${name}@*`))
      .map((tag) => tag.split("@").at(1) ?? "")
      .filter((version) => semver.valid(version))
      .sort(semver.rcompare);
    return versions.at(0);
  }

  private formatResourceRef(
    type: ResourceType,
    name: string,
    version?: string,
  ): string {
    return version ? `${type}/${name}@${version}` : `${type}/${name}`;
  }

  private getSourceTitle(): string {
    const repo = this.sourceConfig?.repo?.replace(/\/$/, "");
    const repoName = repo?.split(/[/:]/).at(-1)?.replace(/\.git$/, "");
    return repoName ? `${repoName} Himan Source` : "Himan Source";
  }

  private getTypeLabel(type: ResourceType): string {
    if (type === "rule") return "Rules";
    if (type === "command") return "Commands";
    return "Skills";
  }
}
