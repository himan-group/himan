import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LocalSourceAdapter } from "../../src/adapters/source/local-source-adapter.js";

let tmpRoot = "";

beforeEach(async () => {
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "himan-local-source-"));
});

afterEach(async () => {
  if (tmpRoot) {
    await fs.rm(tmpRoot, { recursive: true, force: true });
  }
});

describe("LocalSourceAdapter", () => {
  it("lists, versions, and pulls resources from the local root", async () => {
    const adapter = new LocalSourceAdapter();
    const rootDir = path.join(tmpRoot, "local-source");
    await adapter.init({ type: "local", repo: rootDir, repoDir: rootDir });

    const resourceDir = path.join(rootDir, "skills", "hello-skill");
    await fs.mkdir(resourceDir, { recursive: true });
    await fs.writeFile(path.join(resourceDir, "SKILL.md"), "# hello-skill\n", "utf8");
    await fs.writeFile(
      path.join(resourceDir, "himan.yaml"),
      "name: hello-skill\ntype: skill\nentry: SKILL.md\nversion: 1.2.3\n",
      "utf8",
    );

    const resources = await adapter.list("skill");
    expect(resources).toEqual([
      expect.objectContaining({
        name: "hello-skill",
        type: "skill",
        version: "1.2.3",
        entry: "SKILL.md",
      }),
    ]);

    expect(await adapter.history("skill", "hello-skill")).toEqual([
      { version: "1.2.3", raw: "skill/hello-skill@1.2.3" },
    ]);

    const targetDir = path.join(tmpRoot, "store", "skill", "hello-skill", "1.2.3");
    await adapter.pull("skill", "hello-skill", "1.2.3", targetDir);
    await expect(
      fs.readFile(path.join(targetDir, "SKILL.md"), "utf8"),
    ).resolves.toBe("# hello-skill\n");
  });

  it("returns empty history for resources without himan.yaml", async () => {
    const adapter = new LocalSourceAdapter();
    const rootDir = path.join(tmpRoot, "local-source");
    await adapter.init({ type: "local", repo: rootDir, repoDir: rootDir });
    expect(await adapter.history("rule", "missing")).toEqual([]);
    expect(await adapter.isArchived("rule", "missing")).toBe(false);
  });

  it("rejects unsupported operations", async () => {
    const adapter = new LocalSourceAdapter();
    const rootDir = path.join(tmpRoot, "local-source");
    await adapter.init({ type: "local", repo: rootDir, repoDir: rootDir });
    await expect(
      adapter.publish("rule", "x", "1.0.0", "/tmp/x"),
    ).rejects.toMatchObject({ code: "E_NOT_IMPLEMENTED" });
  });
});
