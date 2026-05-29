# Repository Guidelines

## Project Snapshot

This repository is `@hi-man/himan`, an ESM TypeScript CLI for prompt and agent asset management. It manages `rule`, `command`, `skill`, and Codex-specific `config` resources from a Git source, installs them into agent-specific project folders, supports local dev mode, publishes semver-tagged versions, and maintains `himan.lock` for reproducible installs.

Use `docs/repository-map.md` for the durable project map.

## Commands

- `pnpm install` installs dependencies. The package manager is `pnpm@10.32.1`; Node is pinned by `.nvmrc` to `22.22.1`.
- `pnpm cli <subcommand>` runs the main CLI from source.
- `pnpm run build` compiles `src/` to `dist/`.
- `pnpm run typecheck` runs TypeScript without emitting files.
- `pnpm test` runs Vitest once.
- `pnpm run verify` runs typecheck, tests, then build.
- `pnpm run release:dry` runs verify plus `npm publish --dry-run`.

There is no lint script in `package.json`.

Runtime CLI commands include `himan init --agent ... --install ...` for quick-start setup, `himan resource archive|restore` for source resource lifecycle management, `himan agent list|use|current|clear` for default agent configuration, and `himan doctor` for local health checks.

## Architecture

- Keep `src/bin/` entry files thin; they should build a CLI and call the shared runner.
- Put commander setup and command registration in `src/cli/`.
- Keep lifecycle orchestration in `src/services/index.ts`.
- Put Git, source, resource scanning, and version-specific mechanics in `src/adapters/`.
- Put persistent local state in `src/state/`.
- Put cross-cutting helpers and stable error codes in `src/utils/`.

The package is ESM with `moduleResolution: NodeNext`, so TypeScript source imports use `.js` extensions.

## Coding Workflow

- Before nontrivial edits, inspect adjacent implementations and follow existing layering.
- Preserve the CLI error pattern: business failures should use `HimanError` with `errorCodes`; command actions should run through `runAction()`.
- Do not introduce new request layers, state systems, or command frameworks unless the existing architecture changes intentionally.
- Keep resource type handling aligned with `rule`, `command`, `skill`, and Codex-specific `config`.
- Default agent resolution is project config, then global config, then resource metadata or `cursor`.
- Treat Registry source behavior as reserved unless the task explicitly implements it.

## Entry Points And Routing

The main CLI is built by `buildCli()` and exposes `source`, `resource`, `project`, `agent`, and `doctor` commands plus backward-compatible top-level lifecycle commands. Dedicated binaries reuse the same builders for source, resource, and project command subsets.

## API And Data

There is no HTTP API. The CLI works with Git and filesystem state:

- `~/.himan/config.json` stores source config.
- `~/.himan/config.json` can also store global default agents.
- `~/.himan/repos/` stores cached Git sources.
- `~/.himan/store/<type>/<name>/<version>/` stores immutable resource snapshots.
- `~/.himan/index.json` caches scanned source metadata.
- `<project>/himan.lock` records installed resources.
- `<project>/.himan/config.json` stores project default agents.
- `<project>/.himan/dev/<type>/<name>` stores editable dev copies.
- Source-level archived resources live under `archive/rules`, `archive/commands`, and `archive/skills`; default source lists and sync ignore them unless explicitly requested.
- Installed resources are materialized under agent folders such as `.cursor`, `.claude`, `.agents`, `.codex`, or `.openclaw`; install mode controls whether targets are symlinks or copies.
- Codex-specific: `config` resources materialize under `.codex/configs/<name>` and synchronize `.codex/config.toml`.

## Generated Files

- `dist/` is build output from `pnpm run build` and is ignored by git; do not edit it manually.
- `node_modules/`, coverage output, caches, logs, and tarballs are ignored.
- `pnpm-lock.yaml` is source-controlled and should change only with dependency changes.

## Validation

- Documentation-only changes can usually be validated by inspection.
- TypeScript changes should run `pnpm run typecheck`; broader or release-sensitive changes should run `pnpm run verify`.
- CLI behavior changes should include or update Vitest coverage and run `pnpm test`.
- Release work should use the package scripts rather than raw publish commands.

## Agent-Specific Notes

- Codex-specific: Codex project skills live under `.agents/skills/`; resource authoring and installs may also use `.codex` for rules and configs.
- Cursor-specific rules, Claude Code instructions, GitHub Copilot instructions, Gemini files, or OpenHands microagents should be kept in their conventional dedicated files only when this repository adds those files intentionally.

## Codex-Specific Skill Routing

- Use `common-project-startup` when refreshing project maps or repository agent guidance.
- Use `common-issue-spec` when a request needs scope, assumptions, acceptance criteria, or validation clarified before coding.
- Use `common-dev-pattern` for nontrivial code edits and validation.
- Use `common-project-changelog` for user-visible CLI behavior changes, new commands/options, direct `CHANGELOG.md` edits, package version bumps, release notes, or changelog placement fixes.
