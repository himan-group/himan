import { Command, CommanderError } from "commander";
import { ServiceFactory } from "../services/index.js";
import type { ResourceType } from "../domain/resource.js";
import { errorCodes, HimanError } from "../utils/errors.js";

interface CliErrorPayload {
  ok: false;
  error: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
  };
}

export function buildCli(): Command {
  const program = new Command();
  const services = new ServiceFactory();
  program.exitOverride();
  program.configureOutput({
    writeOut: (str: string) => {
      process.stdout.write(str);
    },
    writeErr: () => {
      // Parse/usage errors are unified by writeCliError().
    },
  });

  program
    .name("himan")
    .description("Prompt and agent asset management CLI")
    .version("0.1.0");
  appendCommandGroupsHelp(program);

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

  const sourceCmd = program.command("source").description("Manage source repositories");

  sourceCmd
    .command("add")
    .argument("<name>", "source name (kebab-case)")
    .argument("<git_repo>", "Git repository URL")
    .description("Add a named git source")
    .action(async (name: string, gitRepo: string) => {
      await runAction(async () => {
        const result = await services.addSource(name, "git", gitRepo);
        process.stdout.write(
          `Added source ${result.name}: ${result.type}${result.repo ? ` ${result.repo}` : ""}\n`,
        );
      });
    });

  sourceCmd
    .command("use")
    .argument("<name>", "source name")
    .description("Switch default source")
    .action(async (name: string) => {
      await runAction(async () => {
        const result = await services.useSource(name);
        process.stdout.write(`Using source: ${result.name}\n`);
      });
    });

  sourceCmd
    .command("list")
    .option("--json", "output json format")
    .description("List configured sources and current default")
    .action(async (options: { json?: boolean }) => {
      await runAction(async () => {
        const sources = await services.listSources();
        if (options.json) {
          process.stdout.write(`${JSON.stringify(sources, null, 2)}\n`);
          return;
        }
        if (sources.length === 0) {
          process.stdout.write("No sources configured.\n");
          return;
        }
        for (const source of sources) {
          process.stdout.write(
            `- ${source.name}${source.isDefault ? " (default)" : ""}: ${source.type}${
              source.repo ? ` ${source.repo}` : ""
            }\n`,
          );
        }
      });
    });

  program
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
    .argument("[type]", "resource type")
    .argument("[name[@version]]", "resource name with optional @version")
    .description("Install resource, or install from himan.lock")
    .action(async (type?: string, nameVersion?: string) => {
      await runAction(async () => {
        if (!type && !nameVersion) {
          const results = await services.installFromLock(process.cwd());
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
          throw new Error(
            "Install usage:\n"
              + "  - himan install  # install from himan.lock\n"
              + "  - himan install <type> <name[@version]>  # install single resource",
          );
        }

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

  program
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

function parseNameVersion(input: string): { name: string; version?: string } {
  const idx = input.lastIndexOf("@");
  if (idx <= 0) return { name: input };
  return { name: input.slice(0, idx), version: input.slice(idx + 1) };
}

async function runAction(action: () => Promise<void>): Promise<void> {
  try {
    await action();
  } catch (error) {
    writeCliError(error);
    process.exitCode = 1;
  }
}

export function writeCliError(error: unknown): void {
  const payload = toCliErrorPayload(error);
  if (shouldOutputJsonError()) {
    process.stderr.write(`${JSON.stringify(payload, null, 2)}\n`);
    return;
  }
  process.stderr.write(`[${payload.error.code}] ${payload.error.message}\n`);
}

function toCliErrorPayload(error: unknown): CliErrorPayload {
  if (error instanceof CommanderError) {
    return {
      ok: false,
      error: {
        code: errorCodes.CLI_USAGE,
        message: error.message,
        details: {
          commanderCode: error.code,
          exitCode: error.exitCode,
        },
      },
    };
  }
  if (error instanceof HimanError) {
    return {
      ok: false,
      error: {
        code: error.code,
        message: error.message,
        details: error.details,
      },
    };
  }
  return {
    ok: false,
    error: {
      code: "E_UNKNOWN",
      message: error instanceof Error ? error.message : String(error),
    },
  };
}

function shouldOutputJsonError(): boolean {
  return process.argv.includes("--json");
}

function appendCommandGroupsHelp(program: Command): void {
  program.addHelpText(
    "after",
    `
Command groups:
  source   Data source management (git now, registry reserved)
           init, source add, source use, source list
  resource Source resource discovery and metadata
           list, history, create
  project  Resource usage lifecycle in current project
           install, dev, uninstall, publish
`,
  );
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
