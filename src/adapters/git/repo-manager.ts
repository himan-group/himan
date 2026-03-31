import { promises as fs } from "node:fs";
import path from "node:path";
import { simpleGit } from "simple-git";

export class RepoManager {
  async cloneOrFetch(repo: string, targetDir: string): Promise<void> {
    const gitDir = path.join(targetDir, ".git");
    const hasGitDir = await this.exists(gitDir);
    if (!hasGitDir) {
      await fs.mkdir(path.dirname(targetDir), { recursive: true });
      await simpleGit().clone(repo, targetDir);
      return;
    }

    const git = simpleGit(targetDir);
    await git.fetch(["--tags", "--prune"]);
  }

  async listTags(repoDir: string, pattern: string): Promise<string[]> {
    const git = simpleGit(repoDir);
    const output = await git.raw(["tag", "--list", pattern]);
    return output
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
  }

  async archiveResource(
    _tag: string,
    _resourcePath: string,
    _targetDir: string,
  ): Promise<void> {
    // TODO: implement with git archive.
  }

  async commitTagAndPush(
    _message: string,
    _tag: string,
    _branch = "main",
  ): Promise<void> {
    // TODO: implement git add/commit/tag/push.
  }

  private async exists(targetPath: string): Promise<boolean> {
    try {
      await fs.access(targetPath);
      return true;
    } catch {
      return false;
    }
  }
}
