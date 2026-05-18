import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { toRepoId } from "../../src/utils/repo-id.js";

const TEST_REPO = "https://github.com/himan-group/himan-test.git";

let tmpRoot = "";
let homeDir = "";
let projectDir = "";
let repoDir = "";
let cliEntry = "";
let mockedRemoteDir = "";
let seedRepoDir = "";

beforeAll(async () => {
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "himan-cli-it-"));
  homeDir = path.join(tmpRoot, "home");
  projectDir = path.join(tmpRoot, "project");
  repoDir = path.join(homeDir, ".himan", "repos", toRepoId(TEST_REPO));
  cliEntry = path.join(process.cwd(), "dist", "bin", "himan.js");
  mockedRemoteDir = path.join(tmpRoot, "mocked-remote.git");
  seedRepoDir = path.join(tmpRoot, "seed-remote");

  await fs.mkdir(homeDir, { recursive: true });
  await fs.mkdir(projectDir, { recursive: true });
  await fs.mkdir(seedRepoDir, { recursive: true });
  await fs.mkdir(mockedRemoteDir, { recursive: true });
  await fs.writeFile(
    path.join(seedRepoDir, "README.md"),
    "# himan-test\n",
    "utf8",
  );
  runGit(["init", "--initial-branch=main"], seedRepoDir);
  runGit(
    [
      "-c",
      "user.name=Himan Bot",
      "-c",
      "user.email=himan@example.com",
      "add",
      ".",
    ],
    seedRepoDir,
  );
  runGit(
    [
      "-c",
      "user.name=Himan Bot",
      "-c",
      "user.email=himan@example.com",
      "commit",
      "-m",
      "Initial commit",
    ],
    seedRepoDir,
  );
  runGit(["init", "--bare", "--initial-branch=main"], mockedRemoteDir);
  runGit(["remote", "add", "origin", mockedRemoteDir], seedRepoDir);
  runGit(["push", "-u", "origin", "main"], seedRepoDir);

  const build = spawnSync("pnpm", ["run", "build"], {
    cwd: process.cwd(),
    encoding: "utf8",
  });
  expect(build.status).toBe(0);
});

afterAll(async () => {
  if (tmpRoot) {
    await fs.rm(tmpRoot, { recursive: true, force: true });
  }
});

describe("CLI commands with external git source", () => {
  it("prints package version with -v and documents the shortcut in help", () => {
    const versionResult = runCli(["-v"], projectDir, homeDir);
    expect(versionResult.status).toBe(0);
    expect(versionResult.stdout.trim()).toMatch(/^\d+\.\d+\.\d+/);

    const helpResult = runCli(["--help"], projectDir, homeDir);
    expect(helpResult.status).toBe(0);
    expect(helpResult.stdout).toContain("-v, --version");
    expect(helpResult.stdout).not.toContain("-V, --version");
  });

  it("reports doctor errors before init", async () => {
    const doctorHomeDir = path.join(tmpRoot, "doctor-home");
    const doctorProjectDir = path.join(tmpRoot, "doctor-project");
    await fs.mkdir(doctorHomeDir, { recursive: true });
    await fs.mkdir(doctorProjectDir, { recursive: true });

    const result = runCli(["doctor", "--json"], doctorProjectDir, doctorHomeDir);
    expect(result.status).toBe(1);

    const payload = JSON.parse(result.stdout) as {
      ok: boolean;
      checks: Array<{ name: string; status: string; message: string }>;
    };
    expect(payload.ok).toBe(false);
    expect(payload.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "source",
          status: "error",
        }),
      ]),
    );
    expect(
      payload.checks.find((check) => check.name === "source")?.message,
    ).toContain("himan init");
  });

  it("initializes from the given test repository", async () => {
    const result = runCli(["init", TEST_REPO], projectDir, homeDir);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Initialized git source");

    const configPath = path.join(homeDir, ".himan", "config.json");
    await expect(fs.access(configPath)).resolves.toBeUndefined();
    await expect(fs.access(repoDir)).resolves.toBeUndefined();
  });

  it("creates source-level docs without overwriting existing files", async () => {
    const result = runCli(
      ["source", "init-docs", "--json"],
      projectDir,
      homeDir,
    );
    expect(result.status).toBe(0);

    const payload = JSON.parse(result.stdout) as {
      sourceDir: string;
      dryRun: boolean;
      committed: boolean;
      files: Array<{ path: string; action: string; reason?: string }>;
    };
    expect(payload.sourceDir).toBe(repoDir);
    expect(payload.dryRun).toBe(false);
    expect(payload.committed).toBe(true);
    expect(payload.files).toEqual([
      {
        path: path.join(repoDir, "README.md"),
        action: "skipped",
        reason: "file already exists",
      },
      {
        path: path.join(repoDir, "CHANGELOG.md"),
        action: "created",
      },
    ]);

    await expect(fs.readFile(path.join(repoDir, "README.md"), "utf8")).resolves.toBe(
      "# himan-test\n",
    );
    await expect(
      fs.readFile(path.join(repoDir, "CHANGELOG.md"), "utf8"),
    ).resolves.toContain("All notable source-level resource changes");
    expect(runGitOutput(["status", "--short"], repoDir)).toBe("");
    expect(runGitOutput(["show", "origin/main:CHANGELOG.md"], repoDir)).toContain(
      "All notable source-level resource changes",
    );

    const dryRun = runCli(
      ["source", "init-docs", "--force", "--dry-run", "--json"],
      projectDir,
      homeDir,
    );
    expect(dryRun.status).toBe(0);
    const dryRunPayload = JSON.parse(dryRun.stdout) as {
      dryRun: boolean;
      committed: boolean;
      files: Array<{ action: string }>;
    };
    expect(dryRunPayload.dryRun).toBe(true);
    expect(dryRunPayload.committed).toBe(false);
    expect(dryRunPayload.files.map((file) => file.action)).toEqual([
      "updated",
      "updated",
    ]);
    await expect(fs.readFile(path.join(repoDir, "README.md"), "utf8")).resolves.toBe(
      "# himan-test\n",
    );
  });

  it("manages multiple sources and switches default source", () => {
    const addResult = runCli(["source", "add", "mirror", TEST_REPO], projectDir, homeDir);
    expect(addResult.status).toBe(0);
    expect(addResult.stdout).toContain("Added source mirror as mirror");

    const listResult = runCli(["source", "list", "--json"], projectDir, homeDir);
    expect(listResult.status).toBe(0);
    const sources = JSON.parse(listResult.stdout) as Array<{
      name: string;
      alias?: string;
      repo?: string;
      isDefault: boolean;
    }>;
    expect(sources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "default", isDefault: true }),
        expect.objectContaining({ name: "mirror", alias: "mirror", repo: TEST_REPO }),
      ]),
    );

    const useWithoutDefaultAlias = runCli(
      ["source", "use", "mirror"],
      projectDir,
      homeDir,
    );
    expect(useWithoutDefaultAlias.status).toBe(1);
    expect(useWithoutDefaultAlias.stderr).toContain("has no alias");

    const aliasDefault = runCli(
      ["source", "alias", "default", "primary"],
      projectDir,
      homeDir,
    );
    expect(aliasDefault.status).toBe(0);
    expect(aliasDefault.stdout).toContain("Aliased source default as primary");

    const useResult = runCli(["source", "use", "mirror"], projectDir, homeDir);
    expect(useResult.status).toBe(0);
    expect(useResult.stdout).toContain("Using source: mirror (mirror)");

    const listAfterUse = runCli(["source", "list", "--json"], projectDir, homeDir);
    expect(listAfterUse.status).toBe(0);
    const sourcesAfterUse = JSON.parse(listAfterUse.stdout) as Array<{
      name: string;
      isDefault: boolean;
    }>;
    expect(sourcesAfterUse).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: "mirror", isDefault: true })]),
    );
  });

  it("uses source aliases for explicit resource commands", async () => {
    const aliasHomeDir = path.join(tmpRoot, "alias-home");
    const aliasProjectDir = path.join(tmpRoot, "alias-project");
    const primaryRemote = await createSingleRuleRemote(
      "alias-primary",
      "primary-rule",
      "1.0.0",
      "primary source rule",
      "from primary source",
    );
    const teamRemote = await createSingleRuleRemote(
      "alias-team",
      "team-rule",
      "2.0.0",
      "team source rule",
      "from team source",
    );
    await fs.mkdir(aliasHomeDir, { recursive: true });
    await fs.mkdir(aliasProjectDir, { recursive: true });

    expect(runCli(["init", primaryRemote], aliasProjectDir, aliasHomeDir).status).toBe(0);
    expect(
      runCli(["source", "add", "team-source", teamRemote, "--alias", "team"], aliasProjectDir, aliasHomeDir)
        .status,
    ).toBe(0);
    expect(
      runCli(["source", "alias", "default", "primary"], aliasProjectDir, aliasHomeDir)
        .status,
    ).toBe(0);

    const primaryList = runCli(
      ["list", "rule", "--source", "primary", "--json"],
      aliasProjectDir,
      aliasHomeDir,
    );
    expect(primaryList.status).toBe(0);
    expect(JSON.parse(primaryList.stdout)).toEqual([
      expect.objectContaining({ name: "primary-rule" }),
    ]);

    const teamList = runCli(
      ["list", "rule", "--source", "team", "--json"],
      aliasProjectDir,
      aliasHomeDir,
    );
    expect(teamList.status).toBe(0);
    expect(JSON.parse(teamList.stdout)).toEqual([
      expect.objectContaining({ name: "team-rule" }),
    ]);

    const installTeam = runCli(
      ["install", "rule", "team-rule@2.0.0", "--source", "team"],
      aliasProjectDir,
      aliasHomeDir,
    );
    expect(installTeam.status).toBe(0);
    await expect(
      fs.readFile(
        path.join(aliasProjectDir, ".cursor", "rules", "team-rule", "content.md"),
        "utf8",
      ),
    ).resolves.toContain("from team source");

    const lock = JSON.parse(
      await fs.readFile(path.join(aliasProjectDir, "himan.lock"), "utf8"),
    ) as { source: { name?: string; repo?: string } };
    expect(lock.source).toEqual(
      expect.objectContaining({ name: "team", repo: teamRemote }),
    );

    const createPublish = runCli(
      ["create", "rule", "team-publish"],
      aliasProjectDir,
      aliasHomeDir,
    );
    expect(createPublish.status).toBe(0);
    await fs.appendFile(
      path.join(aliasProjectDir, ".cursor", "rules", "team-publish", "content.md"),
      "published to team source by alias\n",
      "utf8",
    );

    const publishTeam = runCli(
      ["publish", "rule", "team-publish", "--source", "team", "--patch"],
      aliasProjectDir,
      aliasHomeDir,
    );
    expect(publishTeam.status).toBe(0);
    expect(publishTeam.stdout).toContain("Published rule/team-publish@0.0.1");

    const teamHistory = runCli(
      ["history", "rule", "team-publish", "--source", "team", "--json"],
      aliasProjectDir,
      aliasHomeDir,
    );
    expect(teamHistory.status).toBe(0);
    expect(JSON.parse(teamHistory.stdout)).toEqual([
      { version: "0.0.1", raw: "rule/team-publish@0.0.1" },
    ]);

    const primaryHistory = runCli(
      ["history", "rule", "team-publish", "--source", "primary", "--json"],
      aliasProjectDir,
      aliasHomeDir,
    );
    expect(primaryHistory.status).toBe(0);
    expect(JSON.parse(primaryHistory.stdout)).toEqual([]);
  }, 20000);

  it("returns empty list and history before resources are prepared", () => {
    const allListResult = runCli(["list", "--json"], projectDir, homeDir);
    expect(allListResult.status).toBe(0);
    expect(JSON.parse(allListResult.stdout)).toEqual({
      rule: [],
      command: [],
      skill: [],
    });

    const listResult = runCli(["list", "rule", "--json"], projectDir, homeDir);
    expect(listResult.status).toBe(0);
    expect(JSON.parse(listResult.stdout)).toEqual([]);

    const installedListResult = runCli(["project", "list", "--json"], projectDir, homeDir);
    expect(installedListResult.status).toBe(0);
    expect(JSON.parse(installedListResult.stdout)).toEqual({
      rule: [],
      command: [],
      skill: [],
    });

    const installedAliasResult = runCli(["list", "--installed", "--json"], projectDir, homeDir);
    expect(installedAliasResult.status).toBe(0);
    expect(JSON.parse(installedAliasResult.stdout)).toEqual({
      rule: [],
      command: [],
      skill: [],
    });

    const historyResult = runCli(
      ["history", "rule", "code-review", "--json"],
      projectDir,
      homeDir,
    );
    expect(historyResult.status).toBe(0);
    expect(JSON.parse(historyResult.stdout)).toEqual([]);
  });

  it("returns structured json for CLI usage errors", () => {
    const result = runCli(["history", "rule", "--json"], projectDir, homeDir);
    expect(result.status).toBe(1);
    const payload = JSON.parse(result.stderr) as {
      ok: boolean;
      error: {
        code: string;
        message: string;
        details?: { commanderCode?: string; exitCode?: number };
      };
    };
    expect(payload.ok).toBe(false);
    expect(payload.error.code).toBe("E_CLI_USAGE");
    expect(payload.error.message).toContain("missing required argument");
    expect(payload.error.details?.commanderCode).toBe("commander.missingArgument");
  });

  it("returns unsupported resource type code for invalid type", () => {
    const result = runCli(["list", "unknown-type", "--json"], projectDir, homeDir);
    expect(result.status).toBe(1);
    const payload = JSON.parse(result.stderr) as {
      ok: boolean;
      error: { code: string; message: string };
    };
    expect(payload.ok).toBe(false);
    expect(payload.error.code).toBe("E_UNSUPPORTED_RESOURCE_TYPE");
    expect(payload.error.message).toContain("Unsupported resource type");
  });

  it("returns invalid input code for unsupported install mode", () => {
    const result = runCli(
      ["install", "rule", "code-review@1.0.0", "--mode", "mirror"],
      projectDir,
      homeDir,
    );
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("[E_INVALID_INPUT]");
    expect(result.stderr).toContain("Unsupported install mode");
  });

  it("returns cli usage code when publish release options conflict", () => {
    const result = runCli(
      ["publish", "rule", "code-review", "--patch", "--minor"],
      projectDir,
      homeDir,
    );
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("[E_CLI_USAGE]");
    expect(result.stderr).toContain("Use only one of --patch, --minor or --major");
  });

  it("returns cli usage code for incomplete install arguments", () => {
    const result = runCli(["install", "rule"], projectDir, homeDir);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("[E_CLI_USAGE]");
    expect(result.stderr).toContain("Install usage");
  });

  it("returns cli usage code for global install without a resource", () => {
    const result = runCli(["install", "-g"], projectDir, homeDir);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("[E_CLI_USAGE]");
    expect(result.stderr).toContain("Global install requires a resource");
  });

  it("configures default agents globally and for current project", async () => {
    const supported = runCli(["agent", "list", "--json"], projectDir, homeDir);
    expect(supported.status).toBe(0);
    expect(JSON.parse(supported.stdout)).toEqual([
      "cursor",
      "claude-code",
      "codex",
      "openclaw",
    ]);

    const globalUse = runCli(
      ["agent", "use", "codex", "-g", "--json"],
      projectDir,
      homeDir,
    );
    expect(globalUse.status).toBe(0);
    expect(JSON.parse(globalUse.stdout)).toEqual({
      scope: "global",
      agents: ["codex"],
    });

    const projectUse = runCli(
      ["agent", "use", "open-claw", "--project"],
      projectDir,
      homeDir,
    );
    expect(projectUse.status).toBe(0);
    expect(projectUse.stdout).toContain("Using agents (project): openclaw");

    const current = runCli(["agent", "current", "--json"], projectDir, homeDir);
    expect(current.status).toBe(0);
    expect(JSON.parse(current.stdout)).toEqual({
      global: ["codex"],
      project: ["openclaw"],
      effective: ["openclaw"],
      supported: ["cursor", "claude-code", "codex", "openclaw"],
    });

    const createResult = runCli(
      ["create", "rule", "project-default-agent"],
      projectDir,
      homeDir,
    );
    expect(createResult.status).toBe(0);
    const meta = await fs.readFile(
      path.join(projectDir, ".openclaw", "rules", "project-default-agent", "himan.yaml"),
      "utf8",
    );
    expect(meta).toContain("agents:");
    expect(meta).toContain("- openclaw");

    expect(runCli(["agent", "clear", "--project"], projectDir, homeDir).status).toBe(0);
    expect(runCli(["agent", "clear", "-g"], projectDir, homeDir).status).toBe(0);
  });

  it("creates local index cache when listing resources", async () => {
    const listResult = runCli(["list", "rule", "--json"], projectDir, homeDir);
    expect(listResult.status).toBe(0);

    const indexPath = path.join(homeDir, ".himan", "index.json");
    const raw = await fs.readFile(indexPath, "utf8");
    const parsed = JSON.parse(raw) as { version: number; entries: Array<{ type: string }> };
    expect(parsed.version).toBe(1);
    expect(parsed.entries).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: "rule" })]),
    );
  });

  it("creates command scaffold with metadata and supports force", async () => {
    const createResult = runCli(
      [
        "create",
        "command",
        "sync-docs",
        "--description",
        "sync docs command",
        "--agent",
        "cursor,claude",
        "--json",
      ],
      projectDir,
      homeDir,
    );
    expect(createResult.status).toBe(0);

    const payload = JSON.parse(createResult.stdout) as {
      resourceDir: string;
      files: string[];
      dryRun: boolean;
    };
    expect(payload.dryRun).toBe(false);
    expect(payload.resourceDir).toContain(path.join(projectDir, ".cursor", "commands", "sync-docs"));
    await expect(fs.access(path.join(projectDir, ".cursor", "commands", "sync-docs", "himan.yaml"))).resolves
      .toBeUndefined();
    await expect(fs.access(path.join(projectDir, ".cursor", "commands", "sync-docs", "content.md"))).resolves
      .toBeUndefined();
    await expect(fs.access(path.join(projectDir, ".claude", "commands", "sync-docs", "content.md"))).resolves
      .toBeUndefined();

    const createAgain = runCli(["create", "command", "sync-docs"], projectDir, homeDir);
    expect(createAgain.status).toBe(1);
    expect(createAgain.stderr).toContain("Resource already exists");

    const createAgainJson = runCli(
      ["create", "command", "sync-docs", "--json"],
      projectDir,
      homeDir,
    );
    expect(createAgainJson.status).toBe(1);
    const errorPayload = JSON.parse(createAgainJson.stderr) as {
      ok: boolean;
      error: { code: string; message: string };
    };
    expect(errorPayload.ok).toBe(false);
    expect(errorPayload.error.code).toBe("E_RESOURCE_EXISTS");
    expect(errorPayload.error.message).toContain("Resource already exists");

    const createForce = runCli(
      ["create", "command", "sync-docs", "--force"],
      projectDir,
      homeDir,
    );
    expect(createForce.status).toBe(0);

    await expect(fs.access(path.join(repoDir, "commands", "sync-docs"))).rejects.toThrow();
  });

  it("supports dry-run for skill create", async () => {
    const dryRun = runCli(
      ["create", "skill", "bug-analysis", "--dry-run", "--json"],
      projectDir,
      homeDir,
    );
    expect(dryRun.status).toBe(0);
    const payload = JSON.parse(dryRun.stdout) as { resourceDir: string; dryRun: boolean };
    expect(payload.dryRun).toBe(true);

    await expect(fs.access(path.join(projectDir, ".cursor", "skills", "bug-analysis"))).rejects.toThrow();

    const createSkill = runCli(["create", "skill", "bug-analysis"], projectDir, homeDir);
    expect(createSkill.status).toBe(0);

    await expect(fs.access(path.join(projectDir, ".cursor", "skills", "bug-analysis", "SKILL.md"))).resolves.toBeUndefined();
  });

  it("publishes create artifact without dev workflow", async () => {
    const createResult = runCli(
      [
        "create",
        "command",
        "release-note",
        "--description",
        "release note command",
      ],
      projectDir,
      homeDir,
    );
    expect(createResult.status).toBe(0);

    const contentPath = path.join(projectDir, ".cursor", "commands", "release-note", "content.md");
    await fs.appendFile(contentPath, "Publish from create artifact.\n", "utf8");

    const publishResult = runCli(
      ["publish", "command", "release-note", "--minor"],
      projectDir,
      homeDir,
    );
    expect(publishResult.status).toBe(0);
    expect(publishResult.stdout).toContain("[publish:prepare]");
    expect(publishResult.stdout).toContain("[publish:install]");
    expect(publishResult.stdout).toContain("Published command/release-note@0.1.0");

    const noChangePublishResult = runCli(
      ["publish", "command", "release-note", "--patch"],
      projectDir,
      homeDir,
    );
    expect(noChangePublishResult.status).toBe(1);
    expect(noChangePublishResult.stderr).toContain("[E_PUBLISH_NO_CHANGES]");
    expect(noChangePublishResult.stderr).toContain(
      "No changes to publish for command/release-note.",
    );
    expect(runGitOutput(["tag", "--list", "command/release-note@0.1.1"], repoDir)).toBe("");

    const historyResult = runCli(
      ["history", "command", "release-note", "--json"],
      projectDir,
      homeDir,
    );
    expect(historyResult.status).toBe(0);
    expect(JSON.parse(historyResult.stdout)).toEqual([
      { version: "0.1.0", raw: "command/release-note@0.1.0" },
    ]);

    const storeContent = await fs.readFile(
      path.join(homeDir, ".himan", "store", "command", "release-note", "0.1.0", "content.md"),
      "utf8",
    );
    expect(storeContent).toContain("Publish from create artifact.");
    await expect(fs.readFile(path.join(repoDir, "README.md"), "utf8")).resolves.toContain(
      "`command/release-note@0.1.0`: release note command",
    );
    await expect(
      fs.readFile(path.join(repoDir, "CHANGELOG.md"), "utf8"),
    ).resolves.toContain("- Published `command/release-note@0.1.0`.");
  });

  it("publishes skill create artifact without dev workflow", async () => {
    const createResult = runCli(
      ["create", "skill", "risk-check", "--description", "risk check skill"],
      projectDir,
      homeDir,
    );
    expect(createResult.status).toBe(0);

    const skillContentPath = path.join(projectDir, ".cursor", "skills", "risk-check", "SKILL.md");
    await fs.appendFile(skillContentPath, "Skill published from create artifact.\n", "utf8");

    const publishResult = runCli(
      ["publish", "skill", "risk-check", "--patch"],
      projectDir,
      homeDir,
    );
    expect(publishResult.status).toBe(0);
    expect(publishResult.stdout).toContain("Published skill/risk-check@0.0.1");

    const historyResult = runCli(
      ["history", "skill", "risk-check", "--json"],
      projectDir,
      homeDir,
    );
    expect(historyResult.status).toBe(0);
    expect(JSON.parse(historyResult.stdout)).toEqual([
      { version: "0.0.1", raw: "skill/risk-check@0.0.1" },
    ]);

    const storedSkillContent = await fs.readFile(
      path.join(homeDir, ".himan", "store", "skill", "risk-check", "0.0.1", "SKILL.md"),
      "utf8",
    );
    expect(storedSkillContent).toContain("Skill published from create artifact.");
  });

  it("supports install and dev for command and skill", async () => {
    const installCommand = runCli(
      ["install", "command", "release-note@0.1.0"],
      projectDir,
      homeDir,
    );
    expect(installCommand.status).toBe(0);
    expect(installCommand.stdout).toContain("Installed command/release-note@0.1.0");

    const commandLinkPath = path.join(projectDir, ".cursor", "commands", "release-note");
    expect((await fs.lstat(commandLinkPath)).isSymbolicLink()).toBe(false);
    await expect(
      fs.readFile(path.join(commandLinkPath, "content.md"), "utf8"),
    ).resolves.toContain("Publish from create artifact.");

    const devCommand = runCli(["dev", "command", "release-note"], projectDir, homeDir);
    expect(devCommand.status).toBe(0);
    expect(devCommand.stdout).toContain("Editing command/release-note in place");

    expect((await fs.lstat(commandLinkPath)).isSymbolicLink()).toBe(false);
    await expect(
      fs.readFile(path.join(commandLinkPath, "content.md"), "utf8"),
    ).resolves.toContain("Publish from create artifact.");
    await expect(
      fs.access(path.join(projectDir, ".himan", "dev", "command", "release-note")),
    ).rejects.toThrow();

    const installSkill = runCli(["install", "skill", "risk-check@0.0.1"], projectDir, homeDir);
    expect(installSkill.status).toBe(0);
    expect(installSkill.stdout).toContain("Installed skill/risk-check@0.0.1");

    const skillLinkPath = path.join(projectDir, ".cursor", "skills", "risk-check");
    expect((await fs.lstat(skillLinkPath)).isSymbolicLink()).toBe(false);
    await expect(
      fs.readFile(path.join(skillLinkPath, "SKILL.md"), "utf8"),
    ).resolves.toContain("Skill published from create artifact.");

    const devSkill = runCli(["dev", "skill", "risk-check"], projectDir, homeDir);
    expect(devSkill.status).toBe(0);
    expect(devSkill.stdout).toContain("Editing skill/risk-check in place");

    expect((await fs.lstat(skillLinkPath)).isSymbolicLink()).toBe(false);
    await expect(
      fs.readFile(path.join(skillLinkPath, "SKILL.md"), "utf8"),
    ).resolves.toContain("Skill published from create artifact.");
    await expect(
      fs.access(path.join(projectDir, ".himan", "dev", "skill", "risk-check")),
    ).rejects.toThrow();
  });

  it("switches an existing Codex skill directory to dev mode", async () => {
    const codexHome = path.join(tmpRoot, "codex-local-home");
    const codexProject = path.join(tmpRoot, "codex-local-project");
    const skillPath = path.join(
      codexProject,
      ".agents",
      "skills",
      "common-project-startup",
    );
    await fs.mkdir(skillPath, { recursive: true });
    await fs.mkdir(codexHome, { recursive: true });
    await fs.writeFile(
      path.join(skillPath, "SKILL.md"),
      "---\nname: common-project-startup\n---\n# common-project-startup\n",
      "utf8",
    );

    const devSkill = runCli(
      ["dev", "skill", "common-project-startup"],
      codexProject,
      codexHome,
    );
    expect(devSkill.status).toBe(0);
    expect(devSkill.stdout).toContain(
      "Editing skill/common-project-startup in place",
    );

    await expect(
      fs.readFile(path.join(skillPath, "SKILL.md"), "utf8"),
    ).resolves.toContain("common-project-startup");
    await expect(
      fs.access(path.join(codexProject, ".himan", "dev", "skill", "common-project-startup")),
    ).rejects.toThrow();
  });

  it("supports multi-agent installs for claude-code/codex/openclaw", async () => {
    const createResult = runCli(
      [
        "create",
        "rule",
        "agent-style",
        "--agent",
        "claude code,codex,openclaw",
      ],
      projectDir,
      homeDir,
    );
    expect(createResult.status).toBe(0);

    const publishResult = runCli(
      ["publish", "rule", "agent-style", "--patch"],
      projectDir,
      homeDir,
    );
    expect(publishResult.status).toBe(0);
    expect(publishResult.stdout).toContain("Published rule/agent-style@0.0.1");

    const installResult = runCli(
      ["install", "rule", "agent-style@0.0.1"],
      projectDir,
      homeDir,
    );
    expect(installResult.status).toBe(0);

    const agentStyleTargets = [
      path.join(projectDir, ".claude", "rules", "agent-style"),
      path.join(projectDir, ".agents", "rules", "agent-style"),
      path.join(projectDir, ".openclaw", "rules", "agent-style"),
    ];
    for (const targetPath of agentStyleTargets) {
      expect((await fs.lstat(targetPath)).isSymbolicLink()).toBe(false);
      await expect(
        fs.readFile(path.join(targetPath, "content.md"), "utf8"),
      ).resolves.toContain("Describe rule instructions here.");
    }

    const devResult = runCli(["dev", "rule", "agent-style"], projectDir, homeDir);
    expect(devResult.status).toBe(0);
    expect(devResult.stdout).toContain("Editing rule/agent-style in place");

    const devContent = await fs.readFile(
      path.join(agentStyleTargets[0], "content.md"),
      "utf8",
    );
    for (const targetPath of agentStyleTargets) {
      expect((await fs.lstat(targetPath)).isSymbolicLink()).toBe(false);
      await expect(fs.readFile(path.join(targetPath, "content.md"), "utf8")).resolves.toBe(
        devContent,
      );
    }
    await expect(
      fs.access(path.join(projectDir, ".himan", "dev", "rule", "agent-style")),
    ).rejects.toThrow();
  });

  it("supports list/history/install/dev after local fixture commit and tag", async () => {
    await prepareRepoFixture(repoDir);

    const listResult = runCli(["list", "rule", "--json"], projectDir, homeDir);
    expect(listResult.status).toBe(0);
    const listed = JSON.parse(listResult.stdout) as Array<Record<string, unknown>>;
    expect(listed).toEqual(
      expect.arrayContaining([
        {
          name: "code-review",
          type: "rule",
          entry: "content.md",
          description: "enforce code review standards",
          agents: ["cursor"],
        },
      ]),
    );

    const groupedListResult = runCli(["list", "--json"], projectDir, homeDir);
    expect(groupedListResult.status).toBe(0);
    const grouped = JSON.parse(groupedListResult.stdout) as Record<
      "rule" | "command" | "skill",
      Array<Record<string, unknown>>
    >;
    expect(grouped.rule).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "code-review", type: "rule" }),
      ]),
    );
    expect(grouped.command).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "release-note", type: "command" }),
      ]),
    );
    expect(grouped.skill).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "risk-check", type: "skill" }),
      ]),
    );

    const groupedTextResult = runCli(["list"], projectDir, homeDir);
    expect(groupedTextResult.status).toBe(0);
    expect(groupedTextResult.stdout).toContain("Rules:\n");
    expect(groupedTextResult.stdout).toContain(
      "- rule/code-review: enforce code review standards",
    );
    expect(groupedTextResult.stdout).toContain("Commands:\n");
    expect(groupedTextResult.stdout).toContain("- command/release-note");
    expect(groupedTextResult.stdout).toContain("Skills:\n");
    expect(groupedTextResult.stdout).toContain("- skill/risk-check");

    const historyResult = runCli(
      ["history", "rule", "code-review", "--json"],
      projectDir,
      homeDir,
    );
    expect(historyResult.status).toBe(0);
    expect(JSON.parse(historyResult.stdout)).toEqual([
      { version: "1.0.0", raw: "rule/code-review@1.0.0" },
    ]);

    const installResult = runCli(
      ["install", "rule", "code-review@1.0.0"],
      projectDir,
      homeDir,
    );
    expect(installResult.status).toBe(0);
    expect(installResult.stdout).toContain("Installed rule/code-review@1.0.0");

    const linkedPath = path.join(projectDir, ".cursor", "rules", "code-review");
    expect((await fs.lstat(linkedPath)).isSymbolicLink()).toBe(false);
    const contentPath = path.join(linkedPath, "content.md");
    const content = await fs.readFile(contentPath, "utf8");
    expect(content).toContain("Follow code review checklist");

    const devResult = runCli(["dev", "rule", "code-review"], projectDir, homeDir);
    expect(devResult.status).toBe(0);
    expect(devResult.stdout).toContain("Editing rule/code-review in place");

    expect((await fs.lstat(linkedPath)).isSymbolicLink()).toBe(false);
    await expect(
      fs.readFile(path.join(linkedPath, "content.md"), "utf8"),
    ).resolves.toContain("Follow code review checklist");
    await expect(
      fs.access(path.join(projectDir, ".himan", "dev", "rule", "code-review")),
    ).rejects.toThrow();
  });

  it("initializes project agent and installs selected resources in one flow", async () => {
    const quickstartProjectDir = path.join(tmpRoot, "quickstart-project");
    await fs.mkdir(quickstartProjectDir, { recursive: true });

    const result = runCli(
      [
        "init",
        TEST_REPO,
        "--agent",
        "codex",
        "--install",
        "rule/code-review@1.0.0",
        "--json",
      ],
      quickstartProjectDir,
      homeDir,
    );
    expect(result.status).toBe(0);

    const payload = JSON.parse(result.stdout) as {
      source: { sourceType: string; repo: string };
      agents: { scope: string; agents: string[] };
      installed: Array<{ type: string; name: string; version: string; mode: string }>;
    };
    expect(payload.source).toEqual(
      expect.objectContaining({ sourceType: "git", repo: TEST_REPO }),
    );
    expect(payload.agents).toEqual({ scope: "project", agents: ["codex"] });
    expect(payload.installed).toEqual([
      expect.objectContaining({
        type: "rule",
        name: "code-review",
        version: "1.0.0",
        mode: "copy",
      }),
    ]);

    const quickstartRulePath = path.join(
      quickstartProjectDir,
      ".agents",
      "rules",
      "code-review",
    );
    expect((await fs.lstat(quickstartRulePath)).isSymbolicLink()).toBe(false);
    await expect(
      fs.readFile(path.join(quickstartRulePath, "content.md"), "utf8"),
    ).resolves.toContain("Follow code review checklist");

    const doctor = runCli(["doctor", "--json"], quickstartProjectDir, homeDir);
    expect(doctor.status).toBe(0);
    const doctorPayload = JSON.parse(doctor.stdout) as {
      ok: boolean;
      checks: Array<{ name: string; status: string }>;
    };
    expect(doctorPayload.ok).toBe(true);
    expect(doctorPayload.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "resources", status: "ok" }),
        expect.objectContaining({ name: "targets", status: "ok" }),
      ]),
    );
  });

  it("can hide descriptions from resource list output", () => {
    const listWithoutDescriptionResult = runCli(
      ["list", "rule", "--brief", "--json"],
      projectDir,
      homeDir,
    );
    expect(listWithoutDescriptionResult.status).toBe(0);
    const listedWithoutDescription = JSON.parse(
      listWithoutDescriptionResult.stdout,
    ) as Array<Record<string, unknown>>;
    expect(listedWithoutDescription).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "code-review", type: "rule" }),
      ]),
    );
    expect(
      listedWithoutDescription.find((item) => item.name === "code-review"),
    ).not.toHaveProperty("description");

    const groupedTextWithoutDescriptionResult = runCli(
      ["list", "--brief"],
      projectDir,
      homeDir,
    );
    expect(groupedTextWithoutDescriptionResult.status).toBe(0);
    expect(groupedTextWithoutDescriptionResult.stdout).toContain("- rule/code-review\n");
    expect(groupedTextWithoutDescriptionResult.stdout).not.toContain(
      "enforce code review standards",
    );
  });

  it("installs globally using the current project's agent config", async () => {
    const globalInstallProjectDir = path.join(tmpRoot, "global-install-project");
    await fs.mkdir(globalInstallProjectDir, { recursive: true });

    const useResult = runCli(["agent", "use", "codex"], globalInstallProjectDir, homeDir);
    expect(useResult.status).toBe(0);

    const result = runCli(
      ["install", "rule", "code-review@1.0.0", "-g"],
      globalInstallProjectDir,
      homeDir,
    );
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Installed global rule/code-review@1.0.0");

    const globalPath = path.join(homeDir, ".agents", "rules", "code-review");
    expect((await fs.lstat(globalPath)).isSymbolicLink()).toBe(false);
    await expect(
      fs.readFile(path.join(globalPath, "content.md"), "utf8"),
    ).resolves.toContain("Follow code review checklist");
    await expect(
      fs.access(path.join(globalInstallProjectDir, ".agents", "rules", "code-review")),
    ).rejects.toThrow();
    await expect(fs.access(path.join(globalInstallProjectDir, "himan.lock"))).rejects.toThrow();
  });

  it("installs globally using the current project's locked resource agent", async () => {
    const lockedAgentProjectDir = path.join(tmpRoot, "locked-agent-global-project");
    await fs.mkdir(lockedAgentProjectDir, { recursive: true });

    const installResult = runCli(
      ["install", "rule", "code-review@1.0.0", "--agent", "claude"],
      lockedAgentProjectDir,
      homeDir,
    );
    expect(installResult.status).toBe(0);

    await fs.rm(
      path.join(lockedAgentProjectDir, ".claude", "rules", "code-review"),
      { recursive: true, force: true },
    );

    const globalResult = runCli(
      ["install", "rule", "code-review@1.0.0", "--global"],
      lockedAgentProjectDir,
      homeDir,
    );
    expect(globalResult.status).toBe(0);
    expect(globalResult.stdout).toContain("Installed global rule/code-review@1.0.0");

    const globalPath = path.join(homeDir, ".claude", "rules", "code-review");
    expect((await fs.lstat(globalPath)).isSymbolicLink()).toBe(false);
    await expect(
      fs.readFile(path.join(globalPath, "content.md"), "utf8"),
    ).resolves.toContain("Follow code review checklist");
    await expect(
      fs.access(path.join(homeDir, ".cursor", "rules", "code-review")),
    ).rejects.toThrow();
  });

  it("copies a global resource into the current project for dev and can publish it globally", async () => {
    const globalEditProjectDir = path.join(tmpRoot, "global-edit-project");
    const globalEditConsumerDir = path.join(tmpRoot, "global-edit-consumer");
    await fs.mkdir(globalEditProjectDir, { recursive: true });
    await fs.mkdir(globalEditConsumerDir, { recursive: true });

    expect(runCli(["agent", "use", "codex"], globalEditProjectDir, homeDir).status).toBe(0);
    expect(
      runCli(["create", "rule", "global-edit", "--agent", "codex"], globalEditProjectDir, homeDir)
        .status,
    ).toBe(0);
    await fs.appendFile(
      path.join(globalEditProjectDir, ".agents", "rules", "global-edit", "content.md"),
      "Initial global-edit publish.\n",
      "utf8",
    );

    const firstPublish = runCli(
      ["publish", "rule", "global-edit", "--patch"],
      globalEditProjectDir,
      homeDir,
    );
    expect(firstPublish.status).toBe(0);
    expect(firstPublish.stdout).toContain("Published rule/global-edit@0.0.1");

    const globalInstall = runCli(
      ["install", "rule", "global-edit@0.0.1", "--global"],
      globalEditProjectDir,
      homeDir,
    );
    expect(globalInstall.status).toBe(0);
    await fs.rm(path.join(globalEditProjectDir, ".agents", "rules", "global-edit"), {
      recursive: true,
      force: true,
    });

    const devGlobal = runCli(["dev", "rule", "global-edit"], globalEditConsumerDir, homeDir);
    expect(devGlobal.status).toBe(0);
    expect(devGlobal.stdout).toContain(
      "Copied global rule/global-edit into current project",
    );
    const projectCopyPath = path.join(
      globalEditConsumerDir,
      ".agents",
      "rules",
      "global-edit",
    );
    await fs.appendFile(
      path.join(projectCopyPath, "content.md"),
      "Published back to global install.\n",
      "utf8",
    );

    const publishGlobal = runCli(
      ["publish", "rule", "global-edit", "--patch", "-g"],
      globalEditConsumerDir,
      homeDir,
    );
    expect(publishGlobal.status).toBe(0);
    expect(publishGlobal.stdout).toContain(
      "Published resource will be installed globally; current project lock will not be updated.",
    );
    expect(publishGlobal.stdout).toContain("Published rule/global-edit@0.0.2");
    await expect(
      fs.readFile(path.join(homeDir, ".agents", "rules", "global-edit", "content.md"), "utf8"),
    ).resolves.toContain("Published back to global install.");
    await expect(fs.access(path.join(globalEditConsumerDir, "himan.lock"))).rejects.toThrow();
  });

  it("filters list by agent via --agent", () => {
    const listClaude = runCli(["list", "rule", "--agent", "claude-code", "--json"], projectDir, homeDir);
    expect(listClaude.status).toBe(0);
    const claudeRules = JSON.parse(listClaude.stdout) as Array<{ name: string }>;
    expect(claudeRules.some((item) => item.name === "agent-style")).toBe(true);
    expect(claudeRules.some((item) => item.name === "code-review")).toBe(false);

    const listCursor = runCli(["list", "rule", "--agent", "cursor", "--json"], projectDir, homeDir);
    expect(listCursor.status).toBe(0);
    const cursorRules = JSON.parse(listCursor.stdout) as Array<{ name: string }>;
    expect(cursorRules.some((item) => item.name === "code-review")).toBe(true);
  });

  it("uses project agent config for install and dev", async () => {
    const useResult = runCli(["agent", "use", "codex"], projectDir, homeDir);
    expect(useResult.status).toBe(0);

    const result = runCli(["install", "rule", "code-review@1.0.0"], projectDir, homeDir);
    expect(result.status).toBe(0);
    const codexRulePath = path.join(projectDir, ".agents", "rules", "code-review");
    expect((await fs.lstat(codexRulePath)).isSymbolicLink()).toBe(false);
    await expect(
      fs.readFile(path.join(codexRulePath, "content.md"), "utf8"),
    ).resolves.toContain("Follow code review checklist");

    const devResult = runCli(["dev", "rule", "code-review"], projectDir, homeDir);
    expect(devResult.status).toBe(0);
    expect((await fs.lstat(codexRulePath)).isSymbolicLink()).toBe(false);
    await expect(
      fs.readFile(path.join(codexRulePath, "content.md"), "utf8"),
    ).resolves.toContain("Follow code review checklist");

    expect(runCli(["agent", "clear", "--project"], projectDir, homeDir).status).toBe(0);
  });

  it("lists resources installed in the current project", () => {
    const projectListResult = runCli(["project", "list", "--json"], projectDir, homeDir);
    expect(projectListResult.status).toBe(0);
    const projectList = JSON.parse(projectListResult.stdout) as Record<
      "rule" | "command" | "skill",
      Array<Record<string, unknown>>
    >;
    expect(projectList.rule).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "rule",
          name: "code-review",
          version: "1.0.0",
          agents: ["codex"],
          mode: "copy",
        }),
      ]),
    );
    expect(projectList.command).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "command",
          name: "release-note",
          version: "0.1.0",
        }),
      ]),
    );
    expect(projectList.skill).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "skill",
          name: "risk-check",
          version: "0.0.1",
        }),
      ]),
    );

    const installedAliasResult = runCli(
      ["list", "rule", "--installed", "--json"],
      projectDir,
      homeDir,
    );
    expect(installedAliasResult.status).toBe(0);
    const installedAlias = JSON.parse(installedAliasResult.stdout) as Array<
      Record<string, unknown>
    >;
    expect(installedAlias).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "rule",
          name: "code-review",
          version: "1.0.0",
          agents: ["codex"],
        }),
      ]),
    );

    const codexRulesResult = runCli(
      ["project", "list", "rule", "--agent", "codex", "--json"],
      projectDir,
      homeDir,
    );
    expect(codexRulesResult.status).toBe(0);
    expect(JSON.parse(codexRulesResult.stdout)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "rule", name: "code-review" }),
      ]),
    );

    const cursorRulesResult = runCli(
      ["project", "list", "rule", "--agent", "cursor", "--json"],
      projectDir,
      homeDir,
    );
    expect(cursorRulesResult.status).toBe(0);
    expect(JSON.parse(cursorRulesResult.stdout)).toEqual([]);

    const projectListText = runCli(["project", "list"], projectDir, homeDir);
    expect(projectListText.status).toBe(0);
    expect(projectListText.stdout).toContain("Rules:\n");
    expect(projectListText.stdout).toContain("- rule/code-review@1.0.0 [codex] (copy)");
  });

  it("writes himan.lock on install and can reproduce installs", async () => {
    const lockPath = path.join(projectDir, "himan.lock");
    const lockRaw = await fs.readFile(lockPath, "utf8");
    const lock = JSON.parse(lockRaw) as {
      version: number;
      source: { type: string };
      resources: Array<{
        type: string;
        name: string;
        version: string;
        agents?: string[];
        mode?: string;
      }>;
    };

    expect(lock.version).toBe(1);
    expect(lock.source.type).toBe("git");
    expect(lock.resources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "rule",
          name: "code-review",
          version: "1.0.0",
          agents: ["codex"],
          mode: "copy",
        }),
        expect.objectContaining({
          type: "command",
          name: "release-note",
          version: "0.1.0",
          mode: "copy",
        }),
        expect.objectContaining({
          type: "skill",
          name: "risk-check",
          version: "0.0.1",
          mode: "copy",
        }),
      ]),
    );

    await fs.rm(path.join(projectDir, ".cursor", "rules", "code-review"), {
      recursive: true,
      force: true,
    });
    await fs.rm(path.join(projectDir, ".agents", "rules", "code-review"), {
      recursive: true,
      force: true,
    });
    await fs.rm(path.join(projectDir, ".cursor", "commands", "release-note"), {
      recursive: true,
      force: true,
    });
    await fs.rm(path.join(projectDir, ".cursor", "skills", "risk-check"), {
      recursive: true,
      force: true,
    });

    const result = runCli(["install"], projectDir, homeDir);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Installed rule/code-review@1.0.0");
    expect(result.stdout).toContain("Installed command/release-note@0.1.0");
    expect(result.stdout).toContain("Installed skill/risk-check@0.0.1");

    const restoredRulePath = path.join(projectDir, ".agents", "rules", "code-review");
    expect((await fs.lstat(restoredRulePath)).isSymbolicLink()).toBe(false);
    await expect(
      fs.readFile(path.join(restoredRulePath, "content.md"), "utf8"),
    ).resolves.toContain("Follow code review checklist");
    const restoredCommandPath = path.join(projectDir, ".cursor", "commands", "release-note");
    expect((await fs.lstat(restoredCommandPath)).isSymbolicLink()).toBe(false);
    await expect(
      fs.readFile(path.join(restoredCommandPath, "content.md"), "utf8"),
    ).resolves.toContain("Publish from create artifact.");
    const restoredSkillPath = path.join(projectDir, ".cursor", "skills", "risk-check");
    expect((await fs.lstat(restoredSkillPath)).isSymbolicLink()).toBe(false);
    await expect(
      fs.readFile(path.join(restoredSkillPath, "SKILL.md"), "utf8"),
    ).resolves.toContain("Skill published from create artifact.");
  });

  it("updates lock and project target after publish when resource is locked", async () => {
    const commandLinkPath = path.join(projectDir, ".cursor", "commands", "release-note");
    await fs.appendFile(path.join(commandLinkPath, "content.md"), "lock sync on publish.\n", "utf8");

    const publishResult = runCli(
      ["publish", "command", "release-note", "--patch"],
      projectDir,
      homeDir,
    );
    expect(publishResult.status).toBe(0);
    expect(publishResult.stdout).toContain("Published command/release-note@0.1.1");

    expect((await fs.lstat(commandLinkPath)).isSymbolicLink()).toBe(false);
    await expect(
      fs.readFile(path.join(commandLinkPath, "content.md"), "utf8"),
    ).resolves.toContain("lock sync on publish.");
    await expect(
      fs.access(path.join(projectDir, ".himan", "dev", "command", "release-note")),
    ).rejects.toThrow();

    const lockRaw = await fs.readFile(path.join(projectDir, "himan.lock"), "utf8");
    const lock = JSON.parse(lockRaw) as {
      resources: Array<{ type: string; name: string; version: string; mode?: string }>;
    };
    expect(lock.resources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "command",
          name: "release-note",
          version: "0.1.1",
          mode: "copy",
        }),
      ]),
    );
  });

  it("keeps store immutable when reinstalling same version", async () => {
    const installResult = runCli(
      ["install", "rule", "code-review@1.0.0"],
      projectDir,
      homeDir,
    );
    expect(installResult.status).toBe(0);

    const contentPath = path.join(
      homeDir,
      ".himan",
      "store",
      "rule",
      "code-review",
      "1.0.0",
      "content.md",
    );
    await fs.writeFile(contentPath, "LOCAL_MUTATION\n", "utf8");

    const reinstallResult = runCli(
      ["install", "rule", "code-review@1.0.0"],
      projectDir,
      homeDir,
    );
    expect(reinstallResult.status).toBe(0);

    const content = await fs.readFile(contentPath, "utf8");
    expect(content).toBe("LOCAL_MUTATION\n");
  });

  it("publishes dev changes and syncs latest version back to store", async () => {
    const devContentPath = path.join(
      projectDir,
      ".cursor",
      "rules",
      "code-review",
      "content.md",
    );
    await fs.appendFile(devContentPath, "Published from dev mode.\n", "utf8");

    const publishResult = runCli(
      ["publish", "rule", "code-review", "--patch"],
      projectDir,
      homeDir,
    );
    expect(publishResult.status).toBe(0);
    expect(publishResult.stdout).toContain("Published rule/code-review@1.0.1");

    const historyResult = runCli(
      ["history", "rule", "code-review", "--json"],
      projectDir,
      homeDir,
    );
    expect(historyResult.status).toBe(0);
    expect(JSON.parse(historyResult.stdout)).toEqual([
      { version: "1.0.1", raw: "rule/code-review@1.0.1" },
      { version: "1.0.0", raw: "rule/code-review@1.0.0" },
    ]);

    const linkedPath = path.join(projectDir, ".cursor", "rules", "code-review");
    const linkedStat = await fs.lstat(linkedPath);
    expect(linkedStat.isSymbolicLink()).toBe(false);
    await expect(
      fs.access(path.join(projectDir, ".himan", "dev", "rule", "code-review")),
    ).rejects.toThrow();

    const publishedContent = await fs.readFile(path.join(linkedPath, "content.md"), "utf8");
    expect(publishedContent).toContain("Published from dev mode.");

    const tags = runGitOutput(["tag", "--list", "rule/code-review@*"], repoDir);
    expect(tags.split("\n").filter(Boolean)).toEqual([
      "rule/code-review@1.0.0",
      "rule/code-review@1.0.1",
    ]);
  });

  it("uses copy install mode by default and restores it from lock", async () => {
    const installResult = runCli(
      ["install", "skill", "risk-check@0.0.1"],
      projectDir,
      homeDir,
    );
    expect(installResult.status).toBe(0);

    const skillPath = path.join(projectDir, ".cursor", "skills", "risk-check");
    const copiedStat = await fs.lstat(skillPath);
    expect(copiedStat.isSymbolicLink()).toBe(false);
    await expect(fs.readFile(path.join(skillPath, "SKILL.md"), "utf8")).resolves.toContain(
      "Skill published from create artifact.",
    );

    const lockRaw = await fs.readFile(path.join(projectDir, "himan.lock"), "utf8");
    const lock = JSON.parse(lockRaw) as {
      resources: Array<{ type: string; name: string; mode?: string }>;
    };
    expect(lock.resources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "skill",
          name: "risk-check",
          mode: "copy",
        }),
      ]),
    );

    await fs.rm(skillPath, { recursive: true, force: true });

    const restoreResult = runCli(["install"], projectDir, homeDir);
    expect(restoreResult.status).toBe(0);
    expect(restoreResult.stdout).toContain("Installed skill/risk-check@0.0.1");

    const restoredStat = await fs.lstat(skillPath);
    expect(restoredStat.isSymbolicLink()).toBe(false);
  });

  it("supports explicit link install mode and restores it from lock", async () => {
    const linkModeProjectDir = path.join(tmpRoot, "link-mode-project");
    await fs.mkdir(linkModeProjectDir, { recursive: true });

    const installResult = runCli(
      ["install", "rule", "code-review@1.0.0", "--mode", "link"],
      linkModeProjectDir,
      homeDir,
    );
    expect(installResult.status).toBe(0);

    const rulePath = path.join(linkModeProjectDir, ".cursor", "rules", "code-review");
    expect((await fs.lstat(rulePath)).isSymbolicLink()).toBe(true);
    await expect(fs.realpath(rulePath)).resolves.toContain(
      path.join(homeDir, ".himan", "store", "rule", "code-review", "1.0.0"),
    );

    const lockRaw = await fs.readFile(path.join(linkModeProjectDir, "himan.lock"), "utf8");
    const lock = JSON.parse(lockRaw) as {
      resources: Array<{ type: string; name: string; mode?: string }>;
    };
    expect(lock.resources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "rule",
          name: "code-review",
          mode: "link",
        }),
      ]),
    );

    await fs.rm(rulePath, { recursive: true, force: true });

    const restoreResult = runCli(["install"], linkModeProjectDir, homeDir);
    expect(restoreResult.status).toBe(0);
    expect(restoreResult.stdout).toContain("Installed rule/code-review@1.0.0");
    expect((await fs.lstat(rulePath)).isSymbolicLink()).toBe(true);
  });

  it("uninstalls resource and removes it from lock", async () => {
    const uninstallResult = runCli(
      ["uninstall", "skill", "risk-check"],
      projectDir,
      homeDir,
    );
    expect(uninstallResult.status).toBe(0);
    expect(uninstallResult.stdout).toContain("Uninstalled skill/risk-check");

    await expect(
      fs.realpath(path.join(projectDir, ".cursor", "skills", "risk-check")),
    ).rejects.toThrow();

    const lockRaw = await fs.readFile(path.join(projectDir, "himan.lock"), "utf8");
    const lock = JSON.parse(lockRaw) as {
      resources: Array<{ type: string; name: string; version: string }>;
    };
    expect(
      lock.resources.some((item) => item.type === "skill" && item.name === "risk-check"),
    ).toBe(false);
  });

  it("renames a resource and migrates the current project lock", async () => {
    const renameHomeDir = path.join(tmpRoot, "rename-home");
    const renameProjectDir = path.join(tmpRoot, "rename-project");
    const renameRemoteDir = await createSingleRuleRemote(
      "rename-resource",
      "rename-me",
      "1.0.0",
      "rename test rule",
      "Rename me content.",
    );
    await fs.mkdir(renameHomeDir, { recursive: true });
    await fs.mkdir(renameProjectDir, { recursive: true });

    expect(runCli(["init", renameRemoteDir], renameProjectDir, renameHomeDir).status).toBe(0);
    const installResult = runCli(
      ["install", "rule", "rename-me@1.0.0", "--agent", "codex"],
      renameProjectDir,
      renameHomeDir,
    );
    expect(installResult.status).toBe(0);

    const dryRun = runCli(
      ["rename", "rule", "rename-me", "renamed-rule", "--dry-run", "--json"],
      renameProjectDir,
      renameHomeDir,
    );
    expect(dryRun.status).toBe(0);
    expect(JSON.parse(dryRun.stdout)).toEqual(
      expect.objectContaining({
        type: "rule",
        oldName: "rename-me",
        newName: "renamed-rule",
        dryRun: true,
        projectMigrated: false,
      }),
    );
    await expect(
      fs.access(path.join(renameProjectDir, ".agents", "rules", "renamed-rule")),
    ).rejects.toThrow();

    const renameResult = runCli(
      ["resource", "rename", "rule", "rename-me", "renamed-rule", "--json"],
      renameProjectDir,
      renameHomeDir,
    );
    expect(renameResult.status).toBe(0);
    expect(JSON.parse(renameResult.stdout)).toEqual(
      expect.objectContaining({
        type: "rule",
        oldName: "rename-me",
        newName: "renamed-rule",
        latestVersion: "1.0.0",
        tag: "rule/renamed-rule@1.0.0",
        projectMigrated: true,
      }),
    );

    await expect(
      fs.access(path.join(renameProjectDir, ".agents", "rules", "rename-me")),
    ).rejects.toThrow();
    const renamedPath = path.join(renameProjectDir, ".agents", "rules", "renamed-rule");
    expect((await fs.lstat(renamedPath)).isSymbolicLink()).toBe(false);
    await expect(fs.readFile(path.join(renamedPath, "content.md"), "utf8")).resolves.toContain(
      "Rename me content.",
    );

    const listResult = runCli(["list", "rule", "--json"], renameProjectDir, renameHomeDir);
    expect(listResult.status).toBe(0);
    const listed = JSON.parse(listResult.stdout) as Array<{ name: string }>;
    expect(listed.some((item) => item.name === "renamed-rule")).toBe(true);
    expect(listed.some((item) => item.name === "rename-me")).toBe(false);

    const lockRaw = await fs.readFile(path.join(renameProjectDir, "himan.lock"), "utf8");
    const lock = JSON.parse(lockRaw) as {
      resources: Array<{ type: string; name: string; version: string; agents?: string[]; mode?: string }>;
    };
    expect(lock.resources).toEqual([
      expect.objectContaining({
        type: "rule",
        name: "renamed-rule",
        version: "1.0.0",
        agents: ["codex"],
        mode: "copy",
      }),
    ]);

    await fs.rm(renamedPath, { recursive: true, force: true });
    const restoreResult = runCli(["install"], renameProjectDir, renameHomeDir);
    expect(restoreResult.status).toBe(0);
    expect(restoreResult.stdout).toContain("Installed rule/renamed-rule@1.0.0");
    await expect(fs.readFile(path.join(renamedPath, "content.md"), "utf8")).resolves.toContain(
      "Rename me content.",
    );
  });

  it("archives source resources and requires an explicit flag for direct installs", async () => {
    const archiveHomeDir = path.join(tmpRoot, "archive-home");
    const archiveProjectDir = path.join(tmpRoot, "archive-project");
    const archiveRemoteDir = await createSingleRuleRemote(
      "archive-source",
      "archive-me",
      "1.0.0",
      "archive test rule",
      "Archive me content.",
    );
    await fs.mkdir(archiveHomeDir, { recursive: true });
    await fs.mkdir(archiveProjectDir, { recursive: true });

    expect(runCli(["init", archiveRemoteDir], archiveProjectDir, archiveHomeDir).status).toBe(0);
    const installResult = runCli(
      ["install", "rule", "archive-me@1.0.0", "--agent", "codex"],
      archiveProjectDir,
      archiveHomeDir,
    );
    expect(installResult.status).toBe(0);

    const archiveResult = runCli(
      [
        "resource",
        "archive",
        "rule",
        "archive-me",
        "--reason",
        "superseded",
        "--json",
      ],
      archiveProjectDir,
      archiveHomeDir,
    );
    expect(archiveResult.status).toBe(0);
    expect(JSON.parse(archiveResult.stdout)).toEqual(
      expect.objectContaining({
        type: "rule",
        name: "archive-me",
        archiveReason: "superseded",
        committed: true,
        dryRun: false,
      }),
    );

    const activeList = runCli(
      ["list", "rule", "--json"],
      archiveProjectDir,
      archiveHomeDir,
    );
    expect(activeList.status).toBe(0);
    expect(JSON.parse(activeList.stdout)).toEqual([]);

    const archivedList = runCli(
      ["list", "rule", "--archived", "--json"],
      archiveProjectDir,
      archiveHomeDir,
    );
    expect(archivedList.status).toBe(0);
    expect(JSON.parse(archivedList.stdout)).toEqual([
      expect.objectContaining({
        name: "archive-me",
        archived: true,
        archiveReason: "superseded",
      }),
    ]);

    const installPath = path.join(archiveProjectDir, ".agents", "rules", "archive-me");
    await fs.rm(installPath, { recursive: true, force: true });
    const directInstall = runCli(
      ["install", "rule", "archive-me@1.0.0", "--agent", "codex"],
      archiveProjectDir,
      archiveHomeDir,
    );
    expect(directInstall.status).toBe(1);
    expect(directInstall.stderr).toContain("E_RESOURCE_ARCHIVED");
    await expect(fs.access(installPath)).rejects.toThrow();

    const explicitInstall = runCli(
      [
        "install",
        "rule",
        "archive-me@1.0.0",
        "--agent",
        "codex",
        "--include-archived",
      ],
      archiveProjectDir,
      archiveHomeDir,
    );
    expect(explicitInstall.status).toBe(0);
    await expect(fs.readFile(path.join(installPath, "content.md"), "utf8")).resolves.toContain(
      "Archive me content.",
    );

    await fs.rm(installPath, { recursive: true, force: true });
    const restoreFromLock = runCli(["install"], archiveProjectDir, archiveHomeDir);
    expect(restoreFromLock.status).toBe(0);
    expect(restoreFromLock.stdout).toContain("Installed rule/archive-me@1.0.0");
    await expect(fs.readFile(path.join(installPath, "content.md"), "utf8")).resolves.toContain(
      "Archive me content.",
    );

    const doctor = runCli(["doctor", "--json"], archiveProjectDir, archiveHomeDir);
    expect(doctor.status).toBe(0);
    const doctorPayload = JSON.parse(doctor.stdout) as {
      checks: Array<{ name: string; status: string; details?: { resources?: string[] } }>;
    };
    expect(doctorPayload.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "archive",
          status: "warn",
          details: { resources: ["rule/archive-me@1.0.0"] },
        }),
      ]),
    );

    const restoreResult = runCli(
      ["resource", "restore", "rule", "archive-me", "--json"],
      archiveProjectDir,
      archiveHomeDir,
    );
    expect(restoreResult.status).toBe(0);
    expect(JSON.parse(restoreResult.stdout)).toEqual(
      expect.objectContaining({
        type: "rule",
        name: "archive-me",
        committed: true,
        dryRun: false,
      }),
    );
    const restoredList = runCli(
      ["list", "rule", "--json"],
      archiveProjectDir,
      archiveHomeDir,
    );
    expect(restoredList.status).toBe(0);
    expect(JSON.parse(restoredList.stdout)).toEqual([
      expect.objectContaining({ name: "archive-me" }),
    ]);
  }, 15_000);

  it("clones a git source into an empty target source", async () => {
    const cloneHomeDir = path.join(tmpRoot, "clone-home");
    const cloneProjectDir = path.join(tmpRoot, "clone-project");
    const cloneSourceRemote = await createSingleRuleRemote(
      "clone-source",
      "clone-me",
      "1.2.3",
      "clone source rule",
      "Clone me content.",
    );
    const cloneTargetRemote = path.join(tmpRoot, "clone-target.git");
    await fs.mkdir(cloneHomeDir, { recursive: true });
    await fs.mkdir(cloneProjectDir, { recursive: true });
    await fs.mkdir(cloneTargetRemote, { recursive: true });
    runGit(["init", "--bare", "--initial-branch=main"], cloneTargetRemote);

    const cloneResult = runCli(
      [
        "source",
        "clone",
        cloneSourceRemote,
        cloneTargetRemote,
        "--add-source",
        "cloned-source",
        "--use",
        "--json",
      ],
      cloneProjectDir,
      cloneHomeDir,
    );
    expect(cloneResult.status).toBe(0);
    expect(JSON.parse(cloneResult.stdout)).toEqual(
      expect.objectContaining({
        branch: "main",
        targetBranch: "main",
        tags: ["rule/clone-me@1.2.3"],
        pushed: true,
        addedSource: "cloned-source",
        usedSource: "cloned-source",
      }),
    );

    const historyResult = runCli(
      ["history", "rule", "clone-me", "--json"],
      cloneProjectDir,
      cloneHomeDir,
    );
    expect(historyResult.status).toBe(0);
    expect(JSON.parse(historyResult.stdout)).toEqual([
      {
        raw: "rule/clone-me@1.2.3",
        version: "1.2.3",
      },
    ]);
    expect(runGitOutput(["tag", "--list", "rule/clone-me@1.2.3"], cloneTargetRemote)).toBe(
      "rule/clone-me@1.2.3",
    );
  });

  it("syncs latest source resource snapshots into a target source", async () => {
    const syncHomeDir = path.join(tmpRoot, "sync-home");
    const syncProjectDir = path.join(tmpRoot, "sync-project");
    const syncSourceRemote = await createSingleRuleRemote(
      "sync-source",
      "sync-me",
      "2.3.4",
      "sync source rule",
      "Sync me content.",
    );
    const syncTargetRemote = path.join(tmpRoot, "sync-target.git");
    await fs.mkdir(syncHomeDir, { recursive: true });
    await fs.mkdir(syncProjectDir, { recursive: true });
    await fs.mkdir(syncTargetRemote, { recursive: true });
    runGit(["init", "--bare", "--initial-branch=main"], syncTargetRemote);

    const syncResult = runCli(
      [
        "source",
        "sync",
        syncSourceRemote,
        syncTargetRemote,
        "--add-source",
        "synced-source",
        "--use",
        "--json",
      ],
      syncProjectDir,
      syncHomeDir,
    );
    expect(syncResult.status).toBe(0);
    expect(JSON.parse(syncResult.stdout)).toEqual(
      expect.objectContaining({
        targetBranch: "main",
        committed: true,
        pushed: true,
        addedSource: "synced-source",
        usedSource: "synced-source",
        resources: [
          {
            type: "rule",
            name: "sync-me",
            version: "2.3.4",
            tag: "rule/sync-me@2.3.4",
            action: "created",
          },
        ],
      }),
    );

    const historyResult = runCli(
      ["history", "rule", "sync-me", "--json"],
      syncProjectDir,
      syncHomeDir,
    );
    expect(historyResult.status).toBe(0);
    expect(JSON.parse(historyResult.stdout)).toEqual([
      {
        raw: "rule/sync-me@2.3.4",
        version: "2.3.4",
      },
    ]);
    expect(runGitOutput(["show", "main:rules/sync-me/content.md"], syncTargetRemote)).toContain(
      "Sync me content.",
    );
  });
});

function runCli(args: string[], cwd: string, home: string) {
  return spawnSync("node", [cliEntry, ...args], {
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      HOME: home,
      GIT_AUTHOR_NAME: "Himan Bot",
      GIT_AUTHOR_EMAIL: "himan@example.com",
      GIT_COMMITTER_NAME: "Himan Bot",
      GIT_COMMITTER_EMAIL: "himan@example.com",
      GIT_CONFIG_COUNT: "1",
      GIT_CONFIG_KEY_0: `url.file://${mockedRemoteDir}/.insteadOf`,
      GIT_CONFIG_VALUE_0: TEST_REPO,
    },
  });
}

async function prepareRepoFixture(targetRepoDir: string): Promise<void> {
  const ruleDir = path.join(targetRepoDir, "rules", "code-review");
  await fs.mkdir(ruleDir, { recursive: true });
  await fs.writeFile(
    path.join(ruleDir, "himan.yaml"),
    [
      "name: code-review",
      "type: rule",
      "version: 1.0.0",
      "entry: content.md",
      "description: enforce code review standards",
      "agents:",
      "  - cursor",
    ].join("\n"),
    "utf8",
  );
  await fs.writeFile(
    path.join(ruleDir, "content.md"),
    "Follow code review checklist.\n",
    "utf8",
  );

  runGit(
    [
      "-c",
      "user.name=Himan Bot",
      "-c",
      "user.email=himan@example.com",
      "add",
      ".",
    ],
    targetRepoDir,
  );
  runGit(
    [
      "-c",
      "user.name=Himan Bot",
      "-c",
      "user.email=himan@example.com",
      "commit",
      "-m",
      "Add code-review rule fixture",
    ],
    targetRepoDir,
  );
  runGit(["tag", "-f", "rule/code-review@1.0.0"], targetRepoDir);
}

async function createSingleRuleRemote(
  label: string,
  name: string,
  version: string,
  description: string,
  content: string,
): Promise<string> {
  const seedDir = path.join(tmpRoot, `${label}-seed`);
  const remoteDir = path.join(tmpRoot, `${label}.git`);
  const ruleDir = path.join(seedDir, "rules", name);

  await fs.mkdir(ruleDir, { recursive: true });
  await fs.mkdir(remoteDir, { recursive: true });
  await fs.writeFile(
    path.join(ruleDir, "himan.yaml"),
    [
      `name: ${name}`,
      "type: rule",
      `version: ${version}`,
      "entry: content.md",
      `description: ${description}`,
      "agents:",
      "  - cursor",
    ].join("\n"),
    "utf8",
  );
  await fs.writeFile(path.join(ruleDir, "content.md"), `${content}\n`, "utf8");

  runGit(["init", "--initial-branch=main"], seedDir);
  runGit(
    [
      "-c",
      "user.name=Himan Bot",
      "-c",
      "user.email=himan@example.com",
      "add",
      ".",
    ],
    seedDir,
  );
  runGit(
    [
      "-c",
      "user.name=Himan Bot",
      "-c",
      "user.email=himan@example.com",
      "commit",
      "-m",
      `Add ${name} rule fixture`,
    ],
    seedDir,
  );
  runGit(["tag", `rule/${name}@${version}`], seedDir);
  runGit(["init", "--bare", "--initial-branch=main"], remoteDir);
  runGit(["remote", "add", "origin", remoteDir], seedDir);
  runGit(["push", "-u", "origin", "main"], seedDir);
  runGit(["push", "--tags"], seedDir);

  return remoteDir;
}

function runGit(args: string[], cwd: string): void {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  expect(result.status).toBe(0);
}

function runGitOutput(args: string[], cwd: string): string {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  expect(result.status).toBe(0);
  return result.stdout.trim();
}
