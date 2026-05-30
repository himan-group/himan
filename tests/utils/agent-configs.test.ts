import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  getGlobalResourcePaths,
  getProjectResourcePaths,
  getResourcePathCandidatesForAgent,
  getSupportedAgentNames,
  normalizeAgent,
  normalizeAgents,
} from "../../src/utils/agent-configs.js";

describe("agent configs", () => {
  it("normalizes canonical names and aliases", () => {
    expect(normalizeAgent("cursor")).toBe("cursor");
    expect(normalizeAgent("Claude Code")).toBe("claude-code");
    expect(normalizeAgent("claude_code")).toBe("claude-code");
    expect(normalizeAgent("open-claw")).toBe("openclaw");
    expect(normalizeAgent("github-copilot")).toBe("copilot");
    expect(normalizeAgent("vs-code-copilot")).toBe("copilot");
    expect(normalizeAgent("unknown")).toBeUndefined();
  });

  it("deduplicates supported agents and defaults to cursor", () => {
    expect(normalizeAgents(["codex", "CODEX", "claude"])).toEqual([
      "codex",
      "claude-code",
    ]);
    expect(normalizeAgents(["copilot", "github-copilot"])).toEqual(["copilot"]);
    expect(normalizeAgents(["unknown"])).toEqual(["cursor"]);
    expect(normalizeAgents()).toEqual(["cursor"]);
  });

  it("builds project resource paths from agent config", () => {
    const projectDir = path.join("tmp", "project");

    expect(
      getProjectResourcePaths(projectDir, "skill", "risk-check", [
        "claude",
        "codex",
        "open-claw",
        "copilot",
      ]),
    ).toEqual([
      path.join(projectDir, ".claude", "skills", "risk-check"),
      path.join(projectDir, ".agents", "skills", "risk-check"),
      path.join(projectDir, ".openclaw", "skills", "risk-check"),
      path.join(projectDir, ".github", "copilot", "skills", "risk-check"),
    ]);
  });

  it("builds global resource paths from agent config", () => {
    const homeDir = path.join("tmp", "home");

    expect(
      getGlobalResourcePaths(homeDir, "rule", "code-review", [
        "cursor",
        "codex",
      ]),
    ).toEqual([
      path.join(homeDir, ".cursor", "rules", "code-review"),
      path.join(homeDir, ".codex", "rules", "code-review"),
    ]);
  });

  it("builds codex rule paths under .codex", () => {
    const projectDir = path.join("tmp", "project");
    expect(
      getProjectResourcePaths(projectDir, "rule", "code-review", ["codex"]),
    ).toEqual([path.join(projectDir, ".codex", "rules", "code-review")]);
  });

  it("builds codex config paths under .codex", () => {
    const projectDir = path.join("tmp", "project");
    const homeDir = path.join("tmp", "home");

    expect(
      getProjectResourcePaths(projectDir, "config", "team-default", ["codex"]),
    ).toEqual([path.join(projectDir, ".codex", "configs", "team-default")]);
    expect(
      getGlobalResourcePaths(homeDir, "config", "team-default", ["codex"]),
    ).toEqual([path.join(homeDir, ".codex", "configs", "team-default")]);
  });

  it("includes .codex as a compatible codex skill path candidate", () => {
    const projectDir = path.join("tmp", "project");
    expect(
      getResourcePathCandidatesForAgent(projectDir, "skill", "risk-check", "codex"),
    ).toEqual([
      path.join(projectDir, ".agents", "skills", "risk-check"),
      path.join(projectDir, ".codex", "skills", "risk-check"),
    ]);
  });

  it("prefers .codex and still supports .agents for codex rule path candidates", () => {
    const projectDir = path.join("tmp", "project");
    expect(
      getResourcePathCandidatesForAgent(projectDir, "rule", "code-review", "codex"),
    ).toEqual([
      path.join(projectDir, ".codex", "rules", "code-review"),
      path.join(projectDir, ".agents", "rules", "code-review"),
    ]);
  });

  it("uses only .codex for codex config path candidates", () => {
    const projectDir = path.join("tmp", "project");
    expect(
      getResourcePathCandidatesForAgent(projectDir, "config", "team-default", "codex"),
    ).toEqual([path.join(projectDir, ".codex", "configs", "team-default")]);
  });

  it("lists supported canonical agent names", () => {
    expect(getSupportedAgentNames()).toEqual([
      "cursor",
      "claude-code",
      "codex",
      "openclaw",
      "copilot",
    ]);
  });

  it("builds copilot rule paths under .github/copilot", () => {
    const projectDir = path.join("tmp", "project");
    expect(
      getProjectResourcePaths(projectDir, "rule", "code-review", ["copilot"]),
    ).toEqual([path.join(projectDir, ".github", "copilot", "rules", "code-review")]);
  });

  it("builds copilot skill paths under .github/copilot", () => {
    const projectDir = path.join("tmp", "project");
    expect(
      getProjectResourcePaths(projectDir, "skill", "my-skill", ["copilot"]),
    ).toEqual([path.join(projectDir, ".github", "copilot", "skills", "my-skill")]);
  });

  it("builds copilot global resource paths", () => {
    const homeDir = path.join("tmp", "home");
    expect(
      getGlobalResourcePaths(homeDir, "rule", "code-review", ["copilot"]),
    ).toEqual([path.join(homeDir, ".github", "copilot", "rules", "code-review")]);
    expect(
      getGlobalResourcePaths(homeDir, "skill", "my-skill", ["copilot"]),
    ).toEqual([path.join(homeDir, ".github", "copilot", "skills", "my-skill")]);
  });

  it("uses only .github/copilot for copilot path candidates", () => {
    const projectDir = path.join("tmp", "project");
    expect(
      getResourcePathCandidatesForAgent(projectDir, "rule", "code-review", "copilot"),
    ).toEqual([path.join(projectDir, ".github", "copilot", "rules", "code-review")]);
    expect(
      getResourcePathCandidatesForAgent(projectDir, "skill", "my-skill", "copilot"),
    ).toEqual([path.join(projectDir, ".github", "copilot", "skills", "my-skill")]);
  });
});
