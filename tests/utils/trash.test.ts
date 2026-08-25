import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { moveToTrash } from "../../src/utils/trash.js";

let tmpRoot = "";

beforeEach(async () => {
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "himan-trash-"));
});

afterEach(async () => {
  if (tmpRoot) {
    await fs.rm(tmpRoot, { recursive: true, force: true });
  }
});

describe("moveToTrash", () => {
  it("moves a file into the trash directory", async () => {
    const homeDir = path.join(tmpRoot, "home");
    await fs.mkdir(homeDir, { recursive: true });
    const target = path.join(tmpRoot, "stale.txt");
    await fs.writeFile(target, "stale", "utf8");

    const trashPath = await moveToTrash(target, homeDir);

    await expect(fs.access(target)).rejects.toThrow();
    await expect(fs.readFile(trashPath, "utf8")).resolves.toBe("stale");
  });

  it("avoids name collisions in the trash directory", async () => {
    const homeDir = path.join(tmpRoot, "home");
    await fs.mkdir(homeDir, { recursive: true });
    const target = path.join(tmpRoot, "stale.txt");
    await fs.writeFile(target, "first", "utf8");
    const first = await moveToTrash(target, homeDir);

    await fs.writeFile(target, "second", "utf8");
    const second = await moveToTrash(target, homeDir);

    expect(first).not.toBe(second);
    await expect(fs.readFile(first, "utf8")).resolves.toBe("first");
    await expect(fs.readFile(second, "utf8")).resolves.toBe("second");
  });
});
