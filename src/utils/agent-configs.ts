import type { ResourceType } from "../domain/resource.js";
import path from "node:path";

const AGENT_CONFIGS = [
  {
    name: "cursor",
    aliases: ["cursor"],
    baseDir: ".cursor",
  },
  {
    name: "claude-code",
    aliases: ["claude", "claude-code", "claude code", "claude_code"],
    baseDir: ".claude",
  },
  {
    name: "codex",
    aliases: ["codex"],
    baseDir: ".agents",
  },
  {
    name: "openclaw",
    aliases: ["openclaw", "open-claw", "open claw"],
    baseDir: ".openclaw",
  },
] as const;

type AgentConfig = (typeof AGENT_CONFIGS)[number];
type SupportedAgent = AgentConfig["name"];

const DEFAULT_AGENT: SupportedAgent = "cursor";
const AGENT_ALIASES = buildAgentAliases();

function getTypeDir(type: ResourceType): string {
  if (type === "rule") return "rules";
  if (type === "command") return "commands";
  return "skills";
}

function getAgentBaseDir(agent: SupportedAgent): string {
  return getAgentConfig(agent).baseDir;
}

export function normalizeAgents(agents?: string[]): SupportedAgent[] {
  const normalized = (agents ?? [])
    .map((item) => normalizeAgent(item))
    .filter((item): item is SupportedAgent => Boolean(item));
  if (normalized.length === 0) {
    return [DEFAULT_AGENT];
  }
  return [...new Set(normalized)];
}

export function normalizeAgent(input: string): SupportedAgent | undefined {
  return AGENT_ALIASES.get(input.trim().toLowerCase());
}

export function getProjectResourcePaths(
  projectDir: string,
  type: ResourceType,
  name: string,
  agents?: string[],
): string[] {
  return getResourcePaths(projectDir, type, name, agents);
}

export function getGlobalResourcePaths(
  homeDir: string,
  type: ResourceType,
  name: string,
  agents?: string[],
): string[] {
  return getResourcePaths(homeDir, type, name, agents);
}

function getResourcePaths(
  rootDir: string,
  type: ResourceType,
  name: string,
  agents?: string[],
): string[] {
  const typeDir = getTypeDir(type);
  return normalizeAgents(agents).map((agent) =>
    path.join(rootDir, getAgentBaseDir(agent), typeDir, name),
  );
}

export function getSupportedAgentNames(): string[] {
  return AGENT_CONFIGS.map((config) => config.name);
}

function getAgentConfig(agent: SupportedAgent): AgentConfig {
  const config = AGENT_CONFIGS.find((item) => item.name === agent);
  if (!config) {
    throw new Error(`Unsupported agent config: ${agent}`);
  }
  return config;
}

function buildAgentAliases(): ReadonlyMap<string, SupportedAgent> {
  const aliases = new Map<string, SupportedAgent>();
  for (const config of AGENT_CONFIGS) {
    aliases.set(config.name, config.name);
    for (const alias of config.aliases) {
      aliases.set(alias, config.name);
    }
  }
  return aliases;
}
