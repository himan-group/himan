import { describe, expect, it } from "vitest";
import { VersionResolver } from "../../src/adapters/version/version-resolver.js";

describe("VersionResolver", () => {
  const resolver = new VersionResolver();

  it("returns latest valid semver", () => {
    expect(resolver.getLatest(["1.0.0", "foo", "1.2.0", "1.1.5"])).toBe("1.2.0");
  });

  it("returns undefined when there is no valid version", () => {
    expect(resolver.getLatest(["foo", "bar"])).toBeUndefined();
  });

  it("bumps patch/minor/major correctly", () => {
    expect(resolver.nextVersion("1.2.3", "patch")).toBe("1.2.4");
    expect(resolver.nextVersion("1.2.3", "minor")).toBe("1.3.0");
    expect(resolver.nextVersion("1.2.3", "major")).toBe("2.0.0");
  });
});
