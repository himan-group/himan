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
    .command("clone")
    .argument("<from>", "source name or git repository URL")
    .argument("<to>", "target source name or git repository URL")
    .option("--branch <branch>", "source branch to clone")
    .option("--target-branch <branch>", "target branch name")
    .option("--add-source <name>", "add the target git repo as a named source after clone")
    .option("--use", "switch default source to the target source after clone")
    .option("--dry-run", "show refs without pushing")
    .option("--json", "output json format")
    .description("Clone a git source into an empty target git repository")
    .action(
      async (
        from: string,
        to: string,
        options: {
          branch?: string;
          targetBranch?: string;
          addSource?: string;
          use?: boolean;
          dryRun?: boolean;
          json?: boolean;
        },
      ) => {
        await runAction(async () => {
          const result = await services.cloneSource(from, to, {
            branch: options.branch,
            targetBranch: options.targetBranch,
            addSource: options.addSource,
            use: options.use,
            dryRun: options.dryRun,
          });

          if (options.json) {
            process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
            return;
          }

          process.stdout.write(
            `Source clone ${result.dryRun ? "dry-run" : "completed"}: ${
              result.source.name ?? result.source.repo
            } -> ${result.target.name ?? result.target.repo}\n`,
          );
          process.stdout.write(
            `- branch ${result.branch} -> ${result.targetBranch}\n`,
          );
          process.stdout.write(`- resource tags: ${result.tags.length}\n`);
          if (result.addedSource) {
            process.stdout.write(`- added source: ${result.addedSource}\n`);
          }
          if (result.usedSource) {
            process.stdout.write(`- using source: ${result.usedSource}\n`);
          }
        });
      },
    );

  command
    .command("sync")
    .argument("<from>", "source name or git repository URL")
    .argument("<to>", "target source name or git repository URL")
    .option("--target-branch <branch>", "target branch name", "main")
    .option("--add-source <name>", "add the target git repo as a named source after sync")
    .option("--use", "switch default source to the target source after sync")
    .option("--dry-run", "show resources without pushing")
    .option("--json", "output json format")
    .description("Sync latest source resource snapshots into a target git repository")
    .action(
      async (
        from: string,
        to: string,
        options: {
          targetBranch?: string;
          addSource?: string;
          use?: boolean;
          dryRun?: boolean;
          json?: boolean;
        },
      ) => {
        await runAction(async () => {
          const result = await services.syncSource(from, to, {
            targetBranch: options.targetBranch,
            addSource: options.addSource,
            use: options.use,
            dryRun: options.dryRun,
          });

          if (options.json) {
            process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
            return;
          }

          const created = result.resources.filter(
            (resource) => resource.action === "created",
          ).length;
          const skipped = result.resources.length - created;
          process.stdout.write(
            `Source sync ${result.dryRun ? "dry-run" : "completed"}: ${
              result.source.name ?? result.source.repo
            } -> ${result.target.name ?? result.target.repo}\n`,
          );
          process.stdout.write(`- target branch: ${result.targetBranch}\n`);
          process.stdout.write(`- resources: ${result.resources.length}\n`);
          process.stdout.write(`- tags created: ${created}\n`);
          if (skipped > 0) {
            process.stdout.write(`- tags skipped: ${skipped}\n`);
          }
          if (result.addedSource) {
            process.stdout.write(`- added source: ${result.addedSource}\n`);
          }
          if (result.usedSource) {
            process.stdout.write(`- using source: ${result.usedSource}\n`);
          }
        });
      },
    );

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
          if (result.committed) {
            process.stdout.write("Committed and pushed source docs changes.\n");
          } else if (!result.dryRun) {
            process.stdout.write("No source docs changes to commit.\n");
          }
        });
      },
    );
}
