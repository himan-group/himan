import { Command } from "commander";
import { ServiceFactory } from "../services/index.js";
import type { ResourceType } from "../domain/resource.js";

export function buildCli(): Command {
  const program = new Command();
  const services = new ServiceFactory();

  program
    .name("himan")
    .description("Prompt and agent asset management CLI")
    .version("0.1.0");

  program
    .command("init")
    .argument("<git_repo>", "Git repository URL")
    .action(async (gitRepo: string) => {
      await runAction(async () => {
        const result = await services.initSource("git", gitRepo);
        process.stdout.write(
          `Initialized ${result.sourceType} source: ${result.repo}\n`,
        );
      });
    });

  program
    .command("list")
    .argument("[type]", "resource type", "rule")
    .option("--json", "output json format")
    .description("List resources")
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

  program
    .command("history")
    .argument("<type>", "resource type")
    .argument("<name>", "resource name")
    .option("--json", "output json format")
    .description("Show resource history")
    .action(async (type: string, name: string, options: { json?: boolean }) => {
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
    });

  program
    .command("install")
    .argument("<type>", "resource type")
    .argument("<name_version>", "resource name with optional @version")
    .description("Install resource")
    .action(async (type: string, nameVersion: string) => {
      await runAction(async () => {
        const resourceType = ensureResourceType(type);
        const { name, version } = parseNameVersion(nameVersion);
        const result = await services.install(
          resourceType,
          name,
          version,
          process.cwd(),
        );
        process.stdout.write(
          `Installed ${result.type}/${result.name}@${result.version}\n`,
        );
      });
    });

  program
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

  program
    .command("publish")
    .argument("<type>", "resource type")
    .argument("<name>", "resource name")
    .option("--patch", "patch release")
    .option("--minor", "minor release")
    .option("--major", "major release")
    .description("Publish resource")
    .action(async () => {
      process.stdout.write("Publish command scaffold is ready.\n");
    });

  return program;
}

function ensureResourceType(type: string): ResourceType {
  if (type !== "rule") {
    throw new Error(`Unsupported resource type: ${type}`);
  }
  return type;
}

function parseNameVersion(input: string): { name: string; version?: string } {
  const idx = input.lastIndexOf("@");
  if (idx <= 0) return { name: input };
  return { name: input.slice(0, idx), version: input.slice(idx + 1) };
}

async function runAction(action: () => Promise<void>): Promise<void> {
  try {
    await action();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  }
}
