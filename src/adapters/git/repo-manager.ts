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
    repoDir: string,
    tag: string,
    resourcePath: string,
    targetDir: string,
  ): Promise<void> {
    await fs.rm(targetDir, { recursive: true, force: true });
    await fs.mkdir(targetDir, { recursive: true });

    const git = simpleGit(repoDir);
    const output = await git.raw([
      "ls-tree",
      "-r",
      "--name-only",
      tag,
      resourcePath,
    ]);
    const files = output
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);

    for (const file of files) {
      const content = await git.raw(["show", `${tag}:${file}`]);
      const relative = path.relative(resourcePath, file);
      const destination = path.join(targetDir, relative);
      await fs.mkdir(path.dirname(destination), { recursive: true });
      await fs.writeFile(destination, content, "utf8");
    }
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
