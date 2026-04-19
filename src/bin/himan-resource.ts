#!/usr/bin/env node
import { buildResourceCli } from "../cli/index.js";
import { runCliMain } from "./shared.js";

async function main(): Promise<void> {
  await runCliMain(buildResourceCli);
}

void main();
