#!/usr/bin/env node
import { CommanderError } from "commander";
import { buildCli, writeCliError } from "./cli/index.js";

async function main(): Promise<void> {
  const program = buildCli();
  try {
    await program.parseAsync(process.argv);
  } catch (error) {
    if (error instanceof CommanderError && error.exitCode === 0) {
      return;
    }
    writeCliError(error);
    process.exitCode = error instanceof CommanderError ? error.exitCode : 1;
  }
}

void main();
