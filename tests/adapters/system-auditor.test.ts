import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SystemAuditor } from "../../src/adapters/audit/system-auditor.js";
import { InstalledRegistryStore } from "../../src/state/installed-registry-store.js";
import { ProjectLockStore } from "../../src/state/project-lock-store.js";

let tmpRoot = "";
let homeDir = "";
let projectDir = "";
let registryStore: InstalledRegistryStore;
let lockStore: ProjectLockStore;

beforeEach(async () => {
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "himan-audit-"));
  homeDir = path.join(tmpRoot, "home");
  projectDir = path.join(tmpRoot, "project");
  await fs.mkdir(homeDir, { recursive: true });
  await fs.mkdir(projectDir, { recursive: true });
  vi.spyOn(os, "homedir").mockReturnValue(homeDir);
  registryStore = new InstalledRegistryStore();
  lockStore = new ProjectLockStore();
});

afterEach(async () => {
  vi.restoreAllMocks();
  if (tmpRoot) {
    await fs.rm(tmpRoot, { recursive: true, force: true });
  }
});

async function writeFiles(dir: string, files: Record<string, string>): Promise<void> {
  for (const [relPath, content] of Object.entries(files)) {
    const fullPath = path.join(dir, relPath);
    await fs.mkdir(path.dirname(fullPath), { recursive: true });
    await fs.writeFile(fullPath, content, "utf8");
  }
}

function runAuditor(scope: "global" | "project" | "all" = "all") {
  return new SystemAuditor({ registryStore, lockStore }).run({
    projectDir,
    homeDir,
    scope,
  });
}

describe("SystemAuditor", () => {
  it("classifies a symlinked store resource as managed", async () => {
    const storePath = path.join(
      homeDir,
      ".himan",
      "store",
      "skill",
      "api-review",
      "1.0.0",
    );
    await writeFiles(storePath, {
      "SKILL.md": "# api-review\n",
      "himan.yaml": "name: api-review\n",
    });
    const targetPath = path.join(projectDir, ".agents", "skills", "api-review");
    await fs.mkdir(path.dirname(targetPath), { recursive: true });
    await fs.symlink(storePath, targetPath, "dir");
    await registryStore.upsert({
      scope: "project",
      projectDir,
      agent: "codex",
      type: "skill",
      name: "api-review",
      version: "1.0.0",
      mode: "link",
      targetPath,
      updatedAt: new Date().toISOString(),
    });

    const result = await runAuditor();
    expect(result.resources).toEqual([
      expect.objectContaining({
        scope: "project",
        agent: "codex",
        type: "skill",
        name: "api-review",
        version: "1.0.0",
        status: "managed",
        mode: "link",
      }),
    ]);
    expect(result.stats.totals.managed).toBe(1);
    expect(result.issues.filter((issue) => issue.category === "lock-modified")).toEqual([]);
  });

  it("classifies a copy-mode resource as drifted when content changes", async () => {
    const storePath = path.join(
      homeDir,
      ".himan",
      "store",
      "rule",
      "code-review",
      "1.0.0",
    );
    await writeFiles(storePath, {
      "content.md": "original\n",
      "himan.yaml": "name: code-review\n",
    });
    const targetPath = path.join(projectDir, ".codex", "rules", "code-review");
    await fs.mkdir(path.dirname(targetPath), { recursive: true });
    await fs.cp(storePath, targetPath, { recursive: true });
    await fs.writeFile(path.join(targetPath, "content.md"), "modified\n", "utf8");
    await registryStore.upsert({
      scope: "project",
      projectDir,
      agent: "codex",
      type: "rule",
      name: "code-review",
      version: "1.0.0",
      mode: "copy",
      targetPath,
      updatedAt: new Date().toISOString(),
    });

    const result = await runAuditor();
    expect(result.resources[0].status).toBe("drifted");
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          category: "lock-modified",
          level: "warn",
        }),
      ]),
    );
  });

  it("marks unmanaged resources with an issue", async () => {
    await writeFiles(path.join(projectDir, ".agents", "skills", "shadow-skill"), {
      "SKILL.md": "# shadow-skill\n",
    });

    const result = await runAuditor();
    expect(result.resources).toEqual([
      expect.objectContaining({
        agent: "codex",
        type: "skill",
        name: "shadow-skill",
        status: "unmanaged",
      }),
    ]);
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ category: "unmanaged", level: "warn" }),
      ]),
    );
    expect(result.stats.totals.unmanaged).toBe(1);
  });

  it("keeps marked resources out of unmanaged issues", async () => {
    await writeFiles(path.join(projectDir, ".agents", "skills", "marked-skill"), {
      "SKILL.md": "# marked-skill\n",
      "himan.yaml": "name: marked-skill\ntype: skill\nentry: SKILL.md\nversion: 0.1.0\n",
    });

    const result = await runAuditor();
    expect(result.resources).toEqual([
      expect.objectContaining({
        name: "marked-skill",
        status: "unmanaged",
      }),
    ]);
    expect(
      result.issues.some((issue) => issue.category === "unmanaged"),
    ).toBe(false);
  });

  it("reports missing lock targets", async () => {
    await lockStore.upsertResource(projectDir, {
      type: "git",
      repo: "https://example.com/source.git",
    }, {
      type: "rule",
      name: "missing-rule",
      version: "1.0.0",
      agents: ["codex"],
      mode: "copy",
    });

    const result = await runAuditor("project");
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          category: "lock-missing-target",
          level: "error",
        }),
      ]),
    );
  });

  it("reports orphan store cache without any install reference", async () => {
    await writeFiles(
      path.join(homeDir, ".himan", "store", "skill", "old-skill", "0.1.0"),
      { "SKILL.md": "# old-skill\n" },
    );

    const result = await runAuditor();
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          category: "orphan-store-cache",
          level: "warn",
          path: path.join(homeDir, ".himan", "store", "skill", "old-skill", "0.1.0"),
        }),
      ]),
    );
  });

  it("reports version drift across agents", async () => {
    const codexStore = path.join(homeDir, ".himan", "store", "skill", "dual", "1.0.0");
    const cursorStore = path.join(homeDir, ".himan", "store", "skill", "dual", "2.0.0");
    await writeFiles(codexStore, { "SKILL.md": "# v1\n" });
    await writeFiles(cursorStore, { "SKILL.md": "# v2\n" });
    const codexTarget = path.join(projectDir, ".agents", "skills", "dual");
    const cursorTarget = path.join(projectDir, ".cursor", "skills", "dual");
    await fs.mkdir(path.dirname(codexTarget), { recursive: true });
    await fs.mkdir(path.dirname(cursorTarget), { recursive: true });
    await fs.symlink(codexStore, codexTarget, "dir");
    await fs.symlink(cursorStore, cursorTarget, "dir");
    await registryStore.upsertMany([
      {
        scope: "project",
        projectDir,
        agent: "codex",
        type: "skill",
        name: "dual",
        version: "1.0.0",
        mode: "link",
        targetPath: codexTarget,
        updatedAt: new Date().toISOString(),
      },
      {
        scope: "project",
        projectDir,
        agent: "cursor",
        type: "skill",
        name: "dual",
        version: "2.0.0",
        mode: "link",
        targetPath: cursorTarget,
        updatedAt: new Date().toISOString(),
      },
    ]);

    const result = await runAuditor();
    expect(
      result.issues.filter((issue) => issue.category === "version-drift"),
    ).toHaveLength(2);
  });

  it("filters by scope", async () => {
    await writeFiles(path.join(projectDir, ".agents", "skills", "project-only"), {
      "SKILL.md": "# project-only\n",
    });
    await writeFiles(path.join(homeDir, ".agents", "skills", "global-only"), {
      "SKILL.md": "# global-only\n",
    });

    const global = await runAuditor("global");
    expect(global.resources.map((resource) => resource.name)).toEqual(["global-only"]);
    const project = await runAuditor("project");
    expect(project.resources.map((resource) => resource.name)).toEqual(["project-only"]);
  });
});
