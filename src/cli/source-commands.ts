import type { Command } from "commander";
import type { InstallMode, ResourceType } from "../domain/resource.js";
import type { ServiceFactory } from "../services/index.js";
import { getSupportedAgentNames, normalizeAgent } from "../utils/agent-configs.js";
import { HimanError, errorCodes } from "../utils/errors.js";
import { runAction } from "./shared.js";

interface InitInstallRef {
  type: ResourceType;
  name: string;
  version?: string;
}

export function registerInitCommand(command: Command, services: ServiceFactory): void {
  command
    .command("init")
    .argument("<git_repo>", "Git repository URL")
    .option("--agent <list>", "set current project default agents, comma separated")
    .option(
      "--install <refs>",
      "install resource refs after init, comma separated: rule/name[@version]",
    )
    .option("--mode <mode>", "install mode for --install: link or copy")
    .option("--json", "output json format")
    .action(async (gitRepo: string, options: {
      agent?: string;
      install?: string;
      mode?: string;
      json?: boolean;
    }) => {
      await runAction(async () => {
        const agents = parseAgents(options.agent);
        const installRefs = parseInstallRefs(options.install);
        const mode = parseInstallMode(options.mode);
        if (mode && installRefs.length === 0) {
          throw new HimanError(
            errorCodes.CLI_USAGE,
            "Use --mode only with --install.",
          );
        }

        const source = await services.initSource("git", gitRepo);
        const agentResult = agents?.length
          ? await services.setAgents(agents, "project", process.cwd())
          : undefined;
        const installed = [];
        for (const ref of installRefs) {
          installed.push(
            await services.install(
              ref.type,
              ref.name,
              ref.version,
              process.cwd(),
              agents,
              mode,
            ),
          );
        }

        if (options.json) {
          process.stdout.write(
            `${JSON.stringify({ source, agents: agentResult, installed }, null, 2)}\n`,
          );
          return;
        }

        process.stdout.write(
          `Initialized ${source.sourceType} source: ${source.repo}\n`,
        );
        if (agentResult) {
          process.stdout.write(
            `Using agents (${agentResult.scope}): ${agentResult.agents.join(", ")}\n`,
          );
        }
        for (const item of installed) {
          process.stdout.write(`Installed ${item.type}/${item.name}@${item.version}\n`);
        }
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
    .option("--alias <alias>", "source alias used by source use and --source")
    .description("Add a named git source")
    .action(async (name: string, gitRepo: string, options: { alias?: string }) => {
      await runAction(async () => {
        const result = await services.addSource(name, "git", gitRepo, options.alias);
        process.stdout.write(
          `Added source ${result.name} as ${result.alias}: ${result.type}${
            result.repo ? ` ${result.repo}` : ""
          }\n`,
        );
      });
    });

  command
    .command("use")
    .argument("<source>", "source alias or name")
    .option("--alias <alias>", "set or update the target source alias while switching")
    .description("Switch default source by alias or name")
    .action(async (source: string, options: { alias?: string }) => {
      await runAction(async () => {
        const result = await services.useSource(source, { alias: options.alias });
        process.stdout.write(`Using source: ${result.alias} (${result.name})\n`);
      });
    });

  command
    .command("alias")
    .argument("<source>", "source name or current alias")
    .argument("<alias>", "new source alias")
    .description("Set or update a source alias")
    .action(async (source: string, alias: string) => {
      await runAction(async () => {
        const result = await services.aliasSource(source, alias);
        process.stdout.write(`Aliased source ${result.name} as ${result.alias}\n`);
      });
    });

  command
    .command("rename")
    .argument("<source>", "source name or current alias")
    .argument("<new-name>", "new source name")
    .option("--alias <alias>", "set or update the source alias while renaming")
    .description("Rename a configured source")
    .action(
      async (source: string, newName: string, options: { alias?: string }) => {
        await runAction(async () => {
          const result = await services.renameSource(source, newName, {
            alias: options.alias,
          });
          const alias = result.alias ? ` as ${result.alias}` : "";
          const current = result.isDefault ? " (current)" : "";
          process.stdout.write(
            `Renamed source ${result.oldName} to ${result.name}${alias}${current}\n`,
          );
        });
      },
    );

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
          const alias = source.alias ? ` [${source.alias}]` : "";
          process.stdout.write(
            `- ${source.name}${alias}${source.isDefault ? " (current)" : ""}: ${source.type}${
              source.repo ? ` ${source.repo}` : ""
            }\n`,
          );
        }
      });
    });

  command
    .command("init-docs")
    .option("--force", "overwrite existing README.md and CHANGELOG.md")
    .option("--source <alias>", "source alias for docs initialization target")
    .option(
      "--repair-history",
      "repair existing source README/CHANGELOG managed sections and historical publish entries",
    )
    .option("--dry-run", "show files without writing")
    .option("--json", "output json format")
    .description("Create source-level README.md and CHANGELOG.md")
    .action(
      async (options: {
        force?: boolean;
        source?: string;
        repairHistory?: boolean;
        dryRun?: boolean;
        json?: boolean;
      }) => {
        await runAction(async () => {
          const result = await services.initSourceDocs({
            force: options.force,
            source: options.source,
            repairHistory: options.repairHistory,
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

function ensureResourceType(type: string): ResourceType {
  if (type !== "rule" && type !== "command" && type !== "skill" && type !== "config") {
    throw new HimanError(
      errorCodes.UNSUPPORTED_RESOURCE_TYPE,
      `Unsupported resource type: ${type}`,
    );
  }
  return type;
}

function parseInstallRefs(input?: string): InitInstallRef[] {
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
