import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  getProjectResourcePaths,
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
    expect(normalizeAgent("unknown")).toBeUndefined();
  });

  it("deduplicates supported agents and defaults to cursor", () => {
    expect(normalizeAgents(["codex", "CODEX", "claude"])).toEqual([
      "codex",
      "claude-code",
    ]);
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
      ]),
    ).toEqual([
      path.join(projectDir, ".claude", "skills", "risk-check"),
      path.join(projectDir, ".agents", "skills", "risk-check"),
      path.join(projectDir, ".openclaw", "skills", "risk-check"),
    ]);
  });

  it("lists supported canonical agent names", () => {
    expect(getSupportedAgentNames()).toEqual([
      "cursor",
      "claude-code",
      "codex",
      "openclaw",
    ]);
  });
});
