# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

See `AGENTS.md` for project-wide guidelines (build commands, architecture, coding workflow, entry points, data layout, validation). This file covers only Claude Code-specific additions.

## Claude Code Agent Directory

Installed resources are materialized under `.claude/`:
- rules → `.claude/rules/<name>/`
- commands → `.claude/commands/<name>/`
- skills → `.claude/skills/<name>/`

## Skills

This repository maintains skills under `.agents/skills/` (Codex directory). Claude Code should discover and use skill definitions from both locations:

- `.claude/skills/<name>/SKILL.md` — Claude-native skill directory
- `.agents/skills/<name>/SKILL.md` — shared skills (same content, managed by himan)

Before starting a non-trivial task, list the available skills:

```bash
ls .agents/skills/
```

Then read the relevant `SKILL.md` files to follow the prescribed workflows. Key skills include:

| Skill | When to use |
|-------|-------------|
| `himan-resource-manage` | Creating, editing, or publishing himan resources |
| `common-project-changelog` | Updating CHANGELOG.md or bumping versions |
| `common-dev-pattern` | Non-trivial code edits and validation |
| `common-issue-spec` | Scoping issues with assumptions and acceptance criteria |
| `common-project-startup` | Refreshing project maps or repository agent guidance |

## Imports

This is an ESM package (`"type": "module"`) with `moduleResolution: "NodeNext"`. TypeScript source imports must use `.js` extensions (e.g. `import { foo } from "./bar.js"`).

## Testing

```bash
pnpm test                                          # Run all Vitest tests
pnpm test -- tests/utils/repo-id.test.ts           # Run a single test file
```
