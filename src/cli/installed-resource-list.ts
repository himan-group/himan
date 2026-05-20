import type { ResourceType } from "../domain/resource.js";
import type { InstalledResource, ServiceFactory } from "../services/index.js";

const RESOURCE_TYPES: ResourceType[] = ["rule", "command", "skill", "config"];

export type InstalledResourceGroups = Record<ResourceType, InstalledResource[]>;

export async function listInstalledResourceGroups(
  services: ServiceFactory,
  projectDir: string,
  agents?: string[],
): Promise<InstalledResourceGroups> {
  const resources = await services.listInstalled(projectDir, undefined, agents);
  return groupInstalledResources(resources);
}

export function groupInstalledResources(
  resources: InstalledResource[],
): InstalledResourceGroups {
  return {
    rule: resources.filter((resource) => resource.type === "rule"),
    command: resources.filter((resource) => resource.type === "command"),
    skill: resources.filter((resource) => resource.type === "skill"),
    config: resources.filter((resource) => resource.type === "config"),
  };
}

export function writeInstalledResourceGroups(groups: InstalledResourceGroups): void {
  const hasResources = RESOURCE_TYPES.some((type) => groups[type].length > 0);
  if (!hasResources) {
    process.stdout.write("No installed resources found.\n");
    return;
  }

  for (const type of RESOURCE_TYPES) {
    const resources = groups[type];
    if (resources.length === 0) continue;
    process.stdout.write(`${formatGroupTitle(type)}:\n`);
    writeInstalledResources(resources);
  }
}

export function writeInstalledResources(resources: InstalledResource[]): void {
  if (resources.length === 0) {
    process.stdout.write("No installed resources found.\n");
    return;
  }

  for (const resource of resources) {
    process.stdout.write(`- ${formatInstalledResource(resource)}\n`);
  }
}

function formatInstalledResource(resource: InstalledResource): string {
  const agents = resource.agents.length > 0 ? ` [${resource.agents.join(", ")}]` : "";
  return `${resource.type}/${resource.name}@${resource.version}${agents} (${resource.mode})`;
}

function formatGroupTitle(type: ResourceType): string {
  if (type === "rule") return "Rules";
  if (type === "command") return "Commands";
  if (type === "config") return "Configs";
  return "Skills";
}
