import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InstalledRegistryStore } from "../../src/state/installed-registry-store.js";

let fakeHomeDir = "";

beforeEach(async () => {
  fakeHomeDir = await fs.mkdtemp(path.join(os.tmpdir(), "himan-home-"));
  vi.spyOn(os, "homedir").mockReturnValue(fakeHomeDir);
});

afterEach(async () => {
  vi.restoreAllMocks();
  if (fakeHomeDir) {
    await fs.rm(fakeHomeDir, { recursive: true, force: true });
  }
});

describe("InstalledRegistryStore", () => {
  it("upserts entries keyed by scope, project, agent, type, and name", async () => {
    const store = new InstalledRegistryStore();
    await store.upsert({
      scope: "project",
      projectDir: "/tmp/project",
      agent: "codex",
      type: "skill",
      name: "api-review",
      version: "1.0.0",
      source: "team",
      mode: "copy",
      targetPath: "/tmp/project/.agents/skills/api-review",
      updatedAt: "2026-08-25T00:00:00.000Z",
    });
    await store.upsert({
      scope: "project",
      projectDir: "/tmp/project",
      agent: "codex",
      type: "skill",
      name: "api-review",
      version: "2.0.0",
      source: "team",
      mode: "link",
      targetPath: "/tmp/project/.agents/skills/api-review",
      updatedAt: "2026-08-25T01:00:00.000Z",
    });

    const registry = await store.load();
    expect(registry.entries).toHaveLength(1);
    expect(registry.entries[0]).toMatchObject({
      version: "2.0.0",
      mode: "link",
      updatedAt: "2026-08-25T01:00:00.000Z",
    });
  });

  it("keeps separate entries for different scopes and agents", async () => {
    const store = new InstalledRegistryStore();
    await store.upsertMany([
      {
        scope: "project",
        projectDir: "/tmp/project",
        agent: "codex",
        type: "rule",
        name: "code-review",
        version: "1.0.0",
        mode: "copy",
        targetPath: "/tmp/project/.codex/rules/code-review",
        updatedAt: "2026-08-25T00:00:00.000Z",
      },
      {
        scope: "global",
        agent: "cursor",
        type: "rule",
        name: "code-review",
        version: "1.0.0",
        mode: "link",
        targetPath: "/tmp/home/.cursor/rules/code-review",
        updatedAt: "2026-08-25T00:00:00.000Z",
      },
    ]);

    expect((await store.load()).entries).toHaveLength(2);
  });

  it("removes entries matching a filter", async () => {
    const store = new InstalledRegistryStore();
    await store.upsertMany([
      {
        scope: "project",
        projectDir: "/tmp/project",
        agent: "codex",
        type: "skill",
        name: "keep",
        version: "1.0.0",
        mode: "copy",
        targetPath: "/tmp/project/.agents/skills/keep",
        updatedAt: "2026-08-25T00:00:00.000Z",
      },
      {
        scope: "project",
        projectDir: "/tmp/project",
        agent: "codex",
        type: "skill",
        name: "drop",
        version: "1.0.0",
        mode: "copy",
        targetPath: "/tmp/project/.agents/skills/drop",
        updatedAt: "2026-08-25T00:00:00.000Z",
      },
    ]);

    await store.remove({
      scope: "project",
      projectDir: "/tmp/project",
      type: "skill",
      name: "drop",
    });

    const entries = (await store.load()).entries;
    expect(entries).toHaveLength(1);
    expect(entries[0].name).toBe("keep");
  });

  it("returns an empty registry for missing or invalid files", async () => {
    const store = new InstalledRegistryStore();
    expect((await store.load()).entries).toEqual([]);

    await fs.mkdir(path.dirname(store.getRegistryPath()), { recursive: true });
    await fs.writeFile(store.getRegistryPath(), "not json", "utf8");
    expect((await store.load()).entries).toEqual([]);
  });
});
