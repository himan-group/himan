---
name: common-readme-writer
description: Create, evaluate, or rewrite concise README.md files for npm CLI and GitHub projects. Use when Codex needs to improve project positioning, highlight differentiators, simplify onboarding, split long reference content into docs, or apply README best practices to command-line tools, developer tools, plugins, SDKs, and similar open source packages.
---

# common-readme-writer

Use this skill to create or revise a project `README.md` so it works as a project homepage and quick-start guide, not a full manual.

## Workflow

1. Inspect the project before writing:
   - Read `package.json`, existing `README.md`, `docs/`, `CHANGELOG.md`, and local project guidance such as `AGENTS.md`.
   - For CLI projects, identify the install command, binary name, minimum runtime, core commands, supported platforms, and validation workflow.
   - Check whether existing docs already contain command references, architecture details, development setup, errors, FAQ, or examples.
2. Decide the README role:
   - Keep content that helps a new visitor decide whether to use the project.
   - Keep the shortest reliable onboarding path.
   - Move command tables, edge cases, architecture, troubleshooting, release steps, and long examples into dedicated docs.
3. Write the README top-down:
   - Start with a one-sentence positioning statement.
   - Add a short paragraph for target users and scenario.
   - Show concrete differentiators before detailed usage.
   - Put installation and a minimal quick start near the top.
4. Preserve project-specific language:
   - Use the repository's existing product terms.
   - Keep technical terms such as CLI, Git, MCP, Plugin, SDK, API, agent, package, lockfile, and semver when they are standard for the audience.
   - Avoid unnecessary mixed-language phrasing. If a bilingual term is needed, introduce it once as `中文（English）`, then use one term consistently.
5. Update or create supporting docs when needed:
   - Create focused docs such as `docs/user-guide.md`, `docs/command-reference.md`, `docs/development.md`, or `docs/troubleshooting.md`.
   - Add links from README to those docs.
   - Do not leave removed details unreachable if they are still useful.
6. Validate the result:
   - Check Markdown rendering, links, command copyability, and terminology consistency.
   - For documentation-only changes, run lightweight checks such as `git diff --check` when available.
   - If package metadata changes, validate JSON and packaging file lists.

## Recommended README Shape

Use this structure for npm CLI / GitHub developer-tool projects unless the repository already has a stronger convention:

```md
# project-name

One-sentence positioning.

Short scenario paragraph.

## Who It Is For
## Why Use It
## Installation
## Quick Start
## Core Concepts
## Common Workflows
## Project Or Package Structure
## Related Tools
## Supported Features
## Documentation
## Notes
```

Adjust headings to the project's language. Keep the same intent even when translating headings.

## Content Rules

- The first screen should answer: what this is, who it is for, why it is useful, and how to start.
- Prefer concrete differentiators over generic claims. Replace "simple, powerful, efficient" with verifiable capabilities such as "lockfile-based reproducible installs", "multi-agent installation", or "Git-backed review and rollback".
- Keep quick starts executable. Use copyable commands, avoid placeholders unless unavoidable, and explain assumptions before the block.
- Show the happy path first. Put advanced flags, failure modes, and migration details in linked docs.
- Keep command examples short. README examples should teach workflows, not enumerate every option.
- Use tables only when they improve scanning, such as concept definitions or support status.
- Include support status when a feature is partially supported or reserved, especially for CLI tools with multiple backends, agents, providers, or platforms.
- Link to contribution, error-code, command-reference, API, and development docs instead of duplicating them.
- Mention related ecosystem tools only when they clarify the product story. Keep them secondary to the main project.
- Avoid badges, screenshots, banners, or comparison tables unless they communicate meaningful trust or product value.

## Evaluation Checklist

Use this checklist when reviewing an existing README:

- Can a first-time visitor understand the project within 30 seconds?
- Is the target user explicit?
- Are differentiators concrete and relevant to alternatives?
- Can a user install and run the first useful command within a few minutes?
- Are commands current with `package.json` and the CLI implementation?
- Are prerequisites visible before commands that require them?
- Is terminology consistent throughout the document?
- Are long references moved to dedicated docs and linked from README?
- Are unsupported, partial, or reserved features clearly labeled?
- Are npm and GitHub rendering constraints respected, including relative links for repository docs and root-level `README.md` placement?

## Output Expectations

When editing a README, produce the actual file changes. In the final response, summarize:

- The positioning and onboarding changes.
- Which details moved into supporting docs.
- Validation performed and any checks that could not be run.
