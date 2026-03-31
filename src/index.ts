#!/usr/bin/env node
import { buildCli } from "./cli/index.js";

async function main(): Promise<void> {
  const program = buildCli();
  await program.parseAsync(process.argv);
}

void main();
