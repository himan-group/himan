# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

See `AGENTS.md` for project-wide guidelines (build commands, architecture, coding workflow, entry points, data layout, validation). This file covers only Claude Code-specific additions.

## Claude Code Agent Directory

Installed resources are materialized under `.claude/`:
- rules → `.claude/rules/<name>/`
- commands → `.claude/commands/<name>/`
- skills → `.claude/skills/<name>/`

## Imports

This is an ESM package (`"type": "module"`) with `moduleResolution: "NodeNext"`. TypeScript source imports must use `.js` extensions (e.g. `import { foo } from "./bar.js"`).

## Testing

```bash
pnpm test                                          # Run all Vitest tests
pnpm test -- tests/utils/repo-id.test.ts           # Run a single test file
```
