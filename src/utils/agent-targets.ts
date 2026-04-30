import type { ResourceType } from "../domain/resource.js";
import path from "node:path";

const SUPPORTED_AGENTS = ["cursor", "claude-code", "codex", "openclaw"] as const;

type SupportedAgent = (typeof SUPPORTED_AGENTS)[number];

const AGENT_ALIASES: Record<string, SupportedAgent> = {
  cursor: "cursor",
  claude: "claude-code",
  "claude-code": "claude-code",
  "claude code": "claude-code",
  claude_code: "claude-code",
  codex: "codex",
  openclaw: "openclaw",
  "open-claw": "openclaw",
  "open claw": "openclaw",
};

function getTypeDir(type: ResourceType): string {
  if (type === "rule") return "rules";
  if (type === "command") return "commands";
  return "skills";
}

function getAgentBaseDir(agent: SupportedAgent): string {
  if (agent === "cursor") return ".cursor";
  if (agent === "claude-code") return ".claude";
  if (agent === "codex") return ".codex";
  return ".openclaw";
}

export function normalizeAgents(agents?: string[]): SupportedAgent[] {
  const normalized = (agents ?? [])
    .map((item) => normalizeAgent(item))
    .filter((item): item is SupportedAgent => Boolean(item));
  if (normalized.length === 0) {
    return ["cursor"];
  }
  return [...new Set(normalized)];
}

export function normalizeAgent(input: string): SupportedAgent | undefined {
  return AGENT_ALIASES[input.trim().toLowerCase()];
}

export function getProjectResourcePaths(
  projectDir: string,
  type: ResourceType,
  name: string,
  agents?: string[],
): string[] {
  const typeDir = getTypeDir(type);
  return normalizeAgents(agents).map((agent) =>
    path.join(projectDir, getAgentBaseDir(agent), typeDir, name),
  );
}

export function getSupportedAgentNames(): string[] {
  return [...SUPPORTED_AGENTS];
}
