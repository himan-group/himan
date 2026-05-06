import { CommanderError, type Command } from "commander";
import { writeCliError } from "../cli/index.js";

export async function runCliMain(buildProgram: () => Command): Promise<void> {
  const program = buildProgram();
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
