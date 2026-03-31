import { Command } from "commander";
import { ServiceFactory } from "../services/index.js";

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
      await services.initSource("git", gitRepo);
      process.stdout.write(`Initialized source repo: ${gitRepo}\n`);
    });

  program
    .command("list")
    .argument("[type]", "resource type", "rule")
    .description("List resources")
    .action(async () => {
      process.stdout.write("List command scaffold is ready.\n");
    });

  program
    .command("history")
    .argument("<type>", "resource type")
    .argument("<name>", "resource name")
    .description("Show resource history")
    .action(async () => {
      process.stdout.write("History command scaffold is ready.\n");
    });

  program
    .command("install")
    .argument("<type>", "resource type")
    .argument("<name_version>", "resource name with optional @version")
    .description("Install resource")
    .action(async () => {
      process.stdout.write("Install command scaffold is ready.\n");
    });

  program
    .command("dev")
    .argument("<type>", "resource type")
    .argument("<name>", "resource name")
    .description("Switch resource to development mode")
    .action(async () => {
      process.stdout.write("Dev command scaffold is ready.\n");
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
