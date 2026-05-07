import { spawnSync } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GitSourceAdapter } from "../../src/adapters/source/git-source-adapter.js";

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
    expect(runGitOutput(["tag", "--list", "rule/published-rule@0.1.0"], targetDir)).toBe(
      "rule/published-rule@0.1.0",
    );
  });

  it("rejects publish when himan.yaml is missing", async () => {
    const { remoteDir, targetDir } = await createRemoteFixture();
    const adapter = new GitSourceAdapter();
    const sourceDir = path.join(tmpRoot, "missing-metadata");

    await adapter.init({
      type: "git",
      repo: remoteDir,
      repoDir: targetDir,
      repoId: "test-source",
    });
    await fs.mkdir(sourceDir, { recursive: true });
    await fs.writeFile(path.join(sourceDir, "content.md"), "# missing metadata\n", "utf8");

    await expect(
      adapter.publish("rule", "missing-metadata", "0.1.0", sourceDir),
    ).rejects.toMatchObject({
      code: "E_INVALID_RESOURCE_METADATA",
    });
    await expect(
      fs.access(path.join(targetDir, "rules", "missing-metadata")),
    ).rejects.toThrow();
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
});

async function createRemoteFixture(): Promise<{
  remoteDir: string;
  targetDir: string;
}> {
  const seedDir = path.join(tmpRoot, "seed");
  const remoteDir = path.join(tmpRoot, "remote.git");
  const targetDir = path.join(tmpRoot, "target");

  await fs.mkdir(seedDir, { recursive: true });
  await fs.mkdir(remoteDir, { recursive: true });
  await writeRule(seedDir, "original description");

  runGit(["init", "--initial-branch=main"], seedDir);
  commitAll(seedDir, "Initial commit");
  runGit(["init", "--bare"], remoteDir);
  runGit(["remote", "add", "origin", remoteDir], seedDir);
  runGit(["push", "-u", "origin", "main"], seedDir);

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
