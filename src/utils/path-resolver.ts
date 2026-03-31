import os from "node:os";
import path from "node:path";

export class PathResolver {
  getHomeDir(): string {
    return os.homedir();
  }

  getHimanRoot(): string {
    return path.join(this.getHomeDir(), ".himan");
  }

  getReposDir(): string {
    return path.join(this.getHimanRoot(), "repos");
  }

  getStoreDir(): string {
    return path.join(this.getHimanRoot(), "store");
  }
}
