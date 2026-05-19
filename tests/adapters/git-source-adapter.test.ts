import { spawnSync } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GitSourceAdapter } from "../../src/adapters/source/git-source-adapter.js";
import YAML from "yaml";

let tmpRoot = "";
let fakeHomeDir = "";

beforeEach(async () => {
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "himan-git-source-"));
  fakeHomeDir = path.join(tmpRoot, "home");
  await fs.mkdir(fakeHomeDir, { recursive: true });
  vi.spyOn(os, "homedir").mockReturnValue(fakeHomeDir);
});

afterEach(async () => {
  vi.restoreAllMocks();
  if (tmpRoot) {
    await fs.rm(tmpRoot, { recursive: true, force: true });
  }
});

describe("GitSourceAdapter", () => {
  it("refreshes list cache when resource metadata changes inside an existing type directory", async () => {
    const { remoteDir, targetDir } = await createRemoteFixture();
    const adapter = new GitSourceAdapter();

    await adapter.init({
      type: "git",
      repo: remoteDir,
      repoDir: targetDir,
      repoId: "test-source",
    });
    const first = await adapter.list("rule");
    expect(first).toEqual([
      expect.objectContaining({
        name: "code-review",
        description: "original description",
      }),
    ]);

    const typeDir = path.join(targetDir, "rules");
    const typeDirStat = await fs.stat(typeDir);
    await writeRule(targetDir, "updated description");
    await fs.utimes(typeDir, typeDirStat.atime, typeDirStat.mtime);

    const second = await adapter.list("rule");
    expect(second).toEqual([
      expect.objectContaining({
        name: "code-review",
        description: "updated description",
      }),
    ]);
  });

  it("archives and restores source resources outside the active type directories", async () => {
    const { remoteDir, targetDir } = await createRemoteFixture();
    const adapter = new GitSourceAdapter();

    await adapter.init({
      type: "git",
      repo: remoteDir,
      repoDir: targetDir,
      repoId: "test-source",
    });
    configureGitUser(targetDir);

    const archived = await adapter.archive("rule", "code-review", {
      reason: "replaced by stricter rule",
    });

    expect(archived).toEqual(
      expect.objectContaining({
        type: "rule",
        name: "code-review",
        archiveReason: "replaced by stricter rule",
        committed: true,
        dryRun: false,
      }),
    );
    await expect(
      fs.access(path.join(targetDir, "rules", "code-review")),
    ).rejects.toThrow();
    await expect(
      fs.access(path.join(targetDir, "archive", "rules", "code-review")),
    ).resolves.toBeUndefined();
    await expect(
      fs.readFile(
        path.join(targetDir, "archive", "rules", "code-review", "himan.yaml"),
        "utf8",
      ),
    ).resolves.toContain("archiveReason: replaced by stricter rule");
    expect(await adapter.list("rule")).toEqual([]);
    expect(await adapter.list("rule", { archived: true })).toEqual([
      expect.objectContaining({
        name: "code-review",
        archived: true,
        archiveReason: "replaced by stricter rule",
      }),
    ]);
    await expect(fs.readFile(path.join(targetDir, "README.md"), "utf8")).resolves.toContain(
      "No rule resources yet.",
    );
    await expect(
      fs.readFile(path.join(targetDir, "CHANGELOG.md"), "utf8"),
    ).resolves.toContain("- Archived `rule/code-review`: replaced by stricter rule.");
    await expect(
      fs.readFile(path.join(targetDir, "CHANGELOG.md"), "utf8"),
    ).resolves.toContain("### Removed");

    const restored = await adapter.restore("rule", "code-review");

    expect(restored).toEqual(
      expect.objectContaining({
        type: "rule",
        name: "code-review",
        committed: true,
        dryRun: false,
      }),
    );
    await expect(
      fs.access(path.join(targetDir, "rules", "code-review")),
    ).resolves.toBeUndefined();
    await expect(
      fs.access(path.join(targetDir, "archive", "rules", "code-review")),
    ).rejects.toThrow();
    const restoredYaml = await fs.readFile(
      path.join(targetDir, "rules", "code-review", "himan.yaml"),
      "utf8",
    );
    expect(restoredYaml).not.toContain("archived:");
    expect(restoredYaml).not.toContain("archiveReason:");
    expect(await adapter.list("rule")).toEqual([
      expect.objectContaining({ name: "code-review" }),
    ]);
    expect(await adapter.list("rule", { archived: true })).toEqual([]);
    await expect(fs.readFile(path.join(targetDir, "README.md"), "utf8")).resolves.toContain(
      "#### General",
    );
    await expect(fs.readFile(path.join(targetDir, "README.md"), "utf8")).resolves.toContain(
      "| Resource | Version | Description |",
    );
    await expect(fs.readFile(path.join(targetDir, "README.md"), "utf8")).resolves.toContain(
      "| `code-review` | - | original description |",
    );
    await expect(
      fs.readFile(path.join(targetDir, "CHANGELOG.md"), "utf8"),
    ).resolves.toContain("- Restored `rule/code-review` from archive.");
  });

  it("publishes a valid resource and writes the requested version", async () => {
    const { remoteDir, targetDir } = await createRemoteFixture();
    const adapter = new GitSourceAdapter();
    const sourceDir = path.join(tmpRoot, "published-rule");

    await adapter.init({
      type: "git",
      repo: remoteDir,
      repoDir: targetDir,
      repoId: "test-source",
    });
    configureGitUser(targetDir);
    await writeNamedRule(sourceDir, {
      name: "published-rule",
      description: "valid publish",
      content: "# published-rule\n",
    });

    const result = await adapter.publish("rule", "published-rule", "0.1.0", sourceDir);

    expect(result).toEqual({
      version: "0.1.0",
      tag: "rule/published-rule@0.1.0",
    });
    await expect(
      fs.readFile(path.join(targetDir, "rules", "published-rule", "himan.yaml"), "utf8"),
    ).resolves.toContain("version: 0.1.0");
    await expect(fs.readFile(path.join(targetDir, "README.md"), "utf8")).resolves.toContain(
      "#### General",
    );
    await expect(fs.readFile(path.join(targetDir, "README.md"), "utf8")).resolves.toContain(
      "| `published-rule` | 0.1.0 | valid publish |",
    );
    const changelog = await fs.readFile(path.join(targetDir, "CHANGELOG.md"), "utf8");
    const today = formatLocalDate(new Date());
    expect(changelog).toContain(`## [${today}]`);
    expect(changelog).toContain(`## [${today}]\n\n### Added`);
    expect(changelog).toContain("- Published `rule/published-rule@0.1.0`.");
    expect(extractUnreleasedBlock(changelog)).not.toContain(
      "- Published `rule/published-rule@0.1.0`.",
    );
    expect(runGitOutput(["tag", "--list", "rule/published-rule@0.1.0"], targetDir)).toBe(
      "rule/published-rule@0.1.0",
    );
  });

  it("creates skill metadata with static analysis", async () => {
    const { remoteDir, targetDir } = await createRemoteFixture();
    const adapter = new GitSourceAdapter();

    await adapter.init({
      type: "git",
      repo: remoteDir,
      repoDir: targetDir,
      repoId: "test-source",
    });

    await adapter.create("skill", "analysis-skill", {
      description: "analyze skill metadata",
      agents: ["codex"],
    });

    const raw = await fs.readFile(
      path.join(targetDir, "skills", "analysis-skill", "himan.yaml"),
      "utf8",
    );
    const parsed = YAML.parse(raw) as {
      analysis?: {
        content?: {
          tokenizer?: string;
          tokenEstimator?: string;
          entryTokens?: number;
          packageTokens?: number;
          contentHash?: string;
        };
        dependencies?: {
          skills?: string[];
          scripts?: string[];
          mcpTools?: string[];
        };
        generation?: {
          generatedBy?: string;
        };
      };
    };

    expect(parsed.analysis?.content).toEqual(
      expect.objectContaining({
        tokenizer: "approx-char-v1",
        tokenEstimator: "ceil(chars/4)",
        entryTokens: expect.any(Number),
        packageTokens: expect.any(Number),
        contentHash: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
      }),
    );
    expect(parsed.analysis?.dependencies).toEqual({
      skills: [],
      scripts: [],
      mcpTools: [],
    });
    expect(parsed.analysis?.generation).toEqual(
      expect.objectContaining({
        generatedBy: "himan",
      }),
    );
  });

  it("rejects publish when content matches the latest version", async () => {
    const { remoteDir, targetDir } = await createRemoteFixture();
    const adapter = new GitSourceAdapter();
    const sourceDir = path.join(tmpRoot, "published-rule");

    await adapter.init({
      type: "git",
      repo: remoteDir,
      repoDir: targetDir,
      repoId: "test-source",
    });
    configureGitUser(targetDir);
    await writeNamedRule(sourceDir, {
      name: "published-rule",
      description: "valid publish",
      content: "# published-rule\n",
    });
    await adapter.publish("rule", "published-rule", "0.1.0", sourceDir);

    await expect(
      adapter.publish("rule", "published-rule", "0.1.1", sourceDir),
    ).rejects.toMatchObject({
      code: "E_PUBLISH_NO_CHANGES",
      message: "No changes to publish for rule/published-rule.",
    });
    expect(runGitOutput(["tag", "--list", "rule/published-rule@0.1.1"], targetDir)).toBe("");
  });

  it("records first publish as Added and subsequent publish as Changed", async () => {
    const { remoteDir, targetDir } = await createRemoteFixture();
    const adapter = new GitSourceAdapter();
    const sourceDir = path.join(tmpRoot, "publish-sections");

    await adapter.init({
      type: "git",
      repo: remoteDir,
      repoDir: targetDir,
      repoId: "test-source",
    });
    configureGitUser(targetDir);
    await writeNamedRule(sourceDir, {
      name: "publish-sections",
      description: "first release",
      content: "# publish-sections\nv1\n",
    });

    await adapter.publish("rule", "publish-sections", "0.1.0", sourceDir);
    await fs.writeFile(path.join(sourceDir, "content.md"), "# publish-sections\nv2\n", "utf8");
    await adapter.publish("rule", "publish-sections", "0.1.1", sourceDir);

    const changelog = await fs.readFile(path.join(targetDir, "CHANGELOG.md"), "utf8");
    const today = formatLocalDate(new Date());
    expect(changelog).toContain(`## [${today}]`);
    expect(changelog).toContain("### Added");
    expect(changelog).toContain("- Published `rule/publish-sections@0.1.0`.");
    expect(changelog).toContain("### Changed");
    expect(changelog).toContain("- Published `rule/publish-sections@0.1.1`.");
  });

  it("force-initializes source docs with existing resources", async () => {
    const { remoteDir, targetDir } = await createRemoteFixture({ legacySkill: true });
    const adapter = new GitSourceAdapter();

    await adapter.init({
      type: "git",
      repo: remoteDir,
      repoDir: targetDir,
      repoId: "test-source",
    });
    configureGitUser(targetDir);
    await fs.writeFile(path.join(targetDir, "README.md"), "# Existing docs\n", "utf8");
    await fs.writeFile(path.join(targetDir, "CHANGELOG.md"), "# Old changelog\n", "utf8");

    const result = await adapter.initDocs({ force: true });

    expect(result.committed).toBe(true);
    expect(result.files).toEqual([
      expect.objectContaining({ action: "updated", path: path.join(targetDir, "README.md") }),
      expect.objectContaining({ action: "updated", path: path.join(targetDir, "CHANGELOG.md") }),
    ]);
    await expect(fs.readFile(path.join(targetDir, "README.md"), "utf8")).resolves.toContain(
      "#### General",
    );
    await expect(fs.readFile(path.join(targetDir, "README.md"), "utf8")).resolves.toContain(
      "| `code-review` | - | original description |",
    );
    await expect(fs.readFile(path.join(targetDir, "README.md"), "utf8")).resolves.toContain(
      "#### Common",
    );
    await expect(fs.readFile(path.join(targetDir, "README.md"), "utf8")).resolves.toContain(
      "| `common-dev-pattern` | 0.1.0 | Follow existing repository patterns. |",
    );
    await expect(
      fs.readFile(path.join(targetDir, "CHANGELOG.md"), "utf8"),
    ).resolves.toContain("- Documented existing resource `rule/code-review`.");
    await expect(
      fs.readFile(path.join(targetDir, "CHANGELOG.md"), "utf8"),
    ).resolves.toContain("- Documented existing resource `skill/common-dev-pattern@0.1.0`.");
    expect(runGitOutput(["show", "origin/main:README.md"], targetDir)).toContain(
      "#### General",
    );
    expect(runGitOutput(["show", "origin/main:README.md"], targetDir)).toContain(
      "#### Common",
    );
    expect(runGitOutput(["show", "origin/main:README.md"], targetDir)).toContain(
      "| `code-review` | - | original description |",
    );
    expect(runGitOutput(["show", "origin/main:README.md"], targetDir)).toContain(
      "| `common-dev-pattern` | 0.1.0 | Follow existing repository patterns. |",
    );
  });

  it("repairs historical changelog publish entries and README resource index", async () => {
    const { remoteDir, targetDir } = await createRemoteFixture();
    const adapter = new GitSourceAdapter();
    const today = formatLocalDate(new Date());

    await adapter.init({
      type: "git",
      repo: remoteDir,
      repoDir: targetDir,
      repoId: "test-source",
    });
    configureGitUser(targetDir);
    runGit(["tag", "rule/code-review@1.0.0"], targetDir);
    runGit(["tag", "rule/code-review@1.1.0"], targetDir);
    await fs.writeFile(
      path.join(targetDir, "README.md"),
      [
        "# Existing docs",
        "",
        "## Resources",
        "",
        "<!-- himan:resources:start -->",
        "- legacy index",
        "<!-- himan:resources:end -->",
        "",
        "## Notes",
        "",
        "keep this section",
        "",
      ].join("\n"),
      "utf8",
    );
    await fs.writeFile(
      path.join(targetDir, "CHANGELOG.md"),
      [
        "# Changelog",
        "",
        "All notable source-level resource changes are documented in this file.",
        "",
        "## [Unreleased]",
        "",
        "### Added",
        "",
        "- Initial source README/CHANGELOG scaffold.",
        "- Documented existing resource `rule/code-review@1.0.0`.",
        "",
        "### Changed",
        "",
        "- Published `rule/code-review@1.0.0`.",
        "- Published `rule/code-review@1.1.0`.",
        "- Updated setup note.",
        "",
      ].join("\n"),
      "utf8",
    );

    const result = await adapter.initDocs({ repairHistory: true });

    expect(result.files).toEqual([
      expect.objectContaining({ action: "updated", path: path.join(targetDir, "README.md") }),
      expect.objectContaining({ action: "updated", path: path.join(targetDir, "CHANGELOG.md") }),
    ]);
    const readme = await fs.readFile(path.join(targetDir, "README.md"), "utf8");
    expect(readme).toContain("#### General");
    expect(readme).toContain("| Resource | Version | Description |");
    expect(readme).toContain("| `code-review` | 1.1.0 | original description |");
    expect(readme).toContain("## Notes");
    expect(readme).toContain("keep this section");
    const changelog = await fs.readFile(path.join(targetDir, "CHANGELOG.md"), "utf8");
    expect(extractUnreleasedBlock(changelog)).toContain("- Updated setup note.");
    expect(extractUnreleasedBlock(changelog)).not.toContain("- Published `rule/code-review@1.0.0`.");
    expect(extractUnreleasedBlock(changelog)).not.toContain(
      "- Initial source README/CHANGELOG scaffold.",
    );
    expect(changelog).toContain(`## [${today}]`);
    expect(changelog).toContain("### Added");
    expect(changelog).toContain("### Changed");
    expect(changelog).toContain("- Initial source README/CHANGELOG scaffold.");
    expect(changelog).toContain("- Documented existing resource `rule/code-review@1.0.0`.");
    expect(changelog).toContain("- Published `rule/code-review@1.0.0`.");
    expect(changelog).toContain("- Published `rule/code-review@1.1.0`.");
  });

  it("publishes a resource with inferred metadata when himan.yaml is missing", async () => {
    const { remoteDir, targetDir } = await createRemoteFixture();
    const adapter = new GitSourceAdapter();
    const sourceDir = path.join(tmpRoot, "missing-metadata");

    await adapter.init({
      type: "git",
      repo: remoteDir,
      repoDir: targetDir,
      repoId: "test-source",
    });
    configureGitUser(targetDir);
    await fs.mkdir(sourceDir, { recursive: true });
    await fs.writeFile(path.join(sourceDir, "content.md"), "# missing metadata\n", "utf8");

    const result = await adapter.publish("rule", "missing-metadata", "0.1.0", sourceDir);

    expect(result).toEqual({
      version: "0.1.0",
      tag: "rule/missing-metadata@0.1.0",
    });
    await expect(
      fs.readFile(path.join(targetDir, "rules", "missing-metadata", "content.md"), "utf8"),
    ).resolves.toContain("# missing metadata");
    await expect(
      fs.access(path.join(targetDir, "rules", "missing-metadata", "himan.yaml")),
    ).rejects.toThrow();
    await expect(fs.readFile(path.join(targetDir, "README.md"), "utf8")).resolves.toContain(
      "| `missing-metadata` | 0.1.0 |",
    );
    expect(runGitOutput(["tag", "--list", "rule/missing-metadata@0.1.0"], targetDir)).toBe(
      "rule/missing-metadata@0.1.0",
    );
  });

  it("rejects publish when the metadata entry file is missing", async () => {
    const { remoteDir, targetDir } = await createRemoteFixture();
    const adapter = new GitSourceAdapter();
    const sourceDir = path.join(tmpRoot, "missing-entry");

    await adapter.init({
      type: "git",
      repo: remoteDir,
      repoDir: targetDir,
      repoId: "test-source",
    });
    await fs.mkdir(sourceDir, { recursive: true });
    await fs.writeFile(
      path.join(sourceDir, "himan.yaml"),
      [
        "name: missing-entry",
        "type: rule",
        "entry: content.md",
        "description: missing entry file",
      ].join("\n"),
      "utf8",
    );

    await expect(
      adapter.publish("rule", "missing-entry", "0.1.0", sourceDir),
    ).rejects.toMatchObject({
      code: "E_INVALID_RESOURCE_METADATA",
    });
    await expect(
      fs.access(path.join(targetDir, "rules", "missing-entry")),
    ).rejects.toThrow();
  });

  it("renames a tagged resource and creates a new latest-version tag", async () => {
    const { remoteDir, targetDir } = await createRemoteFixture();
    const adapter = new GitSourceAdapter();

    await adapter.init({
      type: "git",
      repo: remoteDir,
      repoDir: targetDir,
      repoId: "test-source",
    });
    configureGitUser(targetDir);
    runGit(["tag", "rule/code-review@1.0.0"], targetDir);

    const result = await adapter.rename("rule", "code-review", "review-rules");

    expect(result).toEqual({
      type: "rule",
      oldName: "code-review",
      newName: "review-rules",
      previousResourceDir: path.join(targetDir, "rules", "code-review"),
      resourceDir: path.join(targetDir, "rules", "review-rules"),
      latestVersion: "1.0.0",
      tag: "rule/review-rules@1.0.0",
      committed: true,
      dryRun: false,
    });
    await expect(fs.access(path.join(targetDir, "rules", "code-review"))).rejects.toThrow();
    await expect(
      fs.readFile(path.join(targetDir, "rules", "review-rules", "himan.yaml"), "utf8"),
    ).resolves.toContain("name: review-rules");
    await expect(fs.readFile(path.join(targetDir, "README.md"), "utf8")).resolves.toContain(
      "#### General",
    );
    await expect(fs.readFile(path.join(targetDir, "README.md"), "utf8")).resolves.toContain(
      "| `review-rules` | 1.0.0 | original description |",
    );
    await expect(
      fs.readFile(path.join(targetDir, "CHANGELOG.md"), "utf8"),
    ).resolves.toContain("- Renamed `rule/code-review` to `rule/review-rules`.");
    expect(runGitOutput(["tag", "--list", "rule/*@1.0.0"], targetDir).split("\n")).toEqual([
      "rule/code-review@1.0.0",
      "rule/review-rules@1.0.0",
    ]);
  });

  it("renames metadata-less skill front matter", async () => {
    const { remoteDir, targetDir } = await createRemoteFixture({ legacySkill: true });
    const adapter = new GitSourceAdapter();

    await adapter.init({
      type: "git",
      repo: remoteDir,
      repoDir: targetDir,
      repoId: "test-source",
    });
    configureGitUser(targetDir);

    await adapter.rename("skill", "common-dev-pattern", "repo-map");

    await expect(
      fs.readFile(path.join(targetDir, "skills", "repo-map", "SKILL.md"), "utf8"),
    ).resolves.toContain("name: repo-map");
    const listed = await adapter.list("skill");
    expect(listed).toEqual([
      expect.objectContaining({
        name: "repo-map",
        type: "skill",
        description: "Follow existing repository patterns.",
      }),
    ]);
    expect(runGitOutput(["tag", "--list", "skill/repo-map@*"], targetDir)).toBe(
      "skill/repo-map@0.1.0",
    );
  });

  it("rejects rename when the target resource exists", async () => {
    const { remoteDir, targetDir } = await createRemoteFixture();
    const adapter = new GitSourceAdapter();

    await adapter.init({
      type: "git",
      repo: remoteDir,
      repoDir: targetDir,
      repoId: "test-source",
    });
    await writeNamedRule(targetDir, {
      name: "review-rules",
      description: "existing target",
      content: "# review-rules\n",
    });

    await expect(
      adapter.rename("rule", "code-review", "review-rules"),
    ).rejects.toMatchObject({
      code: "E_RESOURCE_EXISTS",
      message: "Resource already exists: rule/review-rules",
    });
  });
});

async function createRemoteFixture(options?: { legacySkill?: boolean }): Promise<{
  remoteDir: string;
  targetDir: string;
}> {
  const seedDir = path.join(tmpRoot, "seed");
  const remoteDir = path.join(tmpRoot, "remote.git");
  const targetDir = path.join(tmpRoot, "target");

  await fs.mkdir(seedDir, { recursive: true });
  await fs.mkdir(remoteDir, { recursive: true });
  await writeRule(seedDir, "original description");
  if (options?.legacySkill) {
    await writeLegacySkill(seedDir);
  }

  runGit(["init", "--initial-branch=main"], seedDir);
  commitAll(seedDir, "Initial commit");
  if (options?.legacySkill) {
    runGit(["tag", "skill/common-dev-pattern@0.0.1"], seedDir);
    runGit(["tag", "skill/common-dev-pattern@0.1.0"], seedDir);
  }
  runGit(["init", "--bare", "--initial-branch=main"], remoteDir);
  runGit(["remote", "add", "origin", remoteDir], seedDir);
  runGit(["push", "-u", "origin", "main"], seedDir);
  if (options?.legacySkill) {
    runGit(["push", "origin", "--tags"], seedDir);
  }

  return { remoteDir, targetDir };
}

async function writeRule(repoDir: string, description: string): Promise<void> {
  await writeNamedRule(repoDir, {
    name: "code-review",
    description,
    content: "# code-review\n",
  });
}

async function writeNamedRule(
  repoDir: string,
  options: { name: string; description: string; content: string },
): Promise<void> {
  const targetDir = repoDir.endsWith(options.name)
    ? repoDir
    : path.join(repoDir, "rules", options.name);
  await fs.mkdir(targetDir, { recursive: true });
  await fs.writeFile(
    path.join(targetDir, "himan.yaml"),
    [
      `name: ${options.name}`,
      "type: rule",
      "entry: content.md",
      `description: ${options.description}`,
      "agents:",
      "  - cursor",
    ].join("\n"),
    "utf8",
  );
  await fs.writeFile(path.join(targetDir, "content.md"), options.content, "utf8");
}

async function writeLegacySkill(repoDir: string): Promise<void> {
  const targetDir = path.join(repoDir, "skills", "common-dev-pattern");
  await fs.mkdir(targetDir, { recursive: true });
  await fs.writeFile(
    path.join(targetDir, "SKILL.md"),
    [
      "---",
      "name: common-dev-pattern",
      "description: Follow existing repository patterns.",
      "---",
      "",
      "# common-dev-pattern",
      "",
    ].join("\n"),
    "utf8",
  );
}

function extractUnreleasedBlock(changelog: string): string {
  const heading = "## [Unreleased]";
  const start = changelog.indexOf(heading);
  if (start === -1) return "";
  const bodyStart = start + heading.length;
  const nextHeading = changelog.indexOf("\n## [", bodyStart);
  const bodyEnd = nextHeading === -1 ? changelog.length : nextHeading;
  return changelog.slice(bodyStart, bodyEnd);
}

function formatLocalDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function commitAll(cwd: string, message: string): void {
  runGit(
    [
      "-c",
      "user.name=Himan Bot",
      "-c",
      "user.email=himan@example.com",
      "add",
      ".",
    ],
    cwd,
  );
  runGit(
    [
      "-c",
      "user.name=Himan Bot",
      "-c",
      "user.email=himan@example.com",
      "commit",
      "-m",
      message,
    ],
    cwd,
  );
}

function configureGitUser(cwd: string): void {
  runGit(["config", "user.name", "Himan Bot"], cwd);
  runGit(["config", "user.email", "himan@example.com"], cwd);
}

function runGit(args: string[], cwd: string): void {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  expect(
    result.status,
    `git ${args.join(" ")}\n${result.stdout}\n${result.stderr}`,
  ).toBe(0);
}

function runGitOutput(args: string[], cwd: string): string {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  expect(
    result.status,
    `git ${args.join(" ")}\n${result.stdout}\n${result.stderr}`,
  ).toBe(0);
  return result.stdout.trim();
}
