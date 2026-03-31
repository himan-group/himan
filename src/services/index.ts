import { GitSourceAdapter } from "../adapters/source/git-source-adapter.js";
import { RegistrySourceAdapter } from "../adapters/source/registry-source-adapter.js";
import type { ResourceSourceAdapter } from "../adapters/source/resource-source-adapter.js";
import { StateStore } from "../state/state-store.js";

export class ServiceFactory {
  private readonly stateStore = new StateStore();

  async initSource(
    type: "git" | "registry",
    repo?: string,
  ): Promise<ResourceSourceAdapter> {
    await this.stateStore.ensureBaseDirs();
    await this.stateStore.saveConfig({ source: { type, repo } });

    return type === "registry"
      ? new RegistrySourceAdapter()
      : new GitSourceAdapter();
  }
}
