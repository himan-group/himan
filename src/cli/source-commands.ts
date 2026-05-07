import type { Command } from "commander";
import type { ServiceFactory } from "../services/index.js";
import { runAction } from "./shared.js";

export function registerInitCommand(command: Command, services: ServiceFactory): void {
  command
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
}

export function registerSourceCommands(
  command: Command,
  services: ServiceFactory,
  options?: { includeInit?: boolean },
): void {
  if (options?.includeInit) {
    registerInitCommand(command, services);
  }

  command
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

  command
    .command("use")
    .argument("<name>", "source name")
    .description("Switch default source")
    .action(async (name: string) => {
      await runAction(async () => {
        const result = await services.useSource(name);
        process.stdout.write(`Using source: ${result.name}\n`);
      });
    });

  command
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

  command
    .command("init-docs")
    .option("--force", "overwrite existing README.md and CHANGELOG.md")
    .option("--dry-run", "show files without writing")
    .option("--json", "output json format")
    .description("Create source-level README.md and CHANGELOG.md")
    .action(
      async (options: { force?: boolean; dryRun?: boolean; json?: boolean }) => {
        await runAction(async () => {
          const result = await services.initSourceDocs({
            force: options.force,
            dryRun: options.dryRun,
          });
          if (options.json) {
            process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
            return;
          }

          process.stdout.write(
            `Source docs ${result.dryRun ? "dry-run" : "initialized"}: ${result.sourceDir}\n`,
          );
          for (const file of result.files) {
            process.stdout.write(
              `- ${file.action} ${file.path}${file.reason ? ` (${file.reason})` : ""}\n`,
            );
          }
        });
      },
    );
}
