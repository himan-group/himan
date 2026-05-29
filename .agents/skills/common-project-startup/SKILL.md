---
name: common-project-startup
description: Onboard Codex to an existing repository by inspecting structure, commands, rules, generated files, and validation workflow; create or update docs/repository-map.md or legacy docs/codex/repo-map.md plus AGENTS.md. Use when starting work in an unfamiliar project, refreshing project guidance, or syncing local rules into Codex instructions.
---

# common-project-startup

Use this skill when Codex needs durable project understanding before broad or repeated work in a repository.

## Inspect

Read only the files needed to map the project:

- Build manifests and lockfiles: `package.json`, `pyproject.toml`, `go.mod`, `Cargo.toml`, `pom.xml`, lockfiles
- Release/history files: `CHANGELOG.md`, release notes, package version scripts
- Existing guidance: `AGENTS.md`, `.cursor/rules/**/*.mdc`, `docs/repository-map.md`, legacy `docs/codex/repo-map.md`, relevant local docs
- Source roots and entry points: `src/`, `app/`, `lib/`, `packages/`, `services/`, `server/`, `client/`, `tests/`
- APIs and data: clients, schemas, generated clients, migrations, models, fixtures
- Tooling: type, lint, format, test, bundler, framework, Docker, CI, deployment config

Skip vendored dependencies, build output, caches, coverage, `.git/`, and large generated files unless directly relevant.

## Documentation Standards

Generated `AGENTS.md` and repository map docs should read like normal repository documentation:

- Use factual, stable headings and concise prose.
- Separate observed repository facts from agent workflow guidance.
- Prefer standard engineering terms such as commands, source layout, entry points, generated files, validation, and release notes.
- Do not invent policy, ownership, or architecture that is not visible in the repository.
- Mark Codex-specific content explicitly with wording such as `Codex-specific:` or a section title like `## Codex-Specific Notes`.
- Keep broadly useful repository information unbranded so non-Codex contributors can still use it.

## Repository Map

Use `docs/repository-map.md` as the default repository map path for new or migrated docs. `docs/codex/repo-map.md` is a legacy Codex-specific location; keep it compatible when it already exists.

Path rules:

- If `docs/repository-map.md` exists, read and update it as the canonical map.
- If only `docs/codex/repo-map.md` exists, read it for compatibility and ask the user whether to migrate it to `docs/repository-map.md` before changing paths.
- If the user enables the new `docs/repository-map.md` path, move or recreate the map there and delete the legacy `docs/codex/repo-map.md` file so there is only one canonical map.
- If both paths exist, read both, treat `docs/repository-map.md` as canonical, and mention that `docs/codex/repo-map.md` is legacy if the difference matters.
- If no map exists and one is needed, create `docs/repository-map.md`.

Keep the map factual and concise:

```md
# Repository Map

## Overview
...

## Commands
...

## Source Layout
...

## Entry Points And Routing
...

## API And Data
...

## UI And Components
...

## Shared Modules
...

## Generated Files
...

## Project Rules
...

## Codex-Specific Notes
...

## Validation Notes
...
```

Record what exists; do not prescribe a new architecture. Prefer representative paths over exhaustive file lists. Include exact commands from manifests or docs.
Use `Codex-Specific Notes` only for agent workflow details; omit it when there is no Codex-only guidance.

## AGENTS.md

Create or update repository-root `AGENTS.md` when Codex instructions should be persisted. Prefer this structure and omit sections that do not apply:

```md
# Repository Agent Instructions

## Project Snapshot
...

## Commands
...

## Architecture
...

## Coding Workflow
...

## Entry Points And Routing
...

## API And Data
...

## UI And Component Conventions
...

## Generated Files
...

## Validation
...

## Codex-Specific Skill Routing
...
```

Preserve user-maintained content. If manual notes are needed, keep them under:

```md
<!-- codex:manual-start -->
...
<!-- codex:manual-end -->
```

## Rules

- Convert local rules into short Codex instructions instead of copying them wholesale.
- Mention generated or derived files and how they are produced when the repository makes that clear.
- Mention conventions only when they are visible in the repository.
- Route vague work to `common-issue-spec` and code-change work to `common-dev-pattern`.
- For projects with a CLI, package version, public API, release workflow, or user-visible behavior, check for release notes and `CHANGELOG.md`.
  - If `CHANGELOG.md` or equivalent release notes already exist, record the update rule in `AGENTS.md` and route release-note work to `common-project-changelog`.
  - If the repository is being newly initialized, create a Keep a Changelog style `CHANGELOG.md` when release notes are relevant.
  - If the repository is an established/legacy project and no changelog exists, do not create one by default; mention the absence only when it affects the current work.
- Do not include secrets, tokens, private URLs beyond what already exists in committed project files.
