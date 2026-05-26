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
  await fs.mkdir(fakeHomeDir, { recursive: true });
  await fs.mkdir(projectDir, { recursive: true });
  vi.spyOn(os, "homedir").mockReturnValue(fakeHomeDir);
});

afterEach(async () => {
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

  it("refuses to update a non-empty lock from a different source", async () => {
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

    await expect(
      services.install("rule", "other-rule", "1.0.0", projectDir, ["cursor"], "copy", {
        source: "other",
      }),
    ).rejects.toMatchObject({
      code: "E_INVALID_INPUT",
      message: expect.stringContaining("Project lock is bound to source"),
    });

    const lock = JSON.parse(
      await fs.readFile(path.join(projectDir, "himan.lock"), "utf8"),
    ) as { source: { repo?: string }; resources: Array<{ name: string }> };
    expect(lock.source).toEqual(expect.objectContaining({ repo: lockedRemote }));
    expect(lock.resources).toEqual([
      expect.objectContaining({ name: "code-review" }),
    ]);
    await expect(
      fs.access(path.join(projectDir, ".cursor", "rules", "other-rule")),
    ).rejects.toThrow();

    await expect(
      services.publish("rule", "other-rule", "patch", projectDir, {
        source: "other",
      }),
    ).rejects.toMatchObject({
      code: "E_INVALID_INPUT",
      message: expect.stringContaining("Project lock is bound to source"),
    });

    const otherHistory = await services.history("rule", "other-rule", {
      source: "other",
    });
    expect(otherHistory).toEqual([
      expect.objectContaining({ version: "1.0.0" }),
    ]);
  });
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
