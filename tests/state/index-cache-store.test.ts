import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IndexCacheStore } from "../../src/state/index-cache-store.js";

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

describe("IndexCacheStore", () => {
  it("upserts and gets cached resources by repo and type", async () => {
    const store = new IndexCacheStore();
    await store.upsert("repo-a", "rule", 123, [
      {
        name: "code-review",
        type: "rule",
        entry: "content.md",
        description: "desc",
        agents: ["cursor"],
      },
    ]);

    const found = await store.get("repo-a", "rule");
    expect(found?.repoId).toBe("repo-a");
    expect(found?.type).toBe("rule");
    expect(found?.baseDirMtimeMs).toBe(123);
    expect(found?.resources).toEqual([
      {
        name: "code-review",
        type: "rule",
        entry: "content.md",
        description: "desc",
        agents: ["cursor"],
      },
    ]);
  });
});
