import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StateStore } from "../../src/state/state-store.js";

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

describe("StateStore", () => {
  it("creates base dirs under ~/.himan", async () => {
    const store = new StateStore();
    await store.ensureBaseDirs();

    const reposDir = path.join(fakeHomeDir, ".himan", "repos");
    const storeDir = path.join(fakeHomeDir, ".himan", "store");

    await expect(fs.access(reposDir)).resolves.toBeUndefined();
    await expect(fs.access(storeDir)).resolves.toBeUndefined();
  });

  it("saves and loads config", async () => {
    const stateStore = new StateStore();
    const config = {
      source: {
        type: "git" as const,
        repo: "https://github.com/acme/himan.git",
        repoId: "github_com_acme_himan",
      },
    };

    await stateStore.saveConfig(config);
    const loaded = await stateStore.loadConfig();

    expect(loaded).toEqual(config);
  });

  it("returns null when config file does not exist", async () => {
    const stateStore = new StateStore();
    const loaded = await stateStore.loadConfig();
    expect(loaded).toBeNull();
  });
});
