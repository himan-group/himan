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
  cliEntry = path.join(process.cwd(), "dist", "index.js");
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

    const createForce = runCli(
      ["create", "command", "sync-docs", "--force"],
      projectDir,
      homeDir,
    );
    expect(createForce.status).toBe(0);
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
      path.join(projectDir, ".himan", "dev", "code-review"),
    );
    expect(devLinkedRealPath).toBe(expectedDevPath);
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
