import type { ResourceType } from "../domain/resource.js";
import path from "node:path";

const AGENT_CONFIGS = [
  {
    name: "cursor",
    aliases: ["cursor"],
    baseDir: ".cursor",
    legacyBaseDirs: [],
  },
  {
    name: "claude-code",
    aliases: ["claude", "claude-code", "claude code", "claude_code"],
    baseDir: ".claude",
    legacyBaseDirs: [],
  },
  {
    name: "codex",
    aliases: ["codex"],
    baseDir: ".agents",
    legacyBaseDirs: [".codex"],
  },
  {
    name: "openclaw",
    aliases: ["openclaw", "open-claw", "open claw"],
    baseDir: ".openclaw",
    legacyBaseDirs: [],
  },
  {
    name: "copilot",
    aliases: ["copilot", "github-copilot", "vs-code-copilot"],
    baseDir: ".github/copilot",
    legacyBaseDirs: [],
  },
] as const;

type AgentConfig = (typeof AGENT_CONFIGS)[number];
type SupportedAgent = AgentConfig["name"];

const DEFAULT_AGENT: SupportedAgent = "codex";
const AGENT_ALIASES = buildAgentAliases();

function getTypeDir(type: ResourceType): string {
  if (type === "rule") return "rules";
  if (type === "command") return "commands";
  if (type === "config") return "configs";
  return "skills";
}

function getAgentBaseDir(agent: SupportedAgent, type?: ResourceType): string {
  const config = getAgentConfig(agent);
  if (agent === "codex") {
    if (type === "rule" || type === "config") {
      return ".codex";
    }
    return ".agents";
  }
  return config.baseDir;
}

function getAgentBaseDirCandidates(agent: SupportedAgent): string[] {
  const config = getAgentConfig(agent);
  const candidates = [config.baseDir, ...(config.legacyBaseDirs ?? [])];
  return [...new Set(candidates)];
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
    path.join(rootDir, getAgentBaseDir(agent, type), typeDir, name),
  );
}

export function getSupportedAgentNames(): string[] {
  return AGENT_CONFIGS.map((config) => config.name);
}

export function getResourcePathCandidatesForAgent(
  rootDir: string,
  type: ResourceType,
  name: string,
  agent: string,
): string[] {
  const normalized = normalizeAgent(agent);
  if (!normalized) return [];
  const typeDir = getTypeDir(type);
  const baseDirs =
    normalized === "codex"
      ? type === "config"
        ? [".codex"]
        : type === "rule"
          ? [".codex", ".agents"]
          : [".agents", ".codex"]
      : getAgentBaseDirCandidates(normalized);
  return baseDirs.map((baseDir) =>
    path.join(rootDir, baseDir, typeDir, name),
  );
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
