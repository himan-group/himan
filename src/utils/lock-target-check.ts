import { promises as fs } from "node:fs";
import type { ProjectLock } from "../state/project-lock-store.js";
import { getProjectResourcePaths, normalizeAgents } from "./agent-configs.js";

export interface MissingLockTarget {
  resource: string;
  path: string;
}

/**
 * Shared lock target verification used by both `system doctor` and
 * `system audit` so the check is maintained in exactly one place.
 */
export async function findMissingLockTargets(
  projectDir: string,
  lock: ProjectLock,
): Promise<MissingLockTarget[]> {
  const missing: MissingLockTarget[] = [];
  for (const resource of lock.resources) {
    const agents = normalizeAgents(resource.agents);
    const targets = getProjectResourcePaths(
      projectDir,
      resource.type,
      resource.name,
      agents,
    );
    for (const targetPath of targets) {
      if (!(await exists(targetPath))) {
        missing.push({
          resource: `${resource.type}/${resource.name}@${resource.version}`,
          path: targetPath,
        });
      }
    }
  }
  return missing;
}

async function exists(targetPath: string): Promise<boolean> {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}
