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
        const resourceType = ensureRuleResourceType(type);
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
        const resourceType = ensureRuleResourceType(type);
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

  program
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
          const resourceType = ensureCreateResourceType(type);
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

  return program;
}

function ensureResourceType(type: string): ResourceType {
  if (type !== "rule" && type !== "command" && type !== "skill") {
    throw new Error(`Unsupported resource type: ${type}`);
  }
  return type;
}

function ensureRuleResourceType(type: string): "rule" {
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
    throw new Error("Use only one of --patch, --minor or --major.");
  }
  return selected[0] ?? "patch";
}

function ensureCreateResourceType(type: string): ResourceType {
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
