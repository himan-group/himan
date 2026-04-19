import type { Command } from "commander";
import type { ResourceType } from "../domain/resource.js";
import type { ServiceFactory } from "../services/index.js";
import { runAction } from "./shared.js";

export function registerResourceCommands(command: Command, services: ServiceFactory): void {
  command
    .command("list")
    .argument("[type]", "resource type", "rule")
    .option("--json", "output json format")
    .description("List resources from current default source")
    .action(async (type: string, options: { json?: boolean }) => {
      await runAction(async () => {
        const resourceType = ensureResourceType(type);
        const resources = await services.list(resourceType);
        if (options.json) {
          process.stdout.write(`${JSON.stringify(resources, null, 2)}\n`);
          return;
        }

        if (resources.length === 0) {
          process.stdout.write("No resources found.\n");
          return;
        }

        for (const resource of resources) {
          process.stdout.write(
            `- ${resource.type}/${resource.name}${
              resource.description ? `: ${resource.description}` : ""
            }\n`,
          );
        }
      });
    });

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
    .option("--target <list>", "targets list, comma separated")
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
          target?: string;
          entry?: string;
          template?: string;
          force?: boolean;
          dryRun?: boolean;
          json?: boolean;
        },
      ) => {
        await runAction(async () => {
          const resourceType = ensureResourceType(type);
          const result = await services.create(resourceType, name, {
            description: options.description,
            targets: parseTargets(options.target),
            entry: options.entry,
            template: options.template,
            force: options.force,
            dryRun: options.dryRun,
          });
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

function ensureResourceType(type: string): ResourceType {
  if (type !== "rule" && type !== "command" && type !== "skill") {
    throw new Error(`Unsupported resource type: ${type}`);
  }
  return type;
}

function parseTargets(input?: string): string[] | undefined {
  if (!input) return undefined;
  return input
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}
