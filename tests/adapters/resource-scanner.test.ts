import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ResourceScanner } from "../../src/adapters/resource/resource-scanner.js";

const tmpDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tmpDirs.map((dir) => fs.rm(dir, { recursive: true, force: true })));
  tmpDirs.length = 0;
});

describe("ResourceScanner", () => {
  it("scans valid rule resources from repo rules directory", async () => {
    const repoDir = await fs.mkdtemp(path.join(os.tmpdir(), "himan-repo-"));
    tmpDirs.push(repoDir);

    await fs.mkdir(path.join(repoDir, "rules", "code-review"), { recursive: true });
    await fs.writeFile(
      path.join(repoDir, "rules", "code-review", "himan.yaml"),
      [
        "name: code-review",
        "type: rule",
        "entry: content.md",
        "description: enforce standards",
        "targets:",
        "  - cursor",
      ].join("\n"),
      "utf8",
    );

    const scanner = new ResourceScanner();
    const resources = await scanner.scanRules(repoDir);

    expect(resources).toEqual([
      {
        name: "code-review",
        type: "rule",
        entry: "content.md",
        description: "enforce standards",
        targets: ["cursor"],
      },
    ]);
  });

  it("skips invalid or non-rule resources", async () => {
    const repoDir = await fs.mkdtemp(path.join(os.tmpdir(), "himan-repo-"));
    tmpDirs.push(repoDir);

    await fs.mkdir(path.join(repoDir, "rules", "invalid"), { recursive: true });
    await fs.writeFile(
      path.join(repoDir, "rules", "invalid", "himan.yaml"),
      ["name: invalid", "type: rule"].join("\n"),
      "utf8",
    );

    await fs.mkdir(path.join(repoDir, "rules", "command-like"), { recursive: true });
    await fs.writeFile(
      path.join(repoDir, "rules", "command-like", "himan.yaml"),
      ["name: command-like", "type: command", "entry: content.md"].join("\n"),
      "utf8",
    );

    const scanner = new ResourceScanner();
    const resources = await scanner.scanRules(repoDir);

    expect(resources).toEqual([]);
  });
});
