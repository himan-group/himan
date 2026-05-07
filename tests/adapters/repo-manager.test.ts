import { spawnSync } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { RepoManager } from "../../src/adapters/git/repo-manager.js";

const tmpDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tmpDirs.map((dir) => fs.rm(dir, { recursive: true, force: true })));
  tmpDirs.length = 0;
});

describe("RepoManager", () => {
  it("fast-forwards a clean cached repository after fetching", async () => {
    const { remoteDir, seedDir, targetDir } = await createRemoteFixture();
    const manager = new RepoManager();

    await manager.cloneOrFetch(remoteDir, targetDir);
    await writeRule(seedDir, "remote-rule");
    commitAll(seedDir, "Add remote rule");
    runGit(["push"], seedDir);

    await manager.cloneOrFetch(remoteDir, targetDir);

    await expect(
      fs.readFile(path.join(targetDir, "rules", "remote-rule", "himan.yaml"), "utf8"),
    ).resolves.toContain("name: remote-rule");
  });

  it("leaves a dirty cached repository working tree untouched after fetching", async () => {
    const { remoteDir, seedDir, targetDir } = await createRemoteFixture();
    const manager = new RepoManager();

    await manager.cloneOrFetch(remoteDir, targetDir);
    await fs.writeFile(path.join(targetDir, "local-note.txt"), "local dirty change\n", "utf8");
    await writeRule(seedDir, "remote-rule");
    commitAll(seedDir, "Add remote rule");
    runGit(["push"], seedDir);

    await manager.cloneOrFetch(remoteDir, targetDir);

    await expect(
      fs.readFile(path.join(targetDir, "local-note.txt"), "utf8"),
    ).resolves.toContain("local dirty change");
    await expect(
      fs.access(path.join(targetDir, "rules", "remote-rule", "himan.yaml")),
    ).rejects.toThrow();
  });

  it("uses a stable publish error code when there are no staged changes", async () => {
    const { seedDir } = await createRemoteFixture();
    const manager = new RepoManager();

    await expect(
      manager.commitTagAndPush(seedDir, "publish noop", "rule/noop@0.0.1"),
    ).rejects.toMatchObject({
      code: "E_PUBLISH_NO_CHANGES",
      message: "No changes to publish.",
    });
  });
});

async function createRemoteFixture(): Promise<{
  remoteDir: string;
  seedDir: string;
  targetDir: string;
}> {
  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "himan-repo-manager-"));
  tmpDirs.push(tmpRoot);

  const seedDir = path.join(tmpRoot, "seed");
  const remoteDir = path.join(tmpRoot, "remote.git");
  const targetDir = path.join(tmpRoot, "target");

  await fs.mkdir(seedDir, { recursive: true });
  await fs.mkdir(remoteDir, { recursive: true });
  await fs.writeFile(path.join(seedDir, "README.md"), "# test source\n", "utf8");

  runGit(["init", "--initial-branch=main"], seedDir);
  commitAll(seedDir, "Initial commit");
  runGit(["init", "--bare", "--initial-branch=main"], remoteDir);
  runGit(["remote", "add", "origin", remoteDir], seedDir);
  runGit(["push", "-u", "origin", "main"], seedDir);

  return { remoteDir, seedDir, targetDir };
}

async function writeRule(repoDir: string, name: string): Promise<void> {
  const resourceDir = path.join(repoDir, "rules", name);
  await fs.mkdir(resourceDir, { recursive: true });
  await fs.writeFile(
    path.join(resourceDir, "himan.yaml"),
    [
      `name: ${name}`,
      "type: rule",
      "entry: content.md",
      "description: from remote",
    ].join("\n"),
    "utf8",
  );
  await fs.writeFile(path.join(resourceDir, "content.md"), `# ${name}\n`, "utf8");
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

function runGit(args: string[], cwd: string): void {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  expect(
    result.status,
    `git ${args.join(" ")}\n${result.stdout}\n${result.stderr}`,
  ).toBe(0);
}
