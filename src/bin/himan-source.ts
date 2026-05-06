#!/usr/bin/env node
import { buildSourceCli } from "../cli/index.js";
import { runCliMain } from "./shared.js";

async function main(): Promise<void> {
  await runCliMain(buildSourceCli);
}

void main();
