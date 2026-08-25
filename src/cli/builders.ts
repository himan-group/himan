import type { Command } from "commander";
import { ServiceFactory } from "../services/index.js";
import { registerAgentCommands } from "./agent-commands.js";
import { registerDoctorCommand } from "./doctor-command.js";
import { registerProjectCommands } from "./project-commands.js";
import { registerResourceCommands } from "./resource-commands.js";
import { registerSetupCommand } from "./setup-command.js";
import { registerSourceCommands } from "./source-commands.js";
import { registerAuditCommands } from "./system-commands.js";
import { createBaseProgram } from "./shared.js";

export function buildCli(): Command {
  const program = createBaseProgram(
    "himan",
    "Prompt and agent asset management CLI",
  );
  const services = new ServiceFactory();
  appendCommandGroupsHelp(program);

  registerSetupCommand(program, services, { legacyAlias: "init" });
  registerDoctorCommand(program, services);

  const repoCmd = program
    .command("repo")
    .alias("source")
    .description("Manage source repositories");
  registerSourceCommands(repoCmd, services);

  const systemCmd = program
    .command("system")
    .description("Manage Himan environment setup, health, and audits");
  registerSetupCommand(systemCmd, services);
  registerDoctorCommand(systemCmd, services);
  registerAuditCommands(systemCmd, services);

  const resourceCmd = program
    .command("resource")
    .description("Manage resources from current default source");
  registerResourceCommands(resourceCmd, services);
  registerProjectCommands(resourceCmd, services, {
    includeList: false,
    includeInstall: false,
    includeUninstall: false,
  });

  const projectCmd = program
    .command("project")
    .description("Manage installed resources in current project");
  registerProjectCommands(projectCmd, services, {
    includeDev: false,
    includePublish: false,
  });

  const agentCmd = program
    .command("agent")
    .description("Manage default agent configuration");
  registerAgentCommands(agentCmd, services);

  // Backward compatible top-level resource lifecycle commands.
  registerResourceCommands(program, services);
  registerProjectCommands(program, services, { includeList: false });

  return program;
}

function appendCommandGroupsHelp(program: Command): void {
  program.addHelpText(
    "after",
    `
Command groups:
  repo     Data source management (git now, registry reserved)
           repo add, repo alias, repo rename, repo use, repo list,
           repo init-docs, repo clone, repo sync
           (legacy alias: source)
  resource Source resource discovery and metadata
           list, list --source, list --archived, history,
           history --source, create, comment, dev, publish,
           archive, restore, rename (not recommended yet),
           resource list, resource history, resource create,
           resource comment, resource dev, resource publish,
           resource archive, resource restore, resource rename
           (resource list --installed is deprecated; use project list)
  project  Installed resource state in current project or user-level agent dirs
           list, install, install --source, install --include-archived, uninstall,
           project list, project install, project uninstall
  agent    Default agent configuration
           agent list, agent use, agent current, agent clear
  system   Himan environment setup and health checks
           system setup, system doctor, system audit stats|list|issues
  setup    Environment setup wizard (top-level alias; legacy alias: init)
  doctor   Runtime and project health checks
           doctor (top-level alias of system doctor)

Legacy top-level lifecycle commands (list, create, install, publish, ...)
remain available for backward compatibility.
`,
  );
}
