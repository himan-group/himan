#!/usr/bin/env node
import { buildCli } from "../cli/index.js";
import { runCliMain } from "./shared.js";

async function main(): Promise<void> {
  await runCliMain(buildCli);
}

void main();
