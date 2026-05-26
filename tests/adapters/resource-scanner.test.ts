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
        "comment:",
        "  score: 9",
        "  text: Useful default checklist",
        "agents:",
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
        comment: {
          score: 9,
          text: "Useful default checklist",
        },
        agents: ["cursor"],
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

  it("scans command, skill, and config resources by type", async () => {
    const repoDir = await fs.mkdtemp(path.join(os.tmpdir(), "himan-repo-"));
    tmpDirs.push(repoDir);

    await fs.mkdir(path.join(repoDir, "commands", "sync-docs"), { recursive: true });
    await fs.writeFile(
      path.join(repoDir, "commands", "sync-docs", "himan.yaml"),
      [
        "name: sync-docs",
        "type: command",
        "entry: content.md",
        "description: sync docs",
      ].join("\n"),
      "utf8",
    );

    await fs.mkdir(path.join(repoDir, "skills", "risk-check"), { recursive: true });
    await fs.writeFile(
      path.join(repoDir, "skills", "risk-check", "himan.yaml"),
      [
        "name: risk-check",
        "type: skill",
        "entry: SKILL.md",
        "description: check project risks",
      ].join("\n"),
      "utf8",
    );

    await fs.mkdir(path.join(repoDir, "configs", "team-default"), { recursive: true });
    await fs.writeFile(
      path.join(repoDir, "configs", "team-default", "himan.yaml"),
      [
        "name: team-default",
        "type: config",
        "entry: config.toml",
        "description: codex team config",
        "agents:",
        "  - codex",
      ].join("\n"),
      "utf8",
    );

    const scanner = new ResourceScanner();
    const commands = await scanner.scanByType(repoDir, "command");
    const skills = await scanner.scanByType(repoDir, "skill");
    const configs = await scanner.scanByType(repoDir, "config");

    expect(commands).toEqual([
      {
        name: "sync-docs",
        type: "command",
        entry: "content.md",
        description: "sync docs",
        agents: [],
      },
    ]);
    expect(skills).toEqual([
      {
        name: "risk-check",
        type: "skill",
        entry: "SKILL.md",
        description: "check project risks",
        agents: [],
      },
    ]);
    expect(configs).toEqual([
      {
        name: "team-default",
        type: "config",
        entry: "config.toml",
        description: "codex team config",
        agents: ["codex"],
      },
    ]);
  });

  it("infers resources from default entries when himan.yaml is missing", async () => {
    const repoDir = await fs.mkdtemp(path.join(os.tmpdir(), "himan-repo-"));
    tmpDirs.push(repoDir);

    await fs.mkdir(path.join(repoDir, "rules", "legacy-rule"), { recursive: true });
    await fs.writeFile(
      path.join(repoDir, "rules", "legacy-rule", "content.md"),
      "# legacy-rule\n",
      "utf8",
    );

    await fs.mkdir(path.join(repoDir, "skills", "legacy-skill"), { recursive: true });
    await fs.writeFile(
      path.join(repoDir, "skills", "legacy-skill", "SKILL.md"),
      [
        "---",
        "name: legacy-skill",
        "description: Legacy skill description",
        "agents:",
        "  - codex",
        "---",
        "",
        "# legacy-skill",
      ].join("\n"),
      "utf8",
    );

    await fs.mkdir(path.join(repoDir, "configs", "legacy-config"), { recursive: true });
    await fs.writeFile(
      path.join(repoDir, "configs", "legacy-config", "config.toml"),
      'model = "gpt-5.5"\n',
      "utf8",
    );

    const scanner = new ResourceScanner();
    const rules = await scanner.scanByType(repoDir, "rule");
    const skills = await scanner.scanByType(repoDir, "skill");
    const configs = await scanner.scanByType(repoDir, "config");

    expect(rules).toEqual([
      {
        name: "legacy-rule",
        type: "rule",
        entry: "content.md",
        description: undefined,
        agents: [],
      },
    ]);
    expect(skills).toEqual([
      {
        name: "legacy-skill",
        type: "skill",
        entry: "SKILL.md",
        description: "Legacy skill description",
        agents: ["codex"],
      },
    ]);
    expect(configs).toEqual([
      {
        name: "legacy-config",
        type: "config",
        entry: "config.toml",
        description: undefined,
        agents: [],
      },
    ]);
  });

  it("scans archived resources from archive type directories", async () => {
    const repoDir = await fs.mkdtemp(path.join(os.tmpdir(), "himan-repo-"));
    tmpDirs.push(repoDir);

    await fs.mkdir(path.join(repoDir, "archive", "rules", "old-rule"), {
      recursive: true,
    });
    await fs.writeFile(
      path.join(repoDir, "archive", "rules", "old-rule", "himan.yaml"),
      [
        "name: old-rule",
        "type: rule",
        "entry: content.md",
        "description: old rule",
        "archived: true",
        "archivedAt: 2026-05-14T00:00:00.000Z",
        "archiveReason: replaced",
      ].join("\n"),
      "utf8",
    );

    const scanner = new ResourceScanner();
    const resources = await scanner.scanByType(repoDir, "rule", {
      archived: true,
    });

    expect(resources).toEqual([
      {
        name: "old-rule",
        type: "rule",
        entry: "content.md",
        description: "old rule",
        agents: [],
        archived: true,
        archivedAt: "2026-05-14T00:00:00.000Z",
        archiveReason: "replaced",
      },
    ]);
  });
});
