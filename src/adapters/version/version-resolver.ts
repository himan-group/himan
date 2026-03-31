import semver from "semver";

export class VersionResolver {
  getLatest(versions: string[]): string | undefined {
    return semver.rsort(versions.filter((v) => semver.valid(v))).at(0);
  }

  nextVersion(
    current: string,
    releaseType: "patch" | "minor" | "major",
  ): string {
    const next = semver.inc(current, releaseType);
    if (!next) {
      throw new Error(`Failed to bump version from ${current}`);
    }
    return next;
  }
}
