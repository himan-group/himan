import type { Command } from "commander";
import type { AuditIssue, AuditResult } from "../domain/audit.js";
import type { ServiceFactory } from "../services/index.js";
import { getSupportedAgentNames, normalizeAgent } from "../utils/agent-configs.js";
import { errorCodes, HimanError } from "../utils/errors.js";
import { runAction } from "./shared.js";

type AuditScopeOption = "global" | "project" | "all";
type AuditView = "stats" | "list" | "issues";

interface AuditOptions {
  json?: boolean;
  scope?: string;
  agent?: string;
}

export function registerAuditCommands(
  command: Command,
  services: ServiceFactory,
): void {
  command
    .command("audit")
    .argument("[view]", "view: stats, list, or issues (default: stats)")
    .option("--json", "output json format")
    .option("--scope <scope>", "scan scope: global, project, or all (default: all)")
    .option("--agent <agent>", "filter by agent")
    .description("Inventory machine-level resources and detect anomalies")
    .action(async (view: string | undefined, options: AuditOptions) => {
      await runAudit(services, normalizeView(view), options);
    });
}

export function registerMigrateCommand(
  command: Command,
  services: ServiceFactory,
): void {
  command
    .command("migrate")
    .argument("<path>", "path to an unmanaged resource directory")
    .option("--type <type>", "resource type: rule, command, skill, or config")
    .option(
      "--agent <list>",
      "agents for the migrated resource metadata, comma separated",
    )
    .option("--dry-run", "show what would be migrated without writing")
    .option("--json", "output json format")
    .description(
      "Migrate an unmanaged local resource into the private local source",
    )
    .action(
      async (
        sourcePath: string,
        options: {
          type?: string;
          agent?: string;
          dryRun?: boolean;
          json?: boolean;
        },
      ) => {
        await runAction(async () => {
          const result = await services.migrate(sourcePath, {
            type: options.type,
            agents: parseAgentList(options.agent),
            dryRun: options.dryRun,
          });
          if (options.json) {
            process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
            return;
          }
          if (result.dryRun) {
            process.stdout.write(
              `Dry run: would migrate ${result.type}/${result.name}@${result.version} `
              + "to the local source.\n",
            );
            for (const file of result.files) {
              process.stdout.write(`- ${file.action} ${file.path}\n`);
            }
            process.stdout.write(`- store: ${result.storePath}\n`);
            return;
          }
          process.stdout.write(
            `Migrated ${result.type}/${result.name}@${result.version} to the local source.\n`,
          );
          process.stdout.write(
            `Source: ${result.sourceName} (${result.sourceDir})\n`,
          );
          process.stdout.write(`Store: ${result.storePath}\n`);
          process.stdout.write(
            `Next: himan install ${result.type} ${result.name} --source ${result.sourceName}\n`,
          );
        });
      },
    );
}

function parseAgentList(input?: string): string[] | undefined {
  if (!input) return undefined;
  const agents = input
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  if (agents.length === 0) return undefined;
  for (const agent of agents) {
    if (!normalizeAgent(agent)) {
      throw new HimanError(
        errorCodes.INVALID_INPUT,
        `Unsupported agent: ${agent}. Supported agents: ${getSupportedAgentNames().join(", ")}`,
      );
    }
  }
  return agents;
}

function normalizeView(view?: string): AuditView {
  const normalized = view ?? "stats";
  if (normalized !== "stats" && normalized !== "list" && normalized !== "issues") {
    throw new HimanError(
      errorCodes.CLI_USAGE,
      `Invalid audit view: ${normalized}. Supported views: stats, list, issues.`,
    );
  }
  return normalized;
}

async function runAudit(
  services: ServiceFactory,
  view: AuditView,
  options: AuditOptions,
): Promise<void> {
  await runAction(async () => {
    const scope = parseScopeOption(options.scope);
    const result = await services.systemAudit({
      scope,
      agent: options.agent,
    });
    if (options.json) {
      process.stdout.write(`${JSON.stringify(formatResult(result, view), null, 2)}\n`);
    } else {
      writeResult(result, view);
    }
    if (view === "issues" && result.issues.some((issue) => issue.level === "error")) {
      process.exitCode = 1;
    }
  });
}

function parseScopeOption(input?: string): AuditScopeOption {
  const scope = input ?? "all";
  if (scope !== "global" && scope !== "project" && scope !== "all") {
    throw new HimanError(
      errorCodes.CLI_USAGE,
      `Invalid scope: ${scope}. Supported scopes: global, project, all.`,
    );
  }
  return scope;
}

function formatResult(result: AuditResult, view: AuditView): unknown {
  if (view === "stats") return result.stats;
  if (view === "list") return result.resources;
  return result.issues;
}

function writeResult(result: AuditResult, view: AuditView): void {
  if (view === "stats") {
    writeStats(result);
    return;
  }
  if (view === "list") {
    writeList(result);
    return;
  }
  writeIssues(result.issues);
}

function writeStats(result: AuditResult): void {
  process.stdout.write("Himan system audit\n");
  for (const agent of result.stats.agents) {
    const byType = Object.entries(agent.byType)
      .filter(([, count]) => count > 0)
      .map(([type, count]) => `${type}:${count}`)
      .join(", ");
    process.stdout.write(
      `- ${agent.agent}: ${agent.resources} resources${byType ? ` (${byType})` : ""}\n`,
    );
  }
  for (const scope of ["global", "project"] as const) {
    const stats = result.stats.scopes[scope];
    process.stdout.write(
      `${scope}: ${stats.resources} resources `
      + `(managed ${stats.managed}, unmanaged ${stats.unmanaged}, drifted ${stats.drifted})\n`,
    );
  }
  const totals = result.stats.totals;
  process.stdout.write(
    `total: ${totals.resources} resources `
    + `(managed ${totals.managed}, unmanaged ${totals.unmanaged}, drifted ${totals.drifted})\n`,
  );
  const issueSummary = Object.entries(result.stats.issues)
    .filter(([, count]) => count > 0)
    .map(([category, count]) => `${category}:${count}`)
    .join(", ");
  process.stdout.write(
    `issues: ${issueSummary || "none"}\n`,
  );
}

function writeList(result: AuditResult): void {
  if (result.resources.length === 0) {
    process.stdout.write("No resources found.\n");
    return;
  }
  for (const resource of result.resources) {
    const version = resource.version ? `@${resource.version}` : "";
    const mode = resource.mode ? `, ${resource.mode}` : "";
    process.stdout.write(
      `- ${resource.scope}/${resource.agent} ${resource.type}/${resource.name}${version} `
      + `[${resource.status}${mode}] ${resource.path}\n`,
    );
  }
}

function writeIssues(issues: AuditIssue[]): void {
  if (issues.length === 0) {
    process.stdout.write("No issues found.\n");
    return;
  }
  for (const issue of issues) {
    process.stdout.write(`[${issue.level}] ${issue.category}: ${issue.message}\n`);
    if (issue.path) {
      process.stdout.write(`  path: ${issue.path}\n`);
    }
    process.stdout.write(`  suggestion: ${issue.suggestion}\n`);
  }
}
