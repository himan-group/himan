import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const moduleDir = dirname(fileURLToPath(import.meta.url));
const pkgPath = join(moduleDir, "../package.json");
const parsed = JSON.parse(readFileSync(pkgPath, "utf8")) as { version?: string };

if (typeof parsed.version !== "string" || parsed.version.length === 0) {
  throw new Error("Invalid or missing version in package.json");
}

export const PACKAGE_VERSION = parsed.version;
