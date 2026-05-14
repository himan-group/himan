import type { Command } from "commander";
import type { DoctorCheck, DoctorResult } from "../domain/doctor.js";
import type { ServiceFactory } from "../services/index.js";
import { runAction } from "./shared.js";

export function registerDoctorCommand(
  command: Command,
  services: ServiceFactory,
): void {
  command
    .command("doctor")
    .option("--json", "output json format")
    .description("Check Himan runtime and project health")
    .action(async (options: { json?: boolean }) => {
      await runAction(async () => {
        const result = await services.doctor(process.cwd());
        if (options.json) {
          process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
        } else {
          writeDoctorResult(result);
        }
        if (!result.ok) {
          process.exitCode = 1;
        }
      });
    });
}

function writeDoctorResult(result: DoctorResult): void {
  process.stdout.write("Himan doctor\n");
  for (const check of result.checks) {
    process.stdout.write(`${formatCheckStatus(check)} ${check.name}: ${check.message}\n`);
  }
}

function formatCheckStatus(check: DoctorCheck): string {
  return `[${check.status}]`;
}
