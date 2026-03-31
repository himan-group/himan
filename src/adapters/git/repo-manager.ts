export class RepoManager {
  async cloneOrFetch(_repo: string, _targetDir: string): Promise<void> {
    // TODO: implement with simple-git in MVP execution phase.
  }

  async listTags(_pattern: string): Promise<string[]> {
    // TODO: implement with simple-git in MVP execution phase.
    return [];
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
}
