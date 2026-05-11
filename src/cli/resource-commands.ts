import type { Command } from "commander";
import type { ResourceMeta, ResourceType } from "../domain/resource.js";
import type { ServiceFactory } from "../services/index.js";
import { HimanError, errorCodes } from "../utils/errors.js";
import { getSupportedAgentNames, normalizeAgent } from "../utils/agent-configs.js";
import {
  listInstalledResourceGroups,
  writeInstalledResourceGroups,
  writeInstalledResources,
} from "./installed-resource-list.js";
import { runAction } from "./shared.js";

const RESOURCE_TYPES: ResourceType[] = ["rule", "command", "skill"];
type ResourceGroups = Record<ResourceType, ResourceMeta[]>;

export function registerResourceCommands(command: Command, services: ServiceFactory): void {
  command
    .command("list")
    .argument("[type]", "resource type")
    .option("--agent <list>", "agent list filter, comma separated")
    .option("--brief", "hide resource descriptions")
    .option("--installed", "list resources installed in current project")
    .option("--json", "output json format")
    .description("List resources from current default source or project installs")
    .action(
      async (
        type: string | undefined,
        options: { json?: boolean; agent?: string; brief?: boolean; installed?: boolean },
      ) => {
        await runAction(async () => {
          const agents = parseAgents(options.agent);
          const showDescription = !options.brief;
          if (options.installed) {
            await writeInstalledList(services, type, agents, Boolean(options.json));
            return;
          }

          if (!type) {
            const groups = await listGroupedResources(services, agents);
            if (options.json) {
              process.stdout.write(
                `${JSON.stringify(formatResourceGroups(groups, showDescription), null, 2)}\n`,
              );
              return;
            }
            writeGroupedResources(groups, showDescription);
            return;
          }

          const resourceType = ensureResourceType(type);
          const resources = await services.list(resourceType, agents);
          if (options.json) {
            process.stdout.write(
              `${JSON.stringify(formatResources(resources, showDescription), null, 2)}\n`,
            );
            return;
          }

          writeResourceList(resources, showDescription);
        });
      },
    );

  command
    .command("history")
    .argument("<type>", "resource type")
    .argument("<name>", "resource name")
    .option("--json", "output json format")
    .description("Show resource history")
    .action(
      async (
        type: string,
        name: string,
        options: { json?: boolean },
      ) => {
        await runAction(async () => {
          const resourceType = ensureResourceType(type);
          const versions = await services.history(resourceType, name);

          if (options.json) {
            process.stdout.write(`${JSON.stringify(versions, null, 2)}\n`);
            return;
          }

          if (versions.length === 0) {
            process.stdout.write(`No history found for ${resourceType}/${name}.\n`);
            return;
          }

          for (const version of versions) {
            process.stdout.write(`- ${version.raw}\n`);
          }
        });
      },
    );

  command
    .command("create")
    .argument("<type>", "resource type")
    .argument("<name>", "resource name")
    .option("--description <text>", "resource description")
    .option("--agent <list>", "agent list, comma separated")
    .option("--entry <file>", "entry file name")
    .option("--template <name>", "template name", "basic")
    .option("--force", "overwrite existing resource")
    .option("--dry-run", "show files without writing")
    .option("--json", "output json format")
    .description("Create resource scaffold")
    .action(
      async (
        type: string,
        name: string,
        options: {
          description?: string;
          agent?: string;
          entry?: string;
          template?: string;
          force?: boolean;
          dryRun?: boolean;
          json?: boolean;
        },
      ) => {
        await runAction(async () => {
          const resourceType = ensureResourceType(type);
          const result = await services.create(
            resourceType,
            name,
            {
              description: options.description,
              agents: parseAgents(options.agent),
              entry: options.entry,
              template: options.template,
              force: options.force,
              dryRun: options.dryRun,
            },
            process.cwd(),
          );
          if (options.json) {
            process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
            return;
          }
          process.stdout.write(
            `Created ${result.type}/${result.name} at ${result.resourceDir}${
              result.dryRun ? " (dry-run)" : ""
            }\n`,
          );
        });
      },
    );
}

async function writeInstalledList(
  services: ServiceFactory,
  type: string | undefined,
  agents: string[] | undefined,
  json: boolean,
): Promise<void> {
  if (!type) {
    const groups = await listInstalledResourceGroups(services, process.cwd(), agents);
    if (json) {
      process.stdout.write(`${JSON.stringify(groups, null, 2)}\n`);
      return;
    }
    writeInstalledResourceGroups(groups);
    return;
  }

  const resourceType = ensureResourceType(type);
  const resources = await services.listInstalled(process.cwd(), resourceType, agents);
  if (json) {
    process.stdout.write(`${JSON.stringify(resources, null, 2)}\n`);
    return;
  }
  writeInstalledResources(resources);
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

async function listGroupedResources(
  services: ServiceFactory,
  agents?: string[],
): Promise<ResourceGroups> {
  return {
    rule: await services.list("rule", agents),
    command: await services.list("command", agents),
    skill: await services.list("skill", agents),
  };
}

function formatResourceGroups(
  groups: ResourceGroups,
  showDescription: boolean,
): ResourceGroups {
  return {
    rule: formatResources(groups.rule, showDescription),
    command: formatResources(groups.command, showDescription),
    skill: formatResources(groups.skill, showDescription),
  };
}

function formatResources(
  resources: ResourceMeta[],
  showDescription: boolean,
): ResourceMeta[] {
  if (showDescription) return resources;
  return resources.map((resource) => {
    const { description: _description, ...withoutDescription } = resource;
    return withoutDescription;
  });
}

function writeGroupedResources(groups: ResourceGroups, showDescription: boolean): void {
  const hasResources = RESOURCE_TYPES.some((type) => groups[type].length > 0);
  if (!hasResources) {
    process.stdout.write("No resources found.\n");
    return;
  }

  for (const type of RESOURCE_TYPES) {
    const resources = groups[type];
    if (resources.length === 0) continue;
    process.stdout.write(`${formatGroupTitle(type)}:\n`);
    writeResourceList(resources, showDescription);
  }
}

function writeResourceList(resources: ResourceMeta[], showDescription: boolean): void {
  if (resources.length === 0) {
    process.stdout.write("No resources found.\n");
    return;
  }

  for (const resource of resources) {
    process.stdout.write(
      `- ${resource.type}/${resource.name}${
        showDescription && resource.description ? `: ${resource.description}` : ""
      }\n`,
    );
  }
}

function formatGroupTitle(type: ResourceType): string {
  if (type === "rule") return "Rules";
  if (type === "command") return "Commands";
  return "Skills";
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
