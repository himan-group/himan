import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * Move a file or directory to the system trash instead of hard-deleting it.
 * Supports macOS `~/.Trash` and the freedesktop trash directory on Linux;
 * falls back to `<himan home>/trash` when no system trash is available.
 */
export async function moveToTrash(
  targetPath: string,
  homeDir: string = os.homedir(),
): Promise<string> {
  const trashDir = resolveTrashDir(homeDir);
  await fs.mkdir(trashDir, { recursive: true });
  const destination = await uniqueDestination(trashDir, path.basename(targetPath));
  try {
    await fs.rename(targetPath, destination);
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err.code !== "EXDEV") throw error;
    // Cross-device move: copy, verify, then remove the source.
    await fs.cp(targetPath, destination, { recursive: true });
    await fs.rm(targetPath, { recursive: true, force: true });
  }
  return destination;
}

function resolveTrashDir(homeDir: string): string {
  if (process.platform === "darwin") {
    return path.join(homeDir, ".Trash");
  }
  if (process.platform === "linux") {
    const xdgDataHome =
      process.env.XDG_DATA_HOME?.trim() || path.join(homeDir, ".local", "share");
    return path.join(xdgDataHome, "Trash", "files");
  }
  return path.join(homeDir, ".himan", "trash");
}

async function uniqueDestination(
  trashDir: string,
  baseName: string,
): Promise<string> {
  const candidate = path.join(trashDir, baseName);
  if (!(await exists(candidate))) return candidate;
  const ext = path.extname(baseName);
  const stem = ext ? baseName.slice(0, -ext.length) : baseName;
  return path.join(
    trashDir,
    `${stem}-${Date.now()}${ext}`,
  );
}

async function exists(targetPath: string): Promise<boolean> {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}
