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
import path from "node:path";
import YAML from "yaml";
import { IndexCacheStore } from "../../state/index-cache-store.js";

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
    const baseDirMtimeMs = await this.getMtimeMs(baseDir);

    const cached = await this.indexStore.get(repoId, type);
    if (cached && cached.baseDirMtimeMs === baseDirMtimeMs) {
      return cached.resources;
    }

    const scanned = await this.scanner.scanByType(repoDir, type);
    await this.indexStore.upsert(repoId, type, baseDirMtimeMs, scanned);
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
    const sameDir = await this.isSameDirectory(sourceDir, targetDir);
    if (!sameDir) {
      await fs.rm(targetDir, { recursive: true, force: true });
      await fs.mkdir(path.dirname(targetDir), { recursive: true });
      await fs.cp(sourceDir, targetDir, { recursive: true });
    }

    const yamlPath = path.join(targetDir, "himan.yaml");
    if (await this.exists(yamlPath)) {
      const raw = await fs.readFile(yamlPath, "utf8");
      const parsed = YAML.parse(raw) as Record<string, unknown>;
      parsed.version = version;
      await fs.writeFile(yamlPath, YAML.stringify(parsed), "utf8");
    }

    const tag = `${type}/${name}@${version}`;
    await this.repoManager.commitTagAndPush(
      repoDir,
      `publish ${type}/${name}@${version}`,
      tag,
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
    const targets = options.targets?.length ? options.targets : ["cursor"];

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
          targets,
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

  private async getMtimeMs(targetPath: string): Promise<number> {
    try {
      const stat = await fs.stat(targetPath);
      return stat.mtimeMs;
    } catch {
      return 0;
    }
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
}
