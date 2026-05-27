import { spawnSync } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ServiceFactory } from "../../src/services/index.js";

let tmpRoot = "";
let fakeHomeDir = "";
let projectDir = "";

beforeEach(async () => {
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "himan-service-lock-"));
  fakeHomeDir = path.join(tmpRoot, "home");
  projectDir = path.join(tmpRoot, "project");
  const gitConfigPath = path.join(tmpRoot, "empty-gitconfig");
  await fs.mkdir(fakeHomeDir, { recursive: true });
  await fs.mkdir(projectDir, { recursive: true });
  await fs.writeFile(gitConfigPath, "", "utf8");
  vi.spyOn(os, "homedir").mockReturnValue(fakeHomeDir);
  vi.stubEnv("GIT_CONFIG_GLOBAL", gitConfigPath);
  vi.stubEnv("GIT_CONFIG_NOSYSTEM", "1");
});

afterEach(async () => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  if (tmpRoot) {
    await fs.rm(tmpRoot, { recursive: true, force: true });
  }
});

describe("ServiceFactory lock restore", () => {
  it("installs from the lock source after the default source changes", async () => {
    const lockedRemote = await createRemoteFixture("locked", [
      {
        name: "code-review",
        version: "1.0.0",
        description: "locked source rule",
        content: "from locked source",
      },
    ]);
    const otherRemote = await createRemoteFixture("other", [
      {
        name: "other-rule",
        version: "1.0.0",
        description: "other source rule",
        content: "from other source",
      },
    ]);
    const services = new ServiceFactory();

    await services.initSource("git", lockedRemote);
    await services.addSource("other", "git", otherRemote);
    await services.install("rule", "code-review", "1.0.0", projectDir, ["cursor"], "link");
    await services.aliasSource("default", "locked");

    const lockPath = path.join(projectDir, "himan.lock");
    const lock = JSON.parse(await fs.readFile(lockPath, "utf8")) as {
      source: { name?: string; repo?: string; repoId?: string };
    };
    expect(lock.source).toEqual(
      expect.objectContaining({
        name: "default",
        repo: lockedRemote,
      }),
    );

    await fs.rm(path.join(projectDir, ".cursor", "rules", "code-review"), {
      recursive: true,
      force: true,
    });
    await fs.rm(
      path.join(fakeHomeDir, ".himan", "store", "rule", "code-review", "1.0.0"),
      { recursive: true, force: true },
    );
    await services.useSource("other");

    const restored = await services.installFromLock(projectDir);

    expect(restored).toEqual([
      expect.objectContaining({
        type: "rule",
        name: "code-review",
        version: "1.0.0",
      }),
    ]);
    const restoredPath = await fs.realpath(
      path.join(projectDir, ".cursor", "rules", "code-review"),
    );
    await expect(
      fs.readFile(path.join(restoredPath, "content.md"), "utf8"),
    ).resolves.toContain("from locked source");

    const lockAfterRestore = JSON.parse(await fs.readFile(lockPath, "utf8")) as {
      source: { name?: string; repo?: string };
    };
    expect(lockAfterRestore.source).toEqual(
      expect.objectContaining({
        name: "default",
        repo: lockedRemote,
      }),
    );
  });

  it("records additional source refs and restores each resource from its source", async () => {
    const lockedRemote = await createRemoteFixture("locked-mismatch", [
      {
        name: "code-review",
        version: "1.0.0",
        description: "locked source rule",
        content: "from locked source",
      },
    ]);
    const otherRemote = await createRemoteFixture("other-mismatch", [
      {
        name: "other-rule",
        version: "1.0.0",
        description: "other source rule",
        content: "from other source",
      },
    ]);
    const services = new ServiceFactory();

    await services.initSource("git", lockedRemote);
    await services.addSource("other-source", "git", otherRemote, "other");
    await services.install("rule", "code-review", "1.0.0", projectDir, ["cursor"], "copy");
    await services.install(
      "rule",
      "other-rule",
      "1.0.0",
      projectDir,
      ["cursor"],
      "copy",
      {
        source: "other",
      },
    );
    await services.create(
      "rule",
      "published-other",
      { agents: ["cursor"] },
      projectDir,
    );
    await fs.appendFile(
      path.join(projectDir, ".cursor", "rules", "published-other", "content.md"),
      "published to other source\n",
      "utf8",
    );
    const published = await services.publish("rule", "published-other", "patch", projectDir, {
      source: "other",
    });
    expect(published).toEqual(
      expect.objectContaining({
        name: "published-other",
        version: "0.0.1",
      }),
    );

    const lockRaw = await fs.readFile(path.join(projectDir, "himan.lock"), "utf8");
    expect(lockRaw.indexOf('"sources"')).toBeGreaterThan(lockRaw.indexOf('"source"'));
    expect(lockRaw.indexOf('"sources"')).toBeLessThan(lockRaw.indexOf('"updatedAt"'));
    const lock = JSON.parse(lockRaw) as {
      source: { repo?: string };
      sources?: Record<string, { repo?: string }>;
      resources: Array<{ name: string; source?: string }>;
    };
    expect(lock.source).toEqual(expect.objectContaining({ repo: lockedRemote }));
    expect(lock.sources).toEqual({
      other: expect.objectContaining({ repo: otherRemote }),
    });
    expect(lock.resources).toEqual([
      expect.objectContaining({ name: "code-review" }),
      expect.objectContaining({ name: "other-rule", source: "other" }),
      expect.objectContaining({ name: "published-other", source: "other" }),
    ]);
    await expect(
      fs.readFile(path.join(projectDir, ".cursor", "rules", "other-rule", "content.md"), "utf8"),
    ).resolves.toContain("from other source");

    await fs.rm(path.join(projectDir, ".cursor", "rules", "code-review"), {
      recursive: true,
      force: true,
    });
    await fs.rm(path.join(projectDir, ".cursor", "rules", "other-rule"), {
      recursive: true,
      force: true,
    });
    await fs.rm(path.join(projectDir, ".cursor", "rules", "published-other"), {
      recursive: true,
      force: true,
    });
    await fs.rm(path.join(fakeHomeDir, ".himan", "store", "rule", "code-review", "1.0.0"), {
      recursive: true,
      force: true,
    });
    await fs.rm(path.join(fakeHomeDir, ".himan", "store", "rule", "other-rule", "1.0.0"), {
      recursive: true,
      force: true,
    });
    await fs.rm(
      path.join(fakeHomeDir, ".himan", "store", "rule", "published-other", "0.0.1"),
      {
        recursive: true,
        force: true,
      },
    );

    const restored = await services.installFromLock(projectDir);

    expect(restored).toEqual([
      expect.objectContaining({ name: "code-review", version: "1.0.0" }),
      expect.objectContaining({ name: "other-rule", version: "1.0.0" }),
      expect.objectContaining({ name: "published-other", version: "0.0.1" }),
    ]);
    await expect(
      fs.readFile(path.join(projectDir, ".cursor", "rules", "code-review", "content.md"), "utf8"),
    ).resolves.toContain("from locked source");
    await expect(
      fs.readFile(path.join(projectDir, ".cursor", "rules", "other-rule", "content.md"), "utf8"),
    ).resolves.toContain("from other source");
    await expect(
      fs.readFile(
        path.join(projectDir, ".cursor", "rules", "published-other", "content.md"),
        "utf8",
      ),
    ).resolves.toContain("published to other source");
  }, 20000);
});

async function createRemoteFixture(
  label: string,
  resources: Array<{
    name: string;
    version: string;
    description: string;
    content: string;
  }>,
): Promise<string> {
  const seedDir = path.join(tmpRoot, `${label}-seed`);
  const remoteDir = path.join(tmpRoot, `${label}.git`);

  await fs.mkdir(seedDir, { recursive: true });
  await fs.mkdir(remoteDir, { recursive: true });
  for (const resource of resources) {
    await writeRule(seedDir, resource);
  }

  runGit(["init", "--initial-branch=main"], seedDir);
  commitAll(seedDir, "Initial commit");
  for (const resource of resources) {
    runGit(["tag", `rule/${resource.name}@${resource.version}`], seedDir);
  }
  runGit(["init", "--bare", "--initial-branch=main"], remoteDir);
  runGit(["remote", "add", "origin", remoteDir], seedDir);
  runGit(["push", "-u", "origin", "main"], seedDir);
  runGit(["push", "--tags"], seedDir);

  return remoteDir;
}

async function writeRule(
  repoDir: string,
  resource: {
    name: string;
    version: string;
    description: string;
    content: string;
  },
): Promise<void> {
  const resourceDir = path.join(repoDir, "rules", resource.name);
  await fs.mkdir(resourceDir, { recursive: true });
  await fs.writeFile(
    path.join(resourceDir, "himan.yaml"),
    [
      `name: ${resource.name}`,
      "type: rule",
      `version: ${resource.version}`,
      "entry: content.md",
      `description: ${resource.description}`,
      "agents:",
      "  - cursor",
    ].join("\n"),
    "utf8",
  );
  await fs.writeFile(path.join(resourceDir, "content.md"), `${resource.content}\n`, "utf8");
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
