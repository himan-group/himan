export function resolveResourceCategory(name: string, explicitCategory?: string): string {
  const normalized = explicitCategory?.trim();
  if (normalized) return normalized;

  const prefix = name.split(/[-_]/)[0]?.toLowerCase() ?? "";
  const prefixCategoryMap: Record<string, string> = {
    ai: "AI",
    common: "Common",
    codex: "Codex",
    fe: "Frontend",
    flowops: "FlowOps",
    github: "GitHub",
    himan: "Himan",
    infra: "Infra",
    jira: "Jira",
    openai: "OpenAI",
    qa: "QA",
    space: "Space",
  };
  return prefixCategoryMap[prefix] ?? "General";
}
