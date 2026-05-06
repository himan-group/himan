import type { Command } from "commander";
import type { InstallMode, ResourceType } from "../domain/resource.js";
import type { ServiceFactory } from "../services/index.js";
import { HimanError, errorCodes } from "../utils/errors.js";
import { getSupportedAgentNames, normalizeAgent } from "../utils/agent-configs.js";
import { runAction } from "./shared.js";

export function registerProjectCommands(command: Command, services: ServiceFactory): void {
  command
    .command("install")
    .argument("[type]", "resource type")
    .argument("[name[@version]]", "resource name with optional @version")
    .option("--agent <list>", "install target agents, comma separated")
    .option("--mode <mode>", "install mode: link or copy")
    .description("Install resource, or install from himan.lock")
    .action(
      async (
        type: string | undefined,
        nameVersion: string | undefined,
        options: { agent?: string; mode?: string },
      ) => {
        await runAction(async () => {
          const agents = parseAgents(options.agent);
          const mode = parseInstallMode(options.mode);
          if (!type && !nameVersion) {
            const results = await services.installFromLock(process.cwd(), agents, mode);
            if (results.length === 0) {
              process.stdout.write("No resources in lock file.\n");
              return;
            }
            for (const item of results) {
              process.stdout.write(`Installed ${item.type}/${item.name}@${item.version}\n`);
            }
            return;
          }

          if (!type || !nameVersion) {
            throw new HimanError(
              errorCodes.CLI_USAGE,
              "Install usage:\n"
                + "  - himan install  # install from himan.lock\n"
                + "  - himan install <type> <name[@version]> [--mode link|copy]  # install single resource",
            );
          }

          const resourceType = ensureResourceType(type);
          const { name, version } = parseNameVersion(nameVersion);
          const result = await services.install(
            resourceType,
            name,
            version,
            process.cwd(),
            agents,
            mode,
          );
          process.stdout.write(
            `Installed ${result.type}/${result.name}@${result.version}\n`,
          );
        });
      },
    );

  command
    .command("dev")
    .argument("<type>", "resource type")
    .argument("<name>", "resource name")
    .description("Switch resource to development mode")
    .action(async (type: string, name: string) => {
      await runAction(async () => {
        const resourceType = ensureResourceType(type);
        const result = await services.dev(resourceType, name, process.cwd());
        process.stdout.write(
          `Switched ${result.type}/${result.name} to dev mode: ${result.devPath}\n`,
        );
      });
    });

  command
    .command("uninstall")
    .argument("<type>", "resource type")
    .argument("<name>", "resource name")
    .description("Uninstall resource from project and lock")
    .action(async (type: string, name: string) => {
      await runAction(async () => {
        const resourceType = ensureResourceType(type);
        const result = await services.uninstall(resourceType, name, process.cwd());
        process.stdout.write(`Uninstalled ${result.type}/${result.name}\n`);
      });
    });

  command
    .command("publish")
    .argument("<type>", "resource type")
    .argument("<name>", "resource name")
    .option("--patch", "patch release")
    .option("--minor", "minor release")
    .option("--major", "major release")
    .description("Publish resource (default: --patch)")
    .action(
      async (
        type: string,
        name: string,
        options: { patch?: boolean; minor?: boolean; major?: boolean },
      ) => {
        await runAction(async () => {
          const resourceType = ensureResourceType(type);
          const releaseType = resolveReleaseType(options);
          const result = await services.publish(
            resourceType,
            name,
            releaseType,
            process.cwd(),
          );
          process.stdout.write(
            `Published ${result.type}/${result.name}@${result.version}\n`,
          );
        });
      },
    );
}

function ensureResourceType(type: string): ResourceType {
  if (type !== "rule" && type !== "command" && type !== "skill") {
    throw new HimanError(
      errorCodes.UNSUPPORTED_RESOURCE_TYPE,
      `Unsupported resource type: ${type}`,
    );
  }
  return type;
}

function parseNameVersion(input: string): { name: string; version?: string } {
  const idx = input.lastIndexOf("@");
  if (idx <= 0) return { name: input };
  return { name: input.slice(0, idx), version: input.slice(idx + 1) };
}

function resolveReleaseType(options: {
  patch?: boolean;
  minor?: boolean;
  major?: boolean;
}): "patch" | "minor" | "major" {
  const selected = [
    options.patch ? "patch" : undefined,
    options.minor ? "minor" : undefined,
    options.major ? "major" : undefined,
  ].filter(Boolean) as Array<"patch" | "minor" | "major">;

  if (selected.length > 1) {
    throw new HimanError(
      errorCodes.CLI_USAGE,
      "Use only one of --patch, --minor or --major.",
    );
  }
  return selected[0] ?? "patch";
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
