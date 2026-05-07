import type {
  CreateOptions,
  CreateResult,
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
import { promises as fs } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import YAML from "yaml";
import { IndexCacheStore } from "../../state/index-cache-store.js";

type PublishMetadata = Record<string, unknown> & {
  name: string;
  type: ResourceType;
  entry: string;
};

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

  async list(type: ResourceType): Promise<ResourceMeta[]> {
    const repoDir = this.getRepoDir();
    const repoId = this.sourceConfig?.repoId ?? "default";
    const typeDir = this.getTypeDir(type);
    const baseDir = path.join(repoDir, typeDir);
    const metadataHash = await this.getResourceMetadataHash(baseDir);

    const cached = await this.indexStore.get(repoId, type);
    if (cached && cached.metadataHash === metadataHash) {
      return cached.resources;
    }

    const scanned = await this.scanner.scanByType(repoDir, type);
    await this.indexStore.upsert(repoId, type, metadataHash, scanned);
    return scanned;
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
    const metadata = await this.validatePublishResource(type, name, sourceDir);
    const sameDir = await this.isSameDirectory(sourceDir, targetDir);
    if (!sameDir) {
      await fs.rm(targetDir, { recursive: true, force: true });
      await fs.mkdir(path.dirname(targetDir), { recursive: true });
      await fs.cp(sourceDir, targetDir, { recursive: true });
    }

    const yamlPath = path.join(targetDir, "himan.yaml");
    metadata.version = version;
    await fs.writeFile(yamlPath, YAML.stringify(metadata), "utf8");

    const tag = `${type}/${name}@${version}`;
    await this.repoManager.commitTagAndPush(
      repoDir,
      `publish ${type}/${name}@${version}`,
      tag,
      undefined,
      [path.relative(repoDir, targetDir)],
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

    if ((await this.exists(resourceDir)) && !options.force) {
      throw new HimanError(
        errorCodes.RESOURCE_EXISTS,
        `Resource already exists: ${type}/${name}`,
      );
    }

    const files = [path.join(resourceDir, "himan.yaml"), path.join(resourceDir, entry)];
    if (!options.dryRun) {
      await fs.rm(resourceDir, { recursive: true, force: true });
      await fs.mkdir(resourceDir, { recursive: true });
      await fs.writeFile(
        path.join(resourceDir, "himan.yaml"),
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
        path.join(resourceDir, entry),
        this.getDefaultContent(type, name),
        "utf8",
      );
    }

    return {
      type,
      name,
      resourceDir,
      files,
      dryRun: Boolean(options.dryRun),
    };
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

  private async validatePublishResource(
    type: ResourceType,
    name: string,
    resourceDir: string,
  ): Promise<PublishMetadata> {
    const yamlPath = path.join(resourceDir, "himan.yaml");
    if (!(await this.exists(yamlPath))) {
      throw this.invalidResourceMetadata(
        type,
        name,
        "Missing himan.yaml for publish.",
        { yamlPath },
      );
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
      ...parsed,
      name,
      type,
      entry,
    };
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

  private async getResourceMetadataHash(baseDir: string): Promise<string> {
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
}
