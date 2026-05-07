import type {
  CreateOptions,
  CreateResult,
  PublishResult,
  ResourceMeta,
  ResourceType,
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

const RESOURCE_TYPES: ResourceType[] = ["rule", "command", "skill"];
const README_RESOURCES_START = "<!-- himan:resources:start -->";
const README_RESOURCES_END = "<!-- himan:resources:end -->";

type ChangelogSection = "Added" | "Changed";

interface ChangelogEntry {
  section: ChangelogSection;
  line: string;
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

    const docsPaths = await this.maintainSourceDocs(repoDir, {
      section: "Changed",
      line: `- Published \`${type}/${name}@${version}\`.`,
    });
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

  async initDocs(options: SourceDocsOptions = {}): Promise<SourceDocsResult> {
    const repoDir = this.getRepoDir();
    const files = [
      {
        path: path.join(repoDir, "README.md"),
        content: await this.buildReadmeContent(repoDir),
      },
      {
        path: path.join(repoDir, "CHANGELOG.md"),
        content: this.buildChangelogContent(),
      },
    ];
    const results: SourceDocsFileResult[] = [];

    for (const file of files) {
      const exists = await this.exists(file.path);
      const action = exists ? (options.force ? "updated" : "skipped") : "created";
      const reason = action === "skipped" ? "file already exists" : undefined;
      results.push({ path: file.path, action, reason });

      if (!options.dryRun && action !== "skipped") {
        await fs.writeFile(file.path, file.content, "utf8");
      }
    }

    return {
      sourceDir: repoDir,
      files: results,
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

  private async buildReadmeContent(repoDir: string): Promise<string> {
    const resourceLines = await this.buildResourceIndex(repoDir);
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
      `himan source add team ${repo}`,
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

  private buildChangelogContent(): string {
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
      "",
    ].join("\n");
  }

  private async buildResourceIndex(repoDir: string): Promise<string[]> {
    const sections: string[] = [];
    for (const type of RESOURCE_TYPES) {
      const resources = (await this.scanner.scanByType(repoDir, type)).sort((a, b) =>
        a.name.localeCompare(b.name),
      );
      sections.push(`### ${this.getTypeLabel(type)}`, "");
      if (resources.length === 0) {
        sections.push(`- No ${type} resources yet.`, "");
        continue;
      }
      for (const resource of resources) {
        const version = await this.readResourceVersion(
          repoDir,
          resource.type,
          resource.name,
        );
        const ref = version
          ? `${resource.type}/${resource.name}@${version}`
          : `${resource.type}/${resource.name}`;
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

  private async maintainSourceDocs(
    repoDir: string,
    changelogEntry: ChangelogEntry,
  ): Promise<string[]> {
    const readmePath = await this.updateReadmeResourceIndex(repoDir);
    const changelogPath = await this.updateChangelog(repoDir, changelogEntry);
    return [readmePath, changelogPath];
  }

  private async updateReadmeResourceIndex(repoDir: string): Promise<string> {
    const readmePath = path.join(repoDir, "README.md");
    if (!(await this.exists(readmePath))) {
      await fs.writeFile(readmePath, await this.buildReadmeContent(repoDir), "utf8");
      return readmePath;
    }

    const current = await fs.readFile(readmePath, "utf8");
    const resourceSection = [
      README_RESOURCES_START,
      ...(await this.buildResourceIndex(repoDir)),
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
    const sectionOrder: ChangelogSection[] = ["Added", "Changed"];
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
