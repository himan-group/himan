import { readFileSync, writeFileSync } from "node:fs";

const packageJsonPath = "package.json";
const changelogPath = "CHANGELOG.md";

const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8"));
const version = packageJson.version;

if (typeof version !== "string" || !version) {
  throw new Error("package.json version is missing.");
}

const today = formatLocalDate(new Date());
const releaseHeading = `## [${version}] - ${today}`;
const changelog = readFileSync(changelogPath, "utf8");
const unreleasedHeading = "## [Unreleased]";
const unreleasedIndex = changelog.indexOf(unreleasedHeading);

if (unreleasedIndex === -1) {
  throw new Error("CHANGELOG.md is missing ## [Unreleased].");
}

if (changelog.includes(`## [${version}]`)) {
  throw new Error(`CHANGELOG.md already contains version ${version}.`);
}

const unreleasedBodyStart = unreleasedIndex + unreleasedHeading.length;
const nextReleaseIndex = changelog.indexOf("\n## [", unreleasedBodyStart);
const unreleasedBodyEnd =
  nextReleaseIndex === -1 ? changelog.length : nextReleaseIndex;
const unreleasedBody = changelog
  .slice(unreleasedBodyStart, unreleasedBodyEnd)
  .trim();

if (!unreleasedBody) {
  throw new Error("CHANGELOG.md has no Unreleased entries to release.");
}

const beforeUnreleasedBody = changelog
  .slice(0, unreleasedBodyStart)
  .replace(/\s*$/, "");
const afterUnreleasedBody = changelog
  .slice(unreleasedBodyEnd)
  .replace(/^\s*/, "\n\n");

const updated = [
  beforeUnreleasedBody,
  "",
  releaseHeading,
  "",
  unreleasedBody,
].join("\n") + afterUnreleasedBody;

writeFileSync(changelogPath, updated, "utf8");

console.log(`Released CHANGELOG.md entries for ${version}.`);

function formatLocalDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
