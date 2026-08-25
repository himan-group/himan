import { promises as fs } from "node:fs";
import path from "node:path";
import type {
  ArchiveOptions,
  ArchiveResult,
  CommentOptions,
  CommentResult,
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
  SourceDocsOptions,
  SourceDocsResult,
} from "../../domain/source-docs.js";
import { errorCodes, HimanError } from "../../utils/errors.js";
import { ResourceScanner } from "../resource/resource-scanner.js";
import type {
  ResourceSourceAdapter,
  SourceConfig,
} from "./resource-source-adapter.js";
import YAML from "yaml";

const TYPE_DIRS: Record<ResourceType, string> = {
  rule: "rules",
  command: "commands",
  skill: "skills",
  config: "configs",
};

/**
 * A private local source backed by a plain directory on disk. It is created by
 * `himan system migrate` so unmanaged resources can be onboarded without
 * requiring a Git repository. Versioning comes from `himan.yaml`; publishing
 * and archive workflows require a Git source.
 */
export class LocalSourceAdapter implements ResourceSourceAdapter {
  private rootDir = "";

  async init(sourceConfig: SourceConfig): Promise<void> {
    if (sourceConfig.type !== "local") {
      throw new HimanError(
        errorCodes.INVALID_INPUT,
        "Local source requires type 'local'.",
      );
    }
    this.rootDir = sourceConfig.repoDir ?? sourceConfig.repo ?? "";
    if (!this.rootDir) {
      throw new HimanError(
        errorCodes.INVALID_INPUT,
        "Local source requires a root directory.",
      );
    }
    await fs.mkdir(this.rootDir, { recursive: true });
  }

  async list(
    type: ResourceType,
    options?: ResourceListOptions,
  ): Promise<ResourceMeta[]> {
    const scanner = new ResourceScanner();
    return scanner.scanByType(this.rootDir, type, options);
  }

  async history(type: ResourceType, name: string): Promise<VersionInfo[]> {
    const version = await this.readVersion(type, name);
    if (!version) return [];
    return [{ version, raw: `${type}/${name}@${version}` }];
  }

  async isArchived(_type: ResourceType, _name: string): Promise<boolean> {
    return false;
  }

  async pull(
    type: ResourceType,
    name: string,
    _version: string,
    targetDir: string,
  ): Promise<void> {
    const sourceDir = path.join(this.rootDir, TYPE_DIRS[type], name);
    if (!(await this.exists(sourceDir))) {
      throw new HimanError(
        errorCodes.RESOURCE_NOT_FOUND,
        `Resource not found in local source: ${type}/${name}`,
      );
    }
    await fs.mkdir(path.dirname(targetDir), { recursive: true });
    await fs.rm(targetDir, { recursive: true, force: true });
    await fs.cp(sourceDir, targetDir, { recursive: true });
  }

  async publish(): Promise<PublishResult> {
    throw new HimanError(
      errorCodes.NOT_IMPLEMENTED,
      "Local source does not support publishing. Move the resource to a Git source to publish versions.",
    );
  }

  async create(): Promise<CreateResult> {
    throw new HimanError(
      errorCodes.NOT_IMPLEMENTED,
      "Local source does not support resource creation. Use `himan resource create` against a Git source.",
    );
  }

  async rename(): Promise<RenameResult> {
    throw new HimanError(
      errorCodes.NOT_IMPLEMENTED,
      "Local source does not support renaming.",
    );
  }

  async comment(): Promise<CommentResult> {
    throw new HimanError(
      errorCodes.NOT_IMPLEMENTED,
      "Local source does not support comments. Move the resource to a Git source.",
    );
  }

  async archive(): Promise<ArchiveResult> {
    throw new HimanError(
      errorCodes.NOT_IMPLEMENTED,
      "Local source does not support archiving.",
    );
  }

  async restore(): Promise<RestoreResult> {
    throw new HimanError(
      errorCodes.NOT_IMPLEMENTED,
      "Local source does not support restoring archived resources.",
    );
  }

  async initDocs(_options: SourceDocsOptions): Promise<SourceDocsResult> {
    throw new HimanError(
      errorCodes.NOT_IMPLEMENTED,
      "Local source does not support source-level docs generation.",
    );
  }

  private async readVersion(
    type: ResourceType,
    name: string,
  ): Promise<string | undefined> {
    const yamlPath = path.join(this.rootDir, TYPE_DIRS[type], name, "himan.yaml");
    try {
      const raw = await fs.readFile(yamlPath, "utf8");
      const parsed = YAML.parse(raw) as { version?: unknown } | null;
      if (parsed && typeof parsed.version === "string" && parsed.version) {
        return parsed.version;
      }
    } catch {
      return undefined;
    }
    return undefined;
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
