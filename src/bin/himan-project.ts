#!/usr/bin/env node
import { buildProjectCli } from "../cli/index.js";
import { runCliMain } from "./shared.js";

async function main(): Promise<void> {
  await runCliMain(buildProjectCli);
}

void main();
