import type { Command } from "commander";
import type { ServiceFactory } from "../services/index.js";
import { HimanError, errorCodes } from "../utils/errors.js";
import { getSupportedAgentNames, normalizeAgent } from "../utils/agent-configs.js";
import { runAction } from "./shared.js";

type AgentScope = "global" | "project";

export function registerAgentCommands(command: Command, services: ServiceFactory): void {
  command
    .command("list")
    .option("--json", "output json format")
    .description("List supported agents")
    .action(async (options: { json?: boolean }) => {
      await runAction(async () => {
        const agents = getSupportedAgentNames();
        if (options.json) {
          process.stdout.write(`${JSON.stringify(agents, null, 2)}\n`);
          return;
        }
        for (const agent of agents) {
          process.stdout.write(`- ${agent}\n`);
        }
      });
    });

  command
    .command("use")
    .argument("<agent_list>", "agent list, comma separated")
    .option("-g, --global", "save as global default")
    .option("--project", "save as current project default")
    .option("--json", "output json format")
    .description("Set default agents globally or for current project")
    .action(
      async (
        agentList: string,
        options: { global?: boolean; project?: boolean; json?: boolean },
      ) => {
        await runAction(async () => {
          const scope = parseScope(options);
          const result = await services.setAgents(
            parseAgents(agentList),
            scope,
            process.cwd(),
          );
          if (options.json) {
            process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
            return;
          }
          process.stdout.write(
            `Using agents (${result.scope}): ${result.agents.join(", ")}\n`,
          );
        });
      },
    );

  command
    .command("current")
    .option("--json", "output json format")
    .description("Show configured and effective default agents")
    .action(async (options: { json?: boolean }) => {
      await runAction(async () => {
        const settings = await services.getAgentSettings(process.cwd());
        if (options.json) {
          process.stdout.write(`${JSON.stringify(settings, null, 2)}\n`);
          return;
        }
        process.stdout.write(`effective: ${settings.effective.join(", ")}\n`);
        process.stdout.write(`project: ${(settings.project ?? []).join(", ") || "-"}\n`);
        process.stdout.write(`global: ${(settings.global ?? []).join(", ") || "-"}\n`);
      });
    });

  command
    .command("clear")
    .option("-g, --global", "clear global default agents")
    .option("--project", "clear current project default agents")
    .option("--json", "output json format")
    .description("Clear configured default agents")
    .action(
      async (options: { global?: boolean; project?: boolean; json?: boolean }) => {
        await runAction(async () => {
          const result = await services.clearAgents(parseScope(options), process.cwd());
          if (options.json) {
            process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
            return;
          }
          process.stdout.write(`Cleared agents (${result.scope}).\n`);
        });
      },
    );
}

function parseScope(options: { global?: boolean; project?: boolean }): AgentScope {
  if (options.global && options.project) {
    throw new HimanError(
      errorCodes.CLI_USAGE,
      "Use only one of -g/--global or --project.",
    );
  }
  return options.global ? "global" : "project";
}

function parseAgents(input: string): string[] {
  const agents = input
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  if (agents.length === 0) {
    throw new HimanError(errorCodes.INVALID_INPUT, "Agent list cannot be empty.");
  }

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
