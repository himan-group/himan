import { promises as fs } from "node:fs";
import path from "node:path";
import { simpleGit, type SimpleGit } from "simple-git";

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
    await this.fastForwardCleanWorkingTree(git);
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
    repoDir: string,
    message: string,
    tag: string,
    branch?: string,
  ): Promise<void> {
    const git = simpleGit(repoDir);
    await git.add(["."]);
    const status = await git.status();
    if (status.isClean()) {
      throw new Error("No changes to publish.");
    }

    await git.commit(message);
    await git.addTag(tag);

    const currentBranch = (
      await git.raw(["rev-parse", "--abbrev-ref", "HEAD"])
    ).trim();
    const targetBranch = branch ?? currentBranch;
    await git.push("origin", targetBranch);
    await git.pushTags("origin");
  }

  private async exists(targetPath: string): Promise<boolean> {
    try {
      await fs.access(targetPath);
      return true;
    } catch {
      return false;
    }
  }

  private async fastForwardCleanWorkingTree(git: SimpleGit): Promise<void> {
    const status = await git.status();
    if (!status.isClean()) {
      return;
    }

    const upstream = await this.getCurrentUpstream(git);
    if (!upstream) {
      return;
    }

    await git.raw(["merge", "--ff-only", upstream]);
  }

  private async getCurrentUpstream(git: SimpleGit): Promise<string | undefined> {
    try {
      const upstream = await git.raw([
        "rev-parse",
        "--abbrev-ref",
        "--symbolic-full-name",
        "@{u}",
      ]);
      const trimmed = upstream.trim();
      return trimmed.length > 0 ? trimmed : undefined;
    } catch {
      return undefined;
    }
  }
}
