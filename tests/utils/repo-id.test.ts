import { describe, expect, it } from "vitest";
import { toRepoId } from "../../src/utils/repo-id.js";

describe("toRepoId", () => {
  it("normalizes git url and strips .git suffix", () => {
    expect(toRepoId("https://github.com/acme/himan.git")).toBe(
      "https_github.com_acme_himan",
    );
  });

  it("trims trailing slash and keeps safe characters", () => {
    expect(toRepoId("git@github.com:acme/himan/")).toBe(
      "git_github.com_acme_himan",
    );
  });
});
