import { Command, CommanderError } from "commander";
import { errorCodes, HimanError } from "../utils/errors.js";
import { PACKAGE_VERSION } from "../utils/version.js";

interface CliErrorPayload {
  ok: false;
  error: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
  };
}

export function createBaseProgram(name: string, description: string): Command {
  const program = new Command();
  program.exitOverride();
  program.configureOutput({
    writeOut: (str: string) => {
      process.stdout.write(str);
    },
    writeErr: () => {
      // Parse/usage errors are unified by writeCliError().
    },
  });

  program.name(name).description(description).version(PACKAGE_VERSION);
  return program;
}

export async function runAction(action: () => Promise<void>): Promise<void> {
  try {
    await action();
  } catch (error) {
    writeCliError(error);
    process.exitCode = 1;
  }
}

export function writeCliError(error: unknown): void {
  const payload = toCliErrorPayload(error);
  if (shouldOutputJsonError()) {
    process.stderr.write(`${JSON.stringify(payload, null, 2)}\n`);
    return;
  }
  process.stderr.write(`[${payload.error.code}] ${payload.error.message}\n`);
}

function toCliErrorPayload(error: unknown): CliErrorPayload {
  if (error instanceof CommanderError) {
    return {
      ok: false,
      error: {
        code: errorCodes.CLI_USAGE,
        message: error.message,
        details: {
          commanderCode: error.code,
          exitCode: error.exitCode,
        },
      },
    };
  }
  if (error instanceof HimanError) {
    return {
      ok: false,
      error: {
        code: error.code,
        message: error.message,
        details: error.details,
      },
    };
  }
  return {
    ok: false,
    error: {
      code: "E_UNKNOWN",
      message: error instanceof Error ? error.message : String(error),
    },
  };
}

function shouldOutputJsonError(): boolean {
  return process.argv.includes("--json");
}
