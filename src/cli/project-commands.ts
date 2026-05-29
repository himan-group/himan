import type { Command } from "commander";
import type { InstallMode, ResourceType } from "../domain/resource.js";
import type {
  PublishBatchItem,
  PublishFollowUp,
  ServiceFactory,
  SkillDependencyStatus,
} from "../services/index.js";
import { HimanError, errorCodes } from "../utils/errors.js";
import { getSupportedAgentNames, normalizeAgent } from "../utils/agent-configs.js";
import {
  listInstalledResourceGroups,
  writeInstalledResourceGroups,
  writeInstalledResources,
} from "./installed-resource-list.js";
import { runAction } from "./shared.js";
import { promises as fs } from "node:fs";
import { createInterface } from "node:readline/promises";
import process from "node:process";

export function registerProjectCommands(
  command: Command,
  services: ServiceFactory,
  options: {
    includeList?: boolean;
    includeInstall?: boolean;
    includeDev?: boolean;
    includeUninstall?: boolean;
    includePublish?: boolean;
  } = {},
): void {
  if (options.includeList !== false) {
    command
      .command("list")
      .argument("[type]", "resource type")
      .option("--agent <list>", "agent list filter, comma separated")
      .option("--json", "output json format")
      .description("List resources installed in current project")
      .action(
        async (
          type: string | undefined,
          commandOptions: { agent?: string; json?: boolean },
        ) => {
          await runAction(async () => {
            const agents = parseAgents(commandOptions.agent);
            if (!type) {
              const groups = await listInstalledResourceGroups(
                services,
                process.cwd(),
                agents,
              );
              if (commandOptions.json) {
                process.stdout.write(`${JSON.stringify(groups, null, 2)}\n`);
                return;
              }
              writeInstalledResourceGroups(groups);
              return;
            }

            const resourceType = ensureResourceType(type);
            const resources = await services.listInstalled(
              process.cwd(),
              resourceType,
              agents,
            );
            if (commandOptions.json) {
              process.stdout.write(`${JSON.stringify(resources, null, 2)}\n`);
              return;
            }
            writeInstalledResources(resources);
          });
        },
      );
  }

  if (options.includeInstall !== false) {
    command
      .command("install")
      .argument("[type]", "resource type")
      .argument("[name[@version]]", "resource name with optional @version")
      .option("--agent <list>", "install target agents, comma separated")
      .option("--mode <mode>", "install mode: link or copy")
      .option("--source <alias>", "source alias for single-resource install")
      .option("-g, --global", "install into user-level agent directories")
      .option("--include-archived", "allow installing an archived resource explicitly")
      .option("-r, --recursive", "install skill dependencies declared in himan.yaml")
      .option(
        "--depth <n>",
        "dependency install depth for recursive skill install (default: 1)",
      )
      .description("Install resource, or install from himan.lock")
      .action(
        async (
          type: string | undefined,
          nameVersion: string | undefined,
          commandOptions: {
            agent?: string;
            mode?: string;
            source?: string;
            global?: boolean;
            includeArchived?: boolean;
            recursive?: boolean;
            depth?: string;
          },
        ) => {
          await runAction(async () => {
            const agents = parseAgents(commandOptions.agent);
            const mode = parseInstallMode(commandOptions.mode);
            const dependencyDepth = commandOptions.recursive
              ? parseDependencyDepthOption(commandOptions.depth) ?? 1
              : undefined;
            if (!type && !nameVersion) {
              if (commandOptions.source) {
                throw new HimanError(
                  errorCodes.CLI_USAGE,
                  "--source only applies to single-resource install.",
                );
              }
              if (commandOptions.includeArchived) {
                throw new HimanError(
                  errorCodes.CLI_USAGE,
                  "--include-archived only applies to single-resource install.",
                );
              }
              if (commandOptions.recursive) {
                throw new HimanError(
                  errorCodes.CLI_USAGE,
                  "--recursive only applies to single-resource skill install.",
                );
              }
              if (commandOptions.depth !== undefined) {
                throw new HimanError(
                  errorCodes.CLI_USAGE,
                  "--depth only applies to single-resource recursive skill install.",
                );
              }
              if (commandOptions.global) {
                throw new HimanError(
                  errorCodes.CLI_USAGE,
                  "Global install requires a resource:\n"
                    + "  - himan install <type> <name[@version]> -g [--source alias] [--mode link|copy]",
                );
              }
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
                  + "  - himan install <type> <name[@version]> [--source alias] [--mode link|copy]  # install single resource\n"
                  + "  - himan install <type> <name[@version]> -g [--source alias] [--mode link|copy]  # install single resource globally",
              );
            }

            const resourceType = ensureResourceType(type);
            const { name, version } = parseNameVersion(nameVersion);
            if (commandOptions.recursive && resourceType !== "skill") {
              throw new HimanError(
                errorCodes.CLI_USAGE,
                "--recursive only applies to single-resource skill install.",
              );
            }
            if (!commandOptions.recursive && commandOptions.depth !== undefined) {
              throw new HimanError(
                errorCodes.CLI_USAGE,
                "--depth requires --recursive.",
              );
            }

            const installOptions = {
              includeArchived: commandOptions.includeArchived,
              source: commandOptions.source,
            };
            const dependencyStatusDepth = commandOptions.recursive
              ? dependencyDepth ?? 1
              : 1;
            const results = commandOptions.recursive
              ? commandOptions.global
                ? await services.installGlobalWithDependencies(
                    name,
                    version,
                    process.cwd(),
                    agents,
                    mode,
                    dependencyDepth,
                    installOptions,
                  )
                : await services.installWithDependencies(
                    name,
                    version,
                    process.cwd(),
                    agents,
                    mode,
                    dependencyDepth,
                    installOptions,
                  )
              : [
                  commandOptions.global
                    ? await services.installGlobal(
                        resourceType,
                        name,
                        version,
                        process.cwd(),
                        agents,
                        mode,
                        installOptions,
                      )
                    : await services.install(
                        resourceType,
                        name,
                        version,
                        process.cwd(),
                        agents,
                        mode,
                        installOptions,
                      ),
                ];

            for (const result of results) {
              process.stdout.write(
                `Installed ${commandOptions.global ? "global " : ""}${result.type}/${result.name}@${result.version}\n`,
              );
            }

            if (resourceType === "skill") {
              const dependencyStatuses = await services.getSkillDependencyStatuses(
                name,
                version,
                process.cwd(),
                {
                  ...installOptions,
                  depth: dependencyStatusDepth,
                },
              );
              writeSkillDependencyStatuses(name, dependencyStatuses);
            }
          });
        },
      );
  }

  if (options.includeDev !== false) {
    command
      .command("dev")
      .argument("<type>", "resource type")
      .argument("<name>", "resource name")
      .description("Switch resource to development mode")
      .action(async (type: string, name: string) => {
        await runAction(async () => {
          const resourceType = ensureResourceType(type);
          const result = await services.dev(resourceType, name, process.cwd());
          if (result.sourceScope === "global") {
            process.stdout.write(
              `Copied global ${result.type}/${result.name} into current project: ${result.devPath}\n`,
            );
            return;
          }
          process.stdout.write(
            `Editing ${result.type}/${result.name} in place: ${result.devPath}\n`,
          );
        });
      });
  }

  if (options.includeUninstall !== false) {
    command
      .command("uninstall")
      .argument("<type>", "resource type")
      .argument("<name>", "resource name")
      .option("-g, --global", "uninstall from user-level agent directories")
      .description("Uninstall resource from project and lock")
      .action(async (type: string, name: string, options: { global?: boolean }) => {
        await runAction(async () => {
          const resourceType = ensureResourceType(type);
          const result = options.global
            ? await services.uninstallGlobal(resourceType, name, process.cwd())
            : await services.uninstall(resourceType, name, process.cwd());
          process.stdout.write(
            `Uninstalled ${options.global ? "global " : ""}${result.type}/${result.name}\n`,
          );
        });
      });
  }

  if (options.includePublish !== false) {
    command
      .command("publish")
      .argument("[type]", "resource type")
      .argument("[name]", "resource name, or comma-separated names in one argument")
      .option("--patch", "patch release")
      .option("--minor", "minor release")
      .option("--major", "major release")
      .option("--source <alias>", "source alias to publish into")
      .option(
        "-g, --global",
        "install the published version into user-level agent directories",
      )
      .option(
        "--all",
        "publish all current-project resources, or all resources of the given type",
      )
      .description("Publish resource (default: --patch)")
      .addHelpText(
        "after",
        `
Examples:
  $ himan publish skill risk-check
  $ himan publish skill skill-a,skill-c
  $ himan publish --all
  $ himan publish skill --all
`,
      )
      .action(
        async (
          type: string | undefined,
          name: string | undefined,
          options: {
            patch?: boolean;
            minor?: boolean;
            major?: boolean;
            source?: string;
            global?: boolean;
            all?: boolean;
          },
        ) => {
          await runAction(async () => {
            const releaseType = resolveReleaseType(options);
            const installScope = options.global ? "global" : "project";
            process.stdout.write(
              options.global
                ? "Published resource will be installed globally; current project lock will not be updated.\n"
                : "Published resource will be installed into the current project and recorded in himan.lock. Use -g/--global to install globally instead.\n",
            );
            const resourceType = type ? ensureResourceType(type) : undefined;
            const names = parsePublishNames(name);
            const shouldBatch =
              Boolean(options.all) || names.length > 1 || !resourceType;

          if (!shouldBatch) {
            if (!resourceType || names.length !== 1) {
              throw new HimanError(
                errorCodes.CLI_USAGE,
                "Publish usage:\n"
                  + "  - himan publish <type> <name> [--patch|--minor|--major] [--source alias]\n"
                  + "  - himan publish --all [--patch|--minor|--major] [--source alias]\n"
                  + "  - himan publish <type> --all [--patch|--minor|--major] [--source alias]\n"
                  + "  - himan publish <type> <name1,name2,...> [--patch|--minor|--major] [--source alias]\n"
                  + "Examples:\n"
                  + "  - himan publish skill risk-check\n"
                  + "  - himan publish skill skill-a,skill-c",
              );
            }
            const result = await services.publish(
              resourceType,
              names[0],
              releaseType,
              process.cwd(),
              {
                installScope,
                source: options.source,
                onProgress: (progress) => {
                  process.stdout.write(`[publish:${progress.stage}] ${progress.message}\n`);
                },
              },
            );
            process.stdout.write(
              `Published ${result.type}/${result.name}@${result.version} and installed ${
                result.installScope === "global" ? "globally" : "into current project"
              }\n`,
            );
            await handlePublishFollowUp(result.followUp);
            return;
          }

          if (options.all && names.length > 0) {
            throw new HimanError(
              errorCodes.CLI_USAGE,
              "--all cannot be used together with explicit resource names.",
            );
          }
          if (!options.all && !resourceType) {
            throw new HimanError(
              errorCodes.CLI_USAGE,
              "Batch publish without --all requires a resource type, for example `himan publish skill a,b`.",
            );
          }

          process.stdout.write("[publish:batch] Scanning current project resources.\n");
          const requests = options.all
            ? await services.listProjectPublishResources(process.cwd(), resourceType)
            : names.map((resourceName) => ({
                type: resourceType!,
                name: resourceName,
              }));
          if (requests.length === 0) {
            throw new HimanError(
              errorCodes.RESOURCE_NOT_FOUND,
              resourceType
                ? `No publishable project resources found for type ${resourceType}.`
                : "No publishable project resources found.",
            );
          }

          process.stdout.write(
            `[publish:batch] Selected ${requests.length} resource(s).\n`,
          );
          const results = await services.publishMany(
            requests,
            releaseType,
            process.cwd(),
            {
              installScope,
              source: options.source,
              onProgress: (progress) => {
                process.stdout.write(`[publish:${progress.stage}] ${progress.message}\n`);
              },
              onBatchProgress: (progress) => {
                const prefix = `[publish:batch] (${progress.current}/${progress.total})`;
                if (progress.stage === "start") {
                  process.stdout.write(
                    `${prefix} ${progress.message}\n`,
                  );
                  return;
                }
                if (progress.stage === "success") {
                  process.stdout.write(`${prefix} ${progress.message}\n`);
                  return;
                }
                if (progress.stage === "skip") {
                  process.stdout.write(`${prefix} Skipped ${progress.item.type}/${progress.item.name}: ${progress.message}\n`);
                  return;
                }
                process.stdout.write(`${prefix} Failed ${progress.item.type}/${progress.item.name}: ${progress.message}\n`);
              },
            },
          );
          await handlePublishBatchResults(results);
          });
        },
      );
  }
}

async function handlePublishFollowUp(followUp?: PublishFollowUp): Promise<void> {
  if (!followUp) return;

  process.stdout.write(`${followUp.message}\n`);
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    process.stdout.write(
      `Legacy path was kept. Remove it manually if you want to keep only the canonical copy.\n`,
    );
    return;
  }

  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  try {
    const answer = await rl.question(
      "Remove the legacy path now and keep the canonical copy? [y/N] ",
    );
    if (!/^y(es)?$/i.test(answer.trim())) {
      process.stdout.write("Legacy path was kept.\n");
      return;
    }
  } finally {
    rl.close();
  }

  await fs.rm(followUp.legacyPath, { recursive: true, force: true });
  process.stdout.write(`Removed legacy path: ${followUp.legacyPath}\n`);
}

async function handlePublishBatchResults(results: PublishBatchItem[]): Promise<void> {
  const published = results.filter((item) => item.status === "published");
  const skipped = results.filter((item) => item.status === "skipped");
  const failed = results.filter((item) => item.status === "failed");

  for (const item of published) {
    await handlePublishFollowUp(item.followUp);
  }

  process.stdout.write(
    `[publish:batch] Summary: ${published.length} published, ${skipped.length} skipped, ${failed.length} failed.\n`,
  );
  if (failed.length > 0) {
    process.exitCode = 1;
  }
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

function parseNameVersion(input: string): { name: string; version?: string } {
  const idx = input.lastIndexOf("@");
  if (idx <= 0) return { name: input };
  return { name: input.slice(0, idx), version: input.slice(idx + 1) };
}

function parsePublishNames(input?: string): string[] {
  if (!input) return [];
  return [...new Set(
    input
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean),
  )];
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

function writeSkillDependencyStatuses(
  rootSkillName: string,
  dependencies: SkillDependencyStatus[],
): void {
  if (dependencies.length === 0) {
    process.stdout.write(`Dependencies for skill/${rootSkillName}: none\n`);
    return;
  }

  process.stdout.write(`Dependencies for skill/${rootSkillName}:\n`);
  for (const dependency of dependencies) {
    const label = dependency.optional ? `${dependency.name} (optional)` : dependency.name;
    const status = formatSkillDependencyStatus(dependency);
    const line = `- ${label}: ${status}`;
    process.stdout.write(
      `${dependency.installedInProject || dependency.installedGlobally ? line : styleDependencyTerminal(line, "missing")}\n`,
    );
  }
}

function formatSkillDependencyStatus(dependency: SkillDependencyStatus): string {
  const locations: string[] = [];
  if (dependency.installedInProject) {
    locations.push(formatInstalledLocation("project", dependency.projectAgents));
  }
  if (dependency.installedGlobally) {
    locations.push(formatInstalledLocation("global", dependency.globalAgents));
  }
  if (locations.length === 0) {
    return "NOT INSTALLED";
  }
  return locations.join(", ");
}

function formatInstalledLocation(scope: "project" | "global", agents: string[]): string {
  if (agents.length === 0) {
    return `installed in ${scope}`;
  }
  return `installed in ${scope} [${agents.join(", ")}]`;
}

function styleDependencyTerminal(text: string, token: "missing"): string {
  if (!shouldUseColor()) return text;
  const codeMap: Record<"missing", string> = {
    missing: "1;31",
  };
  return `\u001b[${codeMap[token]}m${text}\u001b[0m`;
}

function shouldUseColor(): boolean {
  if (process.env.VITEST !== undefined) return false;
  if (process.env.NO_COLOR !== undefined) return false;
  const forceColor = process.env.FORCE_COLOR;
  if (forceColor === "0") return false;
  if (forceColor !== undefined && forceColor !== "") return true;
  return Boolean(process.stdout.isTTY);
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

function parseDependencyDepthOption(input?: string): number | undefined {
  if (input === undefined) return undefined;
  const normalized = input.trim();
  if (!/^\d+$/.test(normalized)) {
    throw new HimanError(
      errorCodes.INVALID_INPUT,
      `Unsupported dependency depth: ${input}. Use a non-negative integer.`,
    );
  }

  return Number.parseInt(normalized, 10);
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
