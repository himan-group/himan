import type { Command } from "commander";
import { createInterface, type Interface } from "node:readline/promises";
import process from "node:process";
import type { InstallMode, ResourceType } from "../domain/resource.js";
import type { ServiceFactory } from "../services/index.js";
import { getSupportedAgentNames, normalizeAgent } from "../utils/agent-configs.js";
import { errorCodes, HimanError } from "../utils/errors.js";
import { runAction } from "./shared.js";

interface InstallRef {
  type: ResourceType;
  name: string;
  version?: string;
}

interface SetupOptions {
  agent?: string;
  install?: string;
  mode?: string;
  json?: boolean;
}

interface ProvidedSetupInputs {
  gitRepo?: string;
  agents?: string[];
  installRefs: InstallRef[];
  mode?: InstallMode;
}

interface CollectedSetupInputs {
  /** New Git repository URL to initialize. */
  sourceRef?: string;
  /** Existing source name or alias used for installs without switching default. */
  existingSourceRef?: string;
  agents?: string[];
  installRefs: InstallRef[];
  mode?: InstallMode;
}

interface SetupSourceResult {
  source: {
    sourceType: "git" | "registry";
    repo?: string;
    repoId?: string;
    name?: string;
    alias?: string;
  };
  initialized: boolean;
}

type SourceChoice =
  | { kind: "new"; ref: string }
  | { kind: "existing"; ref: string }
  | { kind: "skip" };

export function registerSetupCommand(
  command: Command,
  services: ServiceFactory,
  options: { legacyAlias?: string } = {},
): void {
  const setupCmd = command
    .command("setup")
    .argument("[git_repo]", "Git repository URL")
    .option("--agent <list>", "set current project default agents, comma separated")
    .option(
      "--install <refs>",
      "install resource refs after setup, comma separated: rule/name[@version]",
    )
    .option("--mode <mode>", "install mode for --install: link or copy")
    .option("--json", "output json format")
    .description("Set up Himan sources, default agents, and initial resource installs");
  if (options.legacyAlias) {
    setupCmd.alias(options.legacyAlias);
  }
  setupCmd
    .action(async (gitRepo: string | undefined, options: SetupOptions) => {
      await runAction(async () => {
        await runSetup(services, gitRepo, options);
      });
    });
}

async function runSetup(
  services: ServiceFactory,
  gitRepo: string | undefined,
  options: SetupOptions,
): Promise<void> {
  const agents = parseAgents(options.agent);
  const installRefs = parseInstallRefs(options.install);
  const mode = parseInstallMode(options.mode);
  if (mode && installRefs.length === 0) {
    throw new HimanError(
      errorCodes.CLI_USAGE,
      "Use --mode only with --install.",
    );
  }

  const inputs = await collectSetupInputs(services, {
    gitRepo,
    agents,
    installRefs,
    mode,
  });

  const sourceResult = await resolveSource(services, inputs);
  const agentResult = inputs.agents?.length
    ? await services.setAgents(inputs.agents, "project", process.cwd())
    : undefined;
  const installed = [];
  for (const ref of inputs.installRefs) {
    installed.push(
      await services.install(
        ref.type,
        ref.name,
        ref.version,
        process.cwd(),
        inputs.agents,
        inputs.mode,
        { source: inputs.existingSourceRef },
      ),
    );
  }

  if (options.json) {
    process.stdout.write(
      `${JSON.stringify({ source: sourceResult.source, agents: agentResult, installed }, null, 2)}\n`,
    );
    return;
  }

  if (sourceResult.initialized) {
    process.stdout.write(
      `Initialized ${sourceResult.source.sourceType} source: ${sourceResult.source.repo}\n`,
    );
  } else {
    process.stdout.write(
      `Using source: ${sourceResult.source.alias ?? sourceResult.source.name ?? sourceResult.source.repo}\n`,
    );
  }
  if (agentResult) {
    process.stdout.write(
      `Using agents (${agentResult.scope}): ${agentResult.agents.join(", ")}\n`,
    );
  }
  for (const item of installed) {
    process.stdout.write(`Installed ${item.type}/${item.name}@${item.version}\n`);
  }
}

async function collectSetupInputs(
  services: ServiceFactory,
  provided: ProvidedSetupInputs,
): Promise<CollectedSetupInputs> {
  if (!isTTY()) {
    if (!provided.gitRepo) {
      const sources = await services.listSources();
      if (sources.length === 0) {
        throw new HimanError(
          errorCodes.CLI_USAGE,
          "Missing required argument: git repository URL.\n"
            + "Run `himan setup <git_repo>` to initialize a Git source, or configure a source first.",
        );
      }
    }
    return {
      sourceRef: provided.gitRepo,
      agents: provided.agents,
      installRefs: provided.installRefs,
      mode: provided.mode,
    };
  }

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const sources = await services.listSources();
    const sourceChoice = provided.gitRepo
      ? { kind: "new" as const, ref: provided.gitRepo }
      : await promptSource(rl, sources);
    const agents = provided.agents ?? (await promptAgents(rl));
    const installRefs = provided.installRefs
      ?? (await promptInstallRefs(rl, services, sourceChoice));
    const mode = provided.mode ?? (await promptMode(rl));

    const inputs: CollectedSetupInputs = {
      agents,
      installRefs,
      mode,
    };
    if (sourceChoice.kind === "new") {
      inputs.sourceRef = sourceChoice.ref;
    } else if (sourceChoice.kind === "existing") {
      inputs.existingSourceRef = sourceChoice.ref;
    }
    if (!(await confirm(rl, inputs))) {
      throw new HimanError(errorCodes.CLI_USAGE, "Setup cancelled.");
    }
    return inputs;
  } finally {
    rl.close();
  }
}

async function promptSource(
  rl: Interface,
  sources: Array<{ name: string; alias?: string }>,
): Promise<SourceChoice> {
  const hasSources = sources.length > 0;
  for (;;) {
    if (hasSources) {
      process.stdout.write("Configured sources:\n");
      for (const source of sources) {
        const label = source.alias ? `${source.alias} (${source.name})` : source.name;
        process.stdout.write(`- ${label}\n`);
      }
      process.stdout.write(
        "Enter a source name/alias, a new Git URL, or press Enter to use the current default source: ",
      );
    } else {
      process.stdout.write("No source configured. Enter a Git repository URL: ");
    }
    const answer = (await rl.question("")).trim();
    if (!answer) {
      if (hasSources) return { kind: "skip" };
      continue;
    }
    const existing = sources.find(
      (source) => (source.alias ?? source.name) === answer,
    );
    if (existing) return { kind: "existing", ref: answer };
    if (looksLikeGitUrl(answer)) return { kind: "new", ref: answer };
    process.stdout.write(
      `Invalid input: ${answer} is neither a configured source nor a Git URL.\n`,
    );
  }
}

async function promptAgents(rl: Interface): Promise<string[]> {
  for (;;) {
    const answer = (
      await rl.question("Default agents (comma separated) [codex]: ")
    ).trim();
    if (!answer) return ["codex"];
    const agents = parseAgents(answer);
    if (agents?.length) return agents;
    process.stdout.write(
      `Unsupported agent. Supported agents: ${getSupportedAgentNames().join(", ")}\n`,
    );
  }
}

async function promptInstallRefs(
  rl: Interface,
  services: ServiceFactory,
  sourceChoice: SourceChoice,
): Promise<InstallRef[]> {
  if (sourceChoice.kind === "new") {
    process.stdout.write(
      "Resources cannot be listed before the new source is initialized.\n",
    );
  } else {
    const resources = await listSourceResources(
      services,
      sourceChoice.kind === "existing" ? sourceChoice.ref : undefined,
    );
    if (resources.length > 0) {
      process.stdout.write("Available resources:\n");
      for (const ref of resources) {
        process.stdout.write(`- ${ref}\n`);
      }
    } else {
      process.stdout.write("No active resources found in the source.\n");
    }
  }

  for (;;) {
    const answer = await rl.question(
      "Resources to install (comma separated, e.g. rule/code-review) or press Enter to skip: ",
    );
    if (!answer.trim()) return [];
    try {
      return parseInstallRefs(answer);
    } catch (error) {
      process.stdout.write(
        `${error instanceof HimanError ? error.message : String(error)}\n`,
      );
    }
  }
}

async function promptMode(rl: Interface): Promise<InstallMode> {
  for (;;) {
    const answer = (
      await rl.question("Install mode (link/copy) [copy]: ")
    ).trim().toLowerCase();
    if (!answer) return "copy";
    if (answer === "link" || answer === "copy") return answer;
    process.stdout.write("Install mode must be link or copy.\n");
  }
}

async function confirm(rl: Interface, inputs: CollectedSetupInputs): Promise<boolean> {
  const sourceLabel = inputs.sourceRef
    ? inputs.sourceRef
    : inputs.existingSourceRef
      ? inputs.existingSourceRef
      : "(current default source)";
  const installLabel = inputs.installRefs.length === 0
    ? "(none)"
    : inputs.installRefs
      .map((ref) => `${ref.type}/${ref.name}${ref.version ? `@${ref.version}` : ""}`)
      .join(", ");
  process.stdout.write("\nSetup summary:\n");
  process.stdout.write(`- source: ${sourceLabel}\n`);
  process.stdout.write(`- agents: ${inputs.agents?.join(", ") ?? "(unchanged)"}\n`);
  process.stdout.write(`- install: ${installLabel}\n`);
  process.stdout.write(`- mode: ${inputs.mode ?? "copy"}\n`);
  const answer = (await rl.question("Proceed? [y/N]: ")).trim().toLowerCase();
  return answer === "y" || answer === "yes";
}

async function resolveSource(
  services: ServiceFactory,
  inputs: CollectedSetupInputs,
): Promise<SetupSourceResult> {
  if (inputs.sourceRef) {
    const source = await services.initSource("git", inputs.sourceRef);
    return { source, initialized: true };
  }

  const sources = await services.listSources();
  const selected = inputs.existingSourceRef
    ? sources.find(
      (source) => (source.alias ?? source.name) === inputs.existingSourceRef,
    )
    : sources.find((source) => source.isDefault);
  if (!selected) {
    throw new HimanError(
      errorCodes.CONFIG_NOT_FOUND,
      "No source configured. Run `himan setup <git_repo>` first.",
    );
  }
  return {
    source: {
      sourceType: selected.type,
      repo: selected.repo,
      repoId: selected.repoId,
      name: selected.name,
      alias: selected.alias,
    },
    initialized: false,
  };
}

async function listSourceResources(
  services: ServiceFactory,
  sourceRef?: string,
): Promise<string[]> {
  const refs: string[] = [];
  const types: ResourceType[] = ["rule", "command", "skill", "config"];
  for (const type of types) {
    const resources = await services.list(type, undefined, { source: sourceRef });
    for (const resource of resources) {
      refs.push(`${type}/${resource.name}`);
    }
  }
  return refs;
}

function isTTY(): boolean {
  return Boolean(process.stdin.isTTY);
}

function looksLikeGitUrl(input: string): boolean {
  return /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(input) || input.startsWith("git@");
}

function ensureResourceType(type: string): ResourceType {
  if (type !== "rule" && type !== "command" && type !== "skill" && type !== "config") {
    throw new HimanError(
      errorCodes.UNSUPPORTED_RESOURCE_TYPE,
      `Unsupported resource type: ${type}`,
    );
  }
  return type;
}

function parseInstallRefs(input?: string): InstallRef[] {
  if (!input) return [];
  const refs = input
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  if (refs.length === 0) {
    throw new HimanError(errorCodes.INVALID_INPUT, "Install list cannot be empty.");
  }

  return refs.map((ref) => {
    const parts = ref.split("/");
    if (parts.length !== 2 || !parts[0] || !parts[1]) {
      throw new HimanError(
        errorCodes.INVALID_INPUT,
        `Invalid install ref: ${ref}. Use type/name[@version].`,
      );
    }
    const { name, version } = parseNameVersion(parts[1]);
    if (!name) {
      throw new HimanError(
        errorCodes.INVALID_INPUT,
        `Invalid install ref: ${ref}. Use type/name[@version].`,
      );
    }
    return {
      type: ensureResourceType(parts[0]),
      name,
      version,
    };
  });
}

function parseNameVersion(input: string): { name: string; version?: string } {
  const idx = input.lastIndexOf("@");
  if (idx <= 0) return { name: input };
  return { name: input.slice(0, idx), version: input.slice(idx + 1) };
}

function parseInstallMode(input?: string): InstallMode | undefined {
  if (!input) return undefined;
  const normalized = input.trim().toLowerCase();
  if (normalized === "link" || normalized === "copy") {
    return normalized;
  }
  throw new HimanError(
    errorCodes.INVALID_INPUT,
    `Unsupported install mode: ${input}. Supported modes: link, copy`,
  );
}

function parseAgents(input?: string): string[] | undefined {
  if (!input) return undefined;
  const agents = input
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  if (agents.length === 0) return undefined;

  const supported = getSupportedAgentNames();
  for (const agent of agents) {
    if (!normalizeAgent(agent)) {
      throw new HimanError(
        errorCodes.INVALID_INPUT,
        `Unsupported agent: ${agent}. Supported agents: ${supported.join(", ")}`,
      );
    }
  }
  return agents;
}
