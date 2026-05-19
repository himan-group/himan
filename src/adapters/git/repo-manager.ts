import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { simpleGit, type SimpleGit } from "simple-git";
import type {
  GitSourceCloneResult,
  GitSourceSyncResult,
  SourceCloneOptions,
  SourceSyncOptions,
  SourceSyncResource,
} from "../../domain/source-transfer.js";
import { HimanError, errorCodes } from "../../utils/errors.js";

const MANAGED_TAG_PATTERNS = ["rule/*@*", "command/*@*", "skill/*@*"];

interface GitRemoteRef {
  hash: string;
  ref: string;
}

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

  async readTagDate(repoDir: string, tag: string): Promise<string | undefined> {
    const git = simpleGit(repoDir);
    try {
      const output = await git.raw(["log", "-1", "--format=%cs", tag]);
      const trimmed = output.trim();
      return trimmed ? trimmed : undefined;
    } catch {
      return undefined;
    }
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

  async cloneManagedSourceRefs(
    sourceRepoDir: string,
    targetRepo: string,
    options: SourceCloneOptions = {},
  ): Promise<GitSourceCloneResult> {
    const sourceGit = simpleGit(sourceRepoDir);
    await sourceGit.fetch(["--tags", "--prune"]);
    const branch = options.branch ?? (await this.getCurrentBranch(sourceGit));
    const sourceBranchRef = await this.resolveSourceBranchRef(sourceGit, branch);
    const targetBranch = options.targetBranch ?? branch;
    const targetRefs = await this.listRemoteRefs(targetRepo);

    if (targetRefs.length > 0) {
      throw new HimanError(
        errorCodes.RESOURCE_EXISTS,
        "Target source repository is not empty.",
        { targetRepo, refs: targetRefs.map((item) => item.ref) },
      );
    }

    const tags = await this.listManagedResourceTags(sourceRepoDir);
    if (options.dryRun) {
      return {
        branch,
        targetBranch,
        tags,
        dryRun: true,
        pushed: false,
      };
    }

    const refspecs = [
      `${sourceBranchRef}:refs/heads/${targetBranch}`,
      ...tags.map((tag) => `refs/tags/${tag}:refs/tags/${tag}`),
    ];
    await sourceGit.raw(["push", "--atomic", targetRepo, ...refspecs]);

    return {
      branch,
      targetBranch,
      tags,
      dryRun: false,
      pushed: true,
    };
  }

  async syncLatestSourceSnapshot(
    sourceRepoDir: string,
    targetRepo: string,
    resources: SourceSyncResource[],
    options: SourceSyncOptions = {},
  ): Promise<GitSourceSyncResult> {
    if (resources.length === 0) {
      throw new HimanError(
        errorCodes.RESOURCE_NOT_FOUND,
        "No versioned resources found to sync.",
      );
    }

    const targetBranch = options.targetBranch ?? "main";
    const targetRefs = await this.listRemoteRefs(targetRepo);
    const existingTagRefs = new Set(
      targetRefs
        .filter((item) => item.ref.startsWith("refs/tags/"))
        .map((item) => item.ref.slice("refs/tags/".length)),
    );
    const targetDir = await fs.mkdtemp(path.join(os.tmpdir(), "himan-source-sync-"));
    const snapshotsDir = await fs.mkdtemp(path.join(os.tmpdir(), "himan-source-snapshots-"));

    try {
      const targetGit = await this.prepareTargetWorktree(
        targetRepo,
        targetDir,
        targetBranch,
        targetRefs,
      );

      const results = [];
      for (const resource of resources) {
        const sourceSnapshotDir = path.join(
          snapshotsDir,
          resource.type,
          resource.name,
        );
        await this.materializeSourceResourceSnapshot(
          sourceRepoDir,
          resource,
          sourceSnapshotDir,
        );

        if (existingTagRefs.has(resource.tag)) {
          await this.ensureExistingTagMatchesResource(
            targetDir,
            resource,
            sourceSnapshotDir,
          );
          results.push({
            type: resource.type,
            name: resource.name,
            version: resource.version,
            tag: resource.tag,
            action: "skipped" as const,
          });
        } else {
          results.push({
            type: resource.type,
            name: resource.name,
            version: resource.version,
            tag: resource.tag,
            action: "created" as const,
          });
        }

        if (!options.dryRun) {
          const targetResourceDir = path.join(
            targetDir,
            this.getResourcePath(resource),
          );
          await fs.rm(targetResourceDir, { recursive: true, force: true });
          await fs.mkdir(path.dirname(targetResourceDir), { recursive: true });
          await fs.cp(sourceSnapshotDir, targetResourceDir, { recursive: true });
        }
      }

      if (options.dryRun) {
        return {
          targetBranch,
          resources: results,
          dryRun: true,
          committed: false,
          pushed: false,
        };
      }

      const changedPaths = [
        ...new Set(resources.map((resource) => `${resource.type}s`)),
      ];
      const committed = await this.commitChanges(
        targetGit,
        "sync latest himan source resources",
        changedPaths,
        false,
      );
      const createdTags = results
        .filter((result) => result.action === "created")
        .map((result) => result.tag);

      for (const tag of createdTags) {
        await targetGit.addTag(tag);
      }

      const shouldPush = committed || createdTags.length > 0;
      if (shouldPush) {
        await targetGit.raw([
          "push",
          "--atomic",
          "origin",
          `${targetBranch}:refs/heads/${targetBranch}`,
          ...createdTags.map((tag) => `refs/tags/${tag}:refs/tags/${tag}`),
        ]);
      }

      return {
        targetBranch,
        resources: results,
        dryRun: false,
        committed,
        pushed: shouldPush,
      };
    } finally {
      await fs.rm(targetDir, { recursive: true, force: true });
      await fs.rm(snapshotsDir, { recursive: true, force: true });
    }
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

  private async prepareTargetWorktree(
    targetRepo: string,
    targetDir: string,
    targetBranch: string,
    targetRefs: GitRemoteRef[],
  ): Promise<SimpleGit> {
    const hasTargetBranch = targetRefs.some(
      (item) => item.ref === `refs/heads/${targetBranch}`,
    );

    if (hasTargetBranch) {
      await simpleGit().clone(targetRepo, targetDir, ["--branch", targetBranch]);
      const git = simpleGit(targetDir);
      await git.fetch(["--tags", "--prune"]);
      return git;
    }

    const git = simpleGit(targetDir);
    await git.raw(["init", `--initial-branch=${targetBranch}`]);
    await git.addRemote("origin", targetRepo);

    if (targetRefs.some((item) => item.ref.startsWith("refs/tags/"))) {
      await git.raw(["fetch", "origin", "+refs/tags/*:refs/tags/*"]);
    }

    return git;
  }

  private async materializeSourceResourceSnapshot(
    sourceRepoDir: string,
    resource: SourceSyncResource,
    targetDir: string,
  ): Promise<void> {
    if (resource.sourceRef) {
      await this.archiveResource(
        sourceRepoDir,
        resource.sourceRef,
        this.getResourcePath(resource),
        targetDir,
      );
      return;
    }

    if (!resource.sourcePath) {
      throw new HimanError(
        errorCodes.VERSION_NOT_FOUND,
        `Version source not found for ${resource.type}/${resource.name}@${resource.version}.`,
      );
    }

    await fs.rm(targetDir, { recursive: true, force: true });
    await fs.mkdir(path.dirname(targetDir), { recursive: true });
    await fs.cp(resource.sourcePath, targetDir, { recursive: true });
  }

  private async ensureExistingTagMatchesResource(
    targetRepoDir: string,
    resource: SourceSyncResource,
    sourceSnapshotDir: string,
  ): Promise<void> {
    const previousDir = await fs.mkdtemp(path.join(os.tmpdir(), "himan-source-tag-"));
    try {
      await this.archiveResource(
        targetRepoDir,
        resource.tag,
        this.getResourcePath(resource),
        previousDir,
      );
      const [sourceSnapshot, previousSnapshot] = await Promise.all([
        this.readDirectorySnapshot(sourceSnapshotDir),
        this.readDirectorySnapshot(previousDir),
      ]);
      if (!this.snapshotsEqual(sourceSnapshot, previousSnapshot)) {
        throw new HimanError(
          errorCodes.RESOURCE_EXISTS,
          `Target tag already exists with different content: ${resource.tag}`,
        );
      }
    } finally {
      await fs.rm(previousDir, { recursive: true, force: true });
    }
  }

  private async listManagedResourceTags(repoDir: string): Promise<string[]> {
    const tags = new Set<string>();
    for (const pattern of MANAGED_TAG_PATTERNS) {
      for (const tag of await this.listTags(repoDir, pattern)) {
        tags.add(tag);
      }
    }
    return [...tags].sort((a, b) => a.localeCompare(b));
  }

  private async listRemoteRefs(repo: string): Promise<GitRemoteRef[]> {
    const output = await simpleGit().raw(["ls-remote", "--heads", "--tags", repo]);
    return output
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const [hash, ref] = line.split(/\s+/);
        return { hash, ref };
      })
      .filter((item) => item.hash && item.ref && !item.ref.endsWith("^{}"));
  }

  private async getCurrentBranch(git: SimpleGit): Promise<string> {
    const branch = (await git.raw(["rev-parse", "--abbrev-ref", "HEAD"])).trim();
    if (!branch || branch === "HEAD") {
      throw new HimanError(
        errorCodes.INVALID_INPUT,
        "Source repository is not on a named branch.",
      );
    }
    return branch;
  }

  private async resolveSourceBranchRef(
    git: SimpleGit,
    branch: string,
  ): Promise<string> {
    if (await this.hasGitRef(git, `refs/heads/${branch}`)) {
      return branch;
    }
    const remoteRef = `refs/remotes/origin/${branch}`;
    if (await this.hasGitRef(git, remoteRef)) {
      return remoteRef;
    }
    throw new HimanError(
      errorCodes.INVALID_INPUT,
      `Source branch not found: ${branch}`,
    );
  }

  private async hasGitRef(git: SimpleGit, ref: string): Promise<boolean> {
    try {
      await git.raw(["rev-parse", "--verify", ref]);
      return true;
    } catch {
      return false;
    }
  }

  private async readDirectorySnapshot(targetDir: string): Promise<Map<string, string>> {
    const files = await this.listFiles(targetDir);
    const snapshot = new Map<string, string>();
    for (const file of files) {
      const relative = path.relative(targetDir, file).split(path.sep).join("/");
      snapshot.set(relative, await fs.readFile(file, "utf8"));
    }
    return snapshot;
  }

  private async listFiles(targetDir: string): Promise<string[]> {
    const entries = await fs.readdir(targetDir, { withFileTypes: true });
    const files: string[] = [];
    for (const entry of entries) {
      const fullPath = path.join(targetDir, entry.name);
      if (entry.isDirectory()) {
        files.push(...(await this.listFiles(fullPath)));
      } else if (entry.isFile()) {
        files.push(fullPath);
      }
    }
    return files.sort((a, b) => a.localeCompare(b));
  }

  private snapshotsEqual(a: Map<string, string>, b: Map<string, string>): boolean {
    if (a.size !== b.size) return false;
    for (const [file, content] of a) {
      if (b.get(file) !== content) return false;
    }
    return true;
  }

  private getResourcePath(resource: Pick<SourceSyncResource, "type" | "name">): string {
    return `${resource.type}s/${resource.name}`;
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
