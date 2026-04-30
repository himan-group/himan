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
      sources: {
        default: "default",
        items: {
          default: {
            type: "git" as const,
            repo: "https://github.com/acme/himan.git",
            repoId: "github_com_acme_himan",
          },
        },
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

  it("saves and loads agent-only config", async () => {
    const stateStore = new StateStore();
    await stateStore.saveConfig({ agents: ["codex"] });

    const loaded = await stateStore.loadConfig();
    expect(loaded).toEqual({ agents: ["codex"] });
  });

  it("normalizes legacy config with only source", async () => {
    const stateStore = new StateStore();
    const configPath = stateStore.getConfigPath();
    await fs.mkdir(path.dirname(configPath), { recursive: true });
    await fs.writeFile(
      configPath,
      JSON.stringify(
        {
          source: {
            type: "git",
            repo: "https://github.com/acme/himan.git",
            repoId: "github_com_acme_himan",
          },
        },
        null,
        2,
      ),
      "utf8",
    );

    const loaded = await stateStore.loadConfig();
    expect(loaded?.sources?.default).toBe("default");
    expect(loaded?.sources?.items.default.repo).toBe("https://github.com/acme/himan.git");
  });
});
