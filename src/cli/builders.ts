import type { Command } from "commander";
import { ServiceFactory } from "../services/index.js";
import { registerAgentCommands } from "./agent-commands.js";
import { registerDoctorCommand } from "./doctor-command.js";
import { registerProjectCommands } from "./project-commands.js";
import { registerResourceCommands } from "./resource-commands.js";
import { registerInitCommand, registerSourceCommands } from "./source-commands.js";
import { createBaseProgram } from "./shared.js";

export function buildCli(): Command {
  const program = createBaseProgram(
    "himan",
    "Prompt and agent asset management CLI",
  );
  const services = new ServiceFactory();
  appendCommandGroupsHelp(program);

  registerInitCommand(program, services);
  registerDoctorCommand(program, services);

  const sourceCmd = program.command("source").description("Manage source repositories");
  registerSourceCommands(sourceCmd, services, { includeInit: true });

  const resourceCmd = program
    .command("resource")
    .description("Manage resources from current default source");
  registerResourceCommands(resourceCmd, services);

  const projectCmd = program
    .command("project")
    .description("Manage installed resources in current project");
  registerProjectCommands(projectCmd, services);

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
  source   Data source management (git now, registry reserved)
           init, source init, source add, source alias, source rename,
           source use, source list, source init-docs, source clone, source sync
  resource Source resource discovery and metadata
           list, list --source, list --archived, list --installed, history,
           history --source, create,
           archive, restore, rename (not recommended yet),
           resource list, resource history, resource create,
           resource archive, resource restore, resource rename
  project  Resource usage lifecycle in current project or user-level agent dirs
           list, install, install --source, install --include-archived, dev,
           uninstall, publish, publish --source,
           project list, project install, project dev, project uninstall, project publish
  agent    Default agent configuration
           agent list, agent use, agent current, agent clear
  doctor   Runtime and project health checks
           doctor
`,
  );
}
