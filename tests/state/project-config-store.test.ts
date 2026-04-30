import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ProjectConfigStore } from "../../src/state/project-config-store.js";

let projectDir = "";

beforeEach(async () => {
  projectDir = await fs.mkdtemp(path.join(os.tmpdir(), "himan-project-"));
});

afterEach(async () => {
  if (projectDir) {
    await fs.rm(projectDir, { recursive: true, force: true });
  }
});

describe("ProjectConfigStore", () => {
  it("returns null when project config does not exist", async () => {
    const store = new ProjectConfigStore();
    await expect(store.load(projectDir)).resolves.toBeNull();
  });

  it("saves default agents under project .himan config", async () => {
    const store = new ProjectConfigStore();
    const saved = await store.saveAgents(projectDir, ["codex"]);

    expect(saved.version).toBe(1);
    expect(saved.agents).toEqual(["codex"]);
    await expect(store.load(projectDir)).resolves.toMatchObject({
      version: 1,
      agents: ["codex"],
    });
  });

  it("clears default agents while keeping config valid", async () => {
    const store = new ProjectConfigStore();
    await store.saveAgents(projectDir, ["codex"]);
    await store.clearAgents(projectDir);

    await expect(store.load(projectDir)).resolves.toMatchObject({
      version: 1,
    });
    const loaded = await store.load(projectDir);
    expect(loaded?.agents).toBeUndefined();
  });
});
