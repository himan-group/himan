import { promises as fs } from "node:fs";
import path from "node:path";
import { simpleGit, type SimpleGit } from "simple-git";
import { HimanError, errorCodes } from "../../utils/errors.js";

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
    paths: string[] = ["."],
  ): Promise<void> {
    const git = simpleGit(repoDir);
    await this.commitChanges(git, message, paths, true);
    await git.addTag(tag);
    await this.pushCurrentBranch(git, branch);
    await git.pushTags("origin");
  }

  async commitAndPush(
    repoDir: string,
    message: string,
    branch?: string,
    paths: string[] = ["."],
  ): Promise<boolean> {
    const git = simpleGit(repoDir);
    const committed = await this.commitChanges(git, message, paths, false);
    if (!committed) return false;
    await this.pushCurrentBranch(git, branch);
    return true;
  }

  private async commitChanges(
    git: SimpleGit,
    message: string,
    paths: string[],
    requireChanges: boolean,
  ): Promise<boolean> {
    const pathspecs = paths.length > 0 ? paths : ["."];
    await git.add(pathspecs);
    const stagedFiles = await git.raw([
      "diff",
      "--cached",
      "--name-only",
      "--",
      ...pathspecs,
    ]);
    if (!stagedFiles.trim()) {
      if (requireChanges) {
        throw new HimanError(
          errorCodes.PUBLISH_NO_CHANGES,
          "No changes to publish.",
        );
      }
      return false;
    }

    await git.commit(message, pathspecs);
    return true;
  }

  private async pushCurrentBranch(git: SimpleGit, branch?: string): Promise<void> {
    const currentBranch = (
      await git.raw(["rev-parse", "--abbrev-ref", "HEAD"])
    ).trim();
    const targetBranch = branch ?? currentBranch;
    await git.push("origin", targetBranch);
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
