#!/usr/bin/env node
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

const TEXT_EXTENSIONS = new Set([
  ".md",
  ".yaml",
  ".yml",
  ".json",
  ".js",
  ".mjs",
  ".ts",
  ".py",
  ".sh",
]);

const TOKENIZER = "approx-char-v1";
const TOKEN_ESTIMATOR = "ceil(chars/4)";
const DEFAULT_VERSION = "0.0.1";
const RESOURCE_TYPE = "skill";
const DEFAULT_CATEGORY = "General";
const execFileAsync = promisify(execFile);

async function main() {
  const { skillDir, options } = parseArgs(process.argv.slice(2));
  const root = path.resolve(skillDir);
  const entry = options.entry ?? "SKILL.md";
  const entryPath = path.join(root, entry);
  const metadataPath = path.join(root, "himan.yaml");
  const skillRaw = await fs.readFile(entryPath, "utf8");
  const frontMatter = parseFrontMatter(skillRaw);
  const existingComment = await readExistingComment(metadataPath);
  const name = options.name ?? frontMatter.name ?? path.basename(root);
  const description = options.description ?? frontMatter.description;
  const version = options.version ?? (await resolveVersion(root, name)) ?? DEFAULT_VERSION;
  const category =
    options.category ??
    frontMatter.category ??
    (await readYamlStringField(metadataPath, "category")) ??
    inferCategory(name);

  if (!description) {
    throw new Error("Skill description not found. Set SKILL.md front matter or --description.");
  }

  const packageFiles = await readPackageTextFiles(root);
  const scripts = [
    ...new Set([
      ...findScriptDependencies(packageFiles),
      ...options.scripts,
    ]),
  ].sort((a, b) => a.localeCompare(b));
  const now = new Date().toISOString();
  const metadata = {
    name,
    type: "skill",
    version,
    entry,
    description,
    category,
    agents: options.agents,
    ...(existingComment ? { comment: existingComment } : {}),
    analysis: {
      content: {
        tokenizer: TOKENIZER,
        tokenEstimator: TOKEN_ESTIMATOR,
        entryTokens: estimateTokens(skillRaw),
        packageTokens: estimateTokens(packageFiles.map((file) => file.content).join("\n")),
        contentHash: hashPackageFiles(packageFiles),
        measuredAt: now,
        measuredBy: options.measuredBy,
      },
      dependencies: {
        skills: options.skills,
        scripts: scripts.map((scriptPath) => ({ path: scriptPath })),
        mcpTools: options.mcpTools,
      },
      generation: {
        generatedBy: options.generatedBy,
        generatedAt: now,
        ...(options.model ? { model: options.model } : {}),
        ...(options.promptRef ? { promptRef: options.promptRef } : {}),
      },
    },
  };

  const yaml = `${toYaml(metadata)}\n`;
  if (options.stdout) {
    process.stdout.write(yaml);
    return;
  }

  await fs.writeFile(metadataPath, yaml, "utf8");
  process.stdout.write(`Wrote ${metadataPath}\n`);
}

function parseArgs(args) {
  const [skillDir, ...rest] = args;
  if (!skillDir || skillDir.startsWith("-")) {
    throw new Error("Usage: build_himan_yaml.mjs <skill-dir> [options]");
  }

  const options = {
    version: undefined,
    entry: "SKILL.md",
    agents: [],
    generatedBy: "codex",
    measuredBy: "codex",
    skills: [],
    scripts: [],
    mcpTools: [],
    stdout: false,
  };

  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index];
    const next = () => {
      index += 1;
      if (index >= rest.length) throw new Error(`Missing value for ${arg}`);
      return rest[index];
    };

    if (arg === "--version") options.version = next();
    else if (arg === "--entry") options.entry = next();
    else if (arg === "--name") options.name = next();
    else if (arg === "--description") options.description = next();
    else if (arg === "--category") options.category = next();
    else if (arg === "--agent") options.agents.push(...splitList(next()));
    else if (arg === "--generated-by") options.generatedBy = next();
    else if (arg === "--measured-by") options.measuredBy = next();
    else if (arg === "--model") options.model = next();
    else if (arg === "--prompt-ref") options.promptRef = next();
    else if (arg === "--skill") options.skills.push(next());
    else if (arg === "--script") options.scripts.push(next());
    else if (arg === "--mcp-tool") options.mcpTools.push(next());
    else if (arg === "--stdout") options.stdout = true;
    else throw new Error(`Unknown option: ${arg}`);
  }

  options.agents = [...new Set(options.agents.length ? options.agents : ["codex"])];
  options.skills = [...new Set(options.skills)].sort((a, b) => a.localeCompare(b));
  options.scripts = [...new Set(options.scripts)].sort((a, b) => a.localeCompare(b));
  options.mcpTools = [...new Set(options.mcpTools)].sort((a, b) => a.localeCompare(b));
  return { skillDir, options };
}

function inferCategory(name) {
  const prefix = String(name ?? "")
    .split(/[-_]/)[0]
    ?.toLowerCase();
  const prefixCategoryMap = {
    ai: "AI",
    common: "Common",
    codex: "Codex",
    fe: "Frontend",
    flowops: "FlowOps",
    github: "GitHub",
    himan: "Himan",
    infra: "Infra",
    jira: "Jira",
    openai: "OpenAI",
    qa: "QA",
    space: "Space",
  };
  return prefixCategoryMap[prefix] ?? DEFAULT_CATEGORY;
}

async function resolveVersion(root, name) {
  return (
    (await readNearestLockVersion(root, name)) ??
    (await readSourceGitTagVersion(root, name)) ??
    readStorePathVersion(root, name) ??
    (await readYamlStringField(path.join(root, "himan.yaml"), "version"))
  );
}

async function readNearestLockVersion(startDir, name) {
  let current = startDir;
  while (true) {
    const version = await readLockVersion(path.join(current, "himan.lock"), name);
    if (version) return version;

    const parent = path.dirname(current);
    if (parent === current) return undefined;
    current = parent;
  }
}

async function readLockVersion(lockPath, name) {
  let parsed;
  try {
    parsed = JSON.parse(await fs.readFile(lockPath, "utf8"));
  } catch {
    return undefined;
  }

  if (!Array.isArray(parsed?.resources)) return undefined;
  const found = parsed.resources.find(
    (resource) =>
      resource?.type === RESOURCE_TYPE &&
      resource?.name === name &&
      typeof resource?.version === "string" &&
      resource.version.trim().length > 0,
  );
  return found?.version;
}

async function readSourceGitTagVersion(root, name) {
  const repoRoot = await findGitRoot(root);
  if (!repoRoot) return undefined;

  const relative = toPosix(path.relative(repoRoot, root));
  if (relative !== `skills/${name}` && relative !== `archive/skills/${name}`) {
    return undefined;
  }

  const prefix = `${RESOURCE_TYPE}/${name}@`;
  let stdout;
  try {
    ({ stdout } = await execFileAsync("git", [
      "-C",
      repoRoot,
      "tag",
      "--list",
      `${prefix}*`,
    ]));
  } catch {
    return undefined;
  }

  const versions = stdout
    .split(/\r?\n/)
    .map((tag) => tag.trim())
    .filter((tag) => tag.startsWith(prefix))
    .map((tag) => tag.slice(prefix.length))
    .filter((version) => parseVersion(version));

  return versions.sort(compareVersions).at(-1);
}

async function findGitRoot(startDir) {
  let current = startDir;
  while (true) {
    if (await pathExists(path.join(current, ".git"))) return current;

    const parent = path.dirname(current);
    if (parent === current) return undefined;
    current = parent;
  }
}

function readStorePathVersion(root, name) {
  const parts = toPosix(root).split("/");
  for (let index = 0; index <= parts.length - 4; index += 1) {
    if (
      parts[index] === "store" &&
      parts[index + 1] === RESOURCE_TYPE &&
      parts[index + 2] === name &&
      parseVersion(parts[index + 3])
    ) {
      return parts[index + 3];
    }
  }
  return undefined;
}

async function readYamlStringField(filePath, fieldName) {
  let raw;
  try {
    raw = await fs.readFile(filePath, "utf8");
  } catch {
    return undefined;
  }

  const pattern = new RegExp(`^${escapeRegExp(fieldName)}:\\s*(.+?)\\s*$`, "m");
  const match = pattern.exec(raw);
  if (!match) return undefined;

  const value = unquote(match[1].trim());
  return value ? value : undefined;
}

async function readExistingComment(filePath) {
  let raw;
  try {
    raw = await fs.readFile(filePath, "utf8");
  } catch {
    return undefined;
  }

  const inline = new RegExp(`^comment:\\s*\\{(.+?)\\}\\s*$`, "m").exec(raw);
  if (inline) {
    return normalizeComment(
      Object.fromEntries(
        inline[1]
          .split(",")
          .map((part) => part.trim())
          .map((part) => {
            const index = part.indexOf(":");
            return index === -1
              ? [part, ""]
              : [part.slice(0, index).trim(), readYamlScalar(part.slice(index + 1))];
          }),
      ),
    );
  }

  const lines = raw.split(/\r?\n/);
  const commentIndex = lines.findIndex((line) => /^comment:\s*$/.test(line));
  if (commentIndex === -1) return undefined;

  const fields = {};
  for (const line of lines.slice(commentIndex + 1)) {
    if (/^\S/.test(line)) break;
    const match = /^\s+([A-Za-z0-9_-]+):\s*(.*?)\s*$/.exec(line);
    if (!match) continue;
    fields[match[1]] = readYamlScalar(match[2]);
  }
  return normalizeComment(fields);
}

function normalizeComment(fields) {
  const score = Number(fields.score);
  if (!Number.isInteger(score) || score < 1 || score > 10) return undefined;

  const text = typeof fields.text === "string" ? fields.text.trim() : "";
  return {
    score,
    ...(text ? { text } : {}),
  };
}

function readYamlScalar(value) {
  const trimmed = value.trim();
  if (trimmed.startsWith('"')) {
    try {
      return JSON.parse(trimmed);
    } catch {
      return unquote(trimmed);
    }
  }
  return unquote(trimmed);
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function pathExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function compareVersions(left, right) {
  const leftParsed = parseVersion(left);
  const rightParsed = parseVersion(right);
  if (!leftParsed || !rightParsed) return left.localeCompare(right);

  for (const key of ["major", "minor", "patch"]) {
    const diff = leftParsed[key] - rightParsed[key];
    if (diff !== 0) return diff;
  }
  if (!leftParsed.preRelease && rightParsed.preRelease) return 1;
  if (leftParsed.preRelease && !rightParsed.preRelease) return -1;
  return leftParsed.preRelease.localeCompare(rightParsed.preRelease);
}

function parseVersion(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(
    version,
  );
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    preRelease: match[4] ?? "",
  };
}

async function readPackageTextFiles(root) {
  const files = [];
  await collect(root, root, files);
  return files.sort((a, b) => a.path.localeCompare(b.path));
}

async function collect(root, dir, files) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    const relative = toPosix(path.relative(root, fullPath));
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === ".git") continue;
      await collect(root, fullPath, files);
      continue;
    }
    if (!entry.isFile() || entry.name === "himan.yaml") continue;
    if (!TEXT_EXTENSIONS.has(path.extname(entry.name))) continue;
    files.push({
      path: relative,
      content: await fs.readFile(fullPath, "utf8"),
    });
  }
}

function parseFrontMatter(content) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(content.trimStart());
  if (!match) return {};
  const result = {};
  for (const line of match[1].split(/\r?\n/)) {
    const field = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);
    if (!field) continue;
    result[field[1]] = unquote(field[2].trim());
  }
  return result;
}

function findScriptDependencies(files) {
  return files
    .map((file) => file.path)
    .filter((filePath) => filePath.startsWith("scripts/"));
}

function splitList(value) {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function estimateTokens(content) {
  return Math.ceil(content.length / 4);
}

function hashPackageFiles(files) {
  const hash = createHash("sha256");
  for (const file of files) {
    hash.update(file.path);
    hash.update("\0");
    hash.update(file.content);
    hash.update("\0");
  }
  return `sha256:${hash.digest("hex")}`;
}

function toYaml(value, indent = 0) {
  if (Array.isArray(value)) {
    if (value.length === 0) return "[]";
    return value
      .map((item) => {
        const prefix = `${" ".repeat(indent)}-`;
        if (isScalar(item)) return `${prefix} ${formatScalar(item)}`;
        if (isPlainObject(item)) return formatArrayObject(item, indent);
        return `${prefix}\n${toYaml(item, indent + 2)}`;
      })
      .join("\n");
  }

  if (isPlainObject(value)) {
    return Object.entries(value)
      .map(([key, item]) => {
        if (isScalar(item) || (Array.isArray(item) && item.length === 0)) {
          return `${" ".repeat(indent)}${key}: ${formatScalar(item)}`;
        }
        return `${" ".repeat(indent)}${key}:\n${toYaml(item, indent + 2)}`;
      })
      .join("\n");
  }

  return formatScalar(value);
}

function formatArrayObject(value, indent) {
  const entries = Object.entries(value);
  if (entries.length === 0) return `${" ".repeat(indent)}- {}`;

  const [firstKey, firstValue] = entries[0];
  const lines = [];
  if (isScalar(firstValue) || (Array.isArray(firstValue) && firstValue.length === 0)) {
    lines.push(`${" ".repeat(indent)}- ${firstKey}: ${formatScalar(firstValue)}`);
  } else {
    lines.push(`${" ".repeat(indent)}- ${firstKey}:`);
    lines.push(toYaml(firstValue, indent + 4));
  }

  for (const [key, item] of entries.slice(1)) {
    if (isScalar(item) || (Array.isArray(item) && item.length === 0)) {
      lines.push(`${" ".repeat(indent + 2)}${key}: ${formatScalar(item)}`);
    } else {
      lines.push(`${" ".repeat(indent + 2)}${key}:`);
      lines.push(toYaml(item, indent + 4));
    }
  }
  return lines.join("\n");
}

function isScalar(value) {
  return value === null || typeof value !== "object";
}

function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function formatScalar(value) {
  if (Array.isArray(value) && value.length === 0) return "[]";
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (value === null) return "null";
  const text = String(value);
  return canUsePlainScalar(text) ? text : JSON.stringify(text);
}

function canUsePlainScalar(text) {
  if (text.length === 0) return false;
  if (/^\s|\s$/.test(text)) return false;
  if (/[\r\n\t]/.test(text)) return false;
  if (/^(?:null|true|false|[-+]?(?:\d+|\d+\.\d+))(?:$|\s)/i.test(text)) return false;
  if (/^[!&*?:[\]{}#,|>@`"']/.test(text)) return false;
  if (text.includes(": ")) return false;
  if (text.includes(" #")) return false;
  return true;
}

function unquote(value) {
  const match = /^["'](.*)["']$/.exec(value);
  return match ? match[1] : value;
}

function toPosix(filePath) {
  return filePath.split(path.sep).join("/");
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
