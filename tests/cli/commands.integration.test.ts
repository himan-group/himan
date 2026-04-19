import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { toRepoId } from "../../src/utils/repo-id.js";

const TEST_REPO = "https://github.com/lidetao/himan-test.git";

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
  runGit(["init", "--bare"], mockedRemoteDir);
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
  it("initializes from the given test repository", async () => {
    const result = runCli(["init", TEST_REPO], projectDir, homeDir);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Initialized git source");

    const configPath = path.join(homeDir, ".himan", "config.json");
    await expect(fs.access(configPath)).resolves.toBeUndefined();
    await expect(fs.access(repoDir)).resolves.toBeUndefined();
  });

  it("manages multiple sources and switches default source", () => {
    const addResult = runCli(["source", "add", "mirror", TEST_REPO], projectDir, homeDir);
    expect(addResult.status).toBe(0);
    expect(addResult.stdout).toContain("Added source mirror");

    const listResult = runCli(["source", "list", "--json"], projectDir, homeDir);
    expect(listResult.status).toBe(0);
    const sources = JSON.parse(listResult.stdout) as Array<{
      name: string;
      repo?: string;
      isDefault: boolean;
    }>;
    expect(sources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "default", isDefault: true }),
        expect.objectContaining({ name: "mirror", repo: TEST_REPO }),
      ]),
    );

    const useResult = runCli(["source", "use", "mirror"], projectDir, homeDir);
    expect(useResult.status).toBe(0);
    expect(useResult.stdout).toContain("Using source: mirror");

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

  it("returns empty list and history before resources are prepared", () => {
    const listResult = runCli(["list", "rule", "--json"], projectDir, homeDir);
    expect(listResult.status).toBe(0);
    expect(JSON.parse(listResult.stdout)).toEqual([]);

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
        "--target",
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
    expect(payload.resourceDir).toContain(path.join(repoDir, "commands", "sync-docs"));
    await expect(fs.access(path.join(repoDir, "commands", "sync-docs", "himan.yaml"))).resolves
      .toBeUndefined();
    await expect(fs.access(path.join(repoDir, "commands", "sync-docs", "content.md"))).resolves
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

    const listCommandResult = runCli(
      ["list", "command", "--json"],
      projectDir,
      homeDir,
    );
    expect(listCommandResult.status).toBe(0);
    const listedCommands = JSON.parse(listCommandResult.stdout) as Array<Record<string, unknown>>;
    expect(listedCommands).toEqual(
      expect.arrayContaining([
        {
          name: "sync-docs",
          type: "command",
          entry: "content.md",
          description: expect.any(String),
          targets: expect.any(Array),
        },
      ]),
    );
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

    await expect(fs.access(path.join(repoDir, "skills", "bug-analysis"))).rejects.toThrow();

    const createSkill = runCli(["create", "skill", "bug-analysis"], projectDir, homeDir);
    expect(createSkill.status).toBe(0);

    const listSkillResult = runCli(["list", "skill", "--json"], projectDir, homeDir);
    expect(listSkillResult.status).toBe(0);
    const listedSkills = JSON.parse(listSkillResult.stdout) as Array<Record<string, unknown>>;
    expect(listedSkills).toEqual(
      expect.arrayContaining([
        {
          name: "bug-analysis",
          type: "skill",
          entry: "SKILL.md",
          description: expect.any(String),
          targets: expect.any(Array),
        },
      ]),
    );
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

    const contentPath = path.join(repoDir, "commands", "release-note", "content.md");
    await fs.appendFile(contentPath, "Publish from create artifact.\n", "utf8");

    const publishResult = runCli(
      ["publish", "command", "release-note", "--minor"],
      projectDir,
      homeDir,
    );
    expect(publishResult.status).toBe(0);
    expect(publishResult.stdout).toContain("Published command/release-note@0.1.0");

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
  });

  it("publishes skill create artifact without dev workflow", async () => {
    const createResult = runCli(
      ["create", "skill", "risk-check", "--description", "risk check skill"],
      projectDir,
      homeDir,
    );
    expect(createResult.status).toBe(0);

    const skillContentPath = path.join(repoDir, "skills", "risk-check", "SKILL.md");
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
    const commandLinkedRealPath = await fs.realpath(commandLinkPath);
    expect(commandLinkedRealPath).toContain(
      path.join(homeDir, ".himan", "store", "command", "release-note", "0.1.0"),
    );

    const devCommand = runCli(["dev", "command", "release-note"], projectDir, homeDir);
    expect(devCommand.status).toBe(0);
    expect(devCommand.stdout).toContain("Switched command/release-note to dev mode");

    const commandDevLinkedRealPath = await fs.realpath(commandLinkPath);
    const expectedCommandDevPath = await fs.realpath(
      path.join(projectDir, ".himan", "dev", "command", "release-note"),
    );
    expect(commandDevLinkedRealPath).toBe(expectedCommandDevPath);

    const installSkill = runCli(["install", "skill", "risk-check@0.0.1"], projectDir, homeDir);
    expect(installSkill.status).toBe(0);
    expect(installSkill.stdout).toContain("Installed skill/risk-check@0.0.1");

    const skillLinkPath = path.join(projectDir, ".cursor", "skills", "risk-check");
    const skillLinkedRealPath = await fs.realpath(skillLinkPath);
    expect(skillLinkedRealPath).toContain(
      path.join(homeDir, ".himan", "store", "skill", "risk-check", "0.0.1"),
    );

    const devSkill = runCli(["dev", "skill", "risk-check"], projectDir, homeDir);
    expect(devSkill.status).toBe(0);
    expect(devSkill.stdout).toContain("Switched skill/risk-check to dev mode");

    const skillDevLinkedRealPath = await fs.realpath(skillLinkPath);
    const expectedSkillDevPath = await fs.realpath(
      path.join(projectDir, ".himan", "dev", "skill", "risk-check"),
    );
    expect(skillDevLinkedRealPath).toBe(expectedSkillDevPath);
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
          targets: ["cursor"],
        },
      ]),
    );

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
    const linkedRealPath = await fs.realpath(linkedPath);
    expect(linkedRealPath).toContain(
      path.join(homeDir, ".himan", "store", "rule", "code-review", "1.0.0"),
    );

    const contentPath = path.join(linkedRealPath, "content.md");
    const content = await fs.readFile(contentPath, "utf8");
    expect(content).toContain("Follow code review checklist");

    const devResult = runCli(["dev", "rule", "code-review"], projectDir, homeDir);
    expect(devResult.status).toBe(0);
    expect(devResult.stdout).toContain("Switched rule/code-review to dev mode");

    const devLinkedRealPath = await fs.realpath(linkedPath);
    const expectedDevPath = await fs.realpath(
      path.join(projectDir, ".himan", "dev", "rule", "code-review"),
    );
    expect(devLinkedRealPath).toBe(expectedDevPath);
  });

  it("writes himan.lock on install and can reproduce installs", async () => {
    const lockPath = path.join(projectDir, "himan.lock");
    const lockRaw = await fs.readFile(lockPath, "utf8");
    const lock = JSON.parse(lockRaw) as {
      version: number;
      source: { type: string };
      resources: Array<{ type: string; name: string; version: string }>;
    };

    expect(lock.version).toBe(1);
    expect(lock.source.type).toBe("git");
    expect(lock.resources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "rule",
          name: "code-review",
          version: "1.0.0",
        }),
        expect.objectContaining({
          type: "command",
          name: "release-note",
          version: "0.1.0",
        }),
        expect.objectContaining({
          type: "skill",
          name: "risk-check",
          version: "0.0.1",
        }),
      ]),
    );

    await fs.rm(path.join(projectDir, ".cursor", "rules", "code-review"), {
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

    await expect(
      fs.realpath(path.join(projectDir, ".cursor", "rules", "code-review")),
    ).resolves.toContain(path.join(homeDir, ".himan", "store", "rule", "code-review", "1.0.0"));
    await expect(
      fs.realpath(path.join(projectDir, ".cursor", "commands", "release-note")),
    ).resolves.toContain(
      path.join(homeDir, ".himan", "store", "command", "release-note", "0.1.0"),
    );
    await expect(
      fs.realpath(path.join(projectDir, ".cursor", "skills", "risk-check")),
    ).resolves.toContain(path.join(homeDir, ".himan", "store", "skill", "risk-check", "0.0.1"));
  });

  it("updates lock and project link after publish when resource is locked", async () => {
    const devCommandPath = path.join(projectDir, ".himan", "dev", "command", "release-note");
    await fs.appendFile(path.join(devCommandPath, "content.md"), "lock sync on publish.\n", "utf8");

    const publishResult = runCli(
      ["publish", "command", "release-note", "--patch"],
      projectDir,
      homeDir,
    );
    expect(publishResult.status).toBe(0);
    expect(publishResult.stdout).toContain("Published command/release-note@0.1.1");

    const commandLinkPath = path.join(projectDir, ".cursor", "commands", "release-note");
    await expect(fs.realpath(commandLinkPath)).resolves.toContain(
      path.join(homeDir, ".himan", "store", "command", "release-note", "0.1.1"),
    );

    const lockRaw = await fs.readFile(path.join(projectDir, "himan.lock"), "utf8");
    const lock = JSON.parse(lockRaw) as {
      resources: Array<{ type: string; name: string; version: string }>;
    };
    expect(lock.resources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "command",
          name: "release-note",
          version: "0.1.1",
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
      ".himan",
      "dev",
      "rule",
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
    const linkedRealPath = await fs.realpath(linkedPath);
    expect(linkedRealPath).toContain(
      path.join(homeDir, ".himan", "store", "rule", "code-review", "1.0.1"),
    );

    const publishedContent = await fs.readFile(
      path.join(linkedRealPath, "content.md"),
      "utf8",
    );
    expect(publishedContent).toContain("Published from dev mode.");

    const tags = runGitOutput(["tag", "--list", "rule/code-review@*"], repoDir);
    expect(tags.split("\n").filter(Boolean)).toEqual([
      "rule/code-review@1.0.0",
      "rule/code-review@1.0.1",
    ]);
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
      "targets:",
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

function runGit(args: string[], cwd: string): void {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  expect(result.status).toBe(0);
}

function runGitOutput(args: string[], cwd: string): string {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  expect(result.status).toBe(0);
  return result.stdout.trim();
}
