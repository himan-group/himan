export function toRepoId(repo: string): string {
  const normalized = repo.replace(/\/+$/, "").replace(/\.git$/, "");
  return normalized.replace(/[^a-zA-Z0-9._-]+/g, "_");
}
