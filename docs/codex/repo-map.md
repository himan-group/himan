# Repository Map

## Overview

`@hi-man/himan` is an ESM TypeScript CLI for managing prompt and agent assets. It manages `rule`, `command`, and `skill` resources from a Git-backed source, installs them into project-specific or user-level agent folders, supports in-place project development, publishes semver-tagged versions, and keeps a `himan.lock` for reproducible project installs.

The npm package exposes four binaries:

- `himan` -> `dist/bin/himan.js`
- `himan-source` -> `dist/bin/himan-source.js`
- `himan-resource` -> `dist/bin/himan-resource.js`
- `himan-project` -> `dist/bin/himan-project.js`

## Commands

- `pnpm install` - install dependencies with pnpm 10.32.1.
- `pnpm cli <subcommand>` - run the main CLI from `src/bin/himan.ts` through `tsx`.
- `pnpm run build` - compile TypeScript from `src/` to `dist/`.
- `pnpm run typecheck` - run `tsc -p tsconfig.json --noEmit`.
- `pnpm test` - run Vitest once.
- `pnpm run test:watch` - run Vitest in watch mode.
- `pnpm run verify` - run typecheck, tests, then build.
- `pnpm run release:dry` - verify and run `npm publish --dry-run`.
- `pnpm run release` - verify and publish to npm.

There is no lint script configured in `package.json`.

Runtime agent configuration commands:

- `himan agent list`
- `himan agent use <agent[,agent]> [--project|--global]`
- `himan agent current`
- `himan agent clear [--project|--global]`

## Source Layout

- `src/bin/` contains executable entry files and the shared `runCliMain` wrapper.
- `src/cli/` builds commander programs, command groups, command registration, and CLI error formatting.
- `src/services/index.ts` contains `ServiceFactory`, the main application orchestration layer.
- `src/domain/` contains resource types and data contracts.
- `src/adapters/source/` defines the source adapter interface plus Git and reserved Registry adapters.
- `src/adapters/git/` wraps Git operations through `simple-git`.
- `src/adapters/resource/` scans resource metadata from source repositories.
- `src/adapters/version/` handles semver selection and bumps.
- `src/state/` manages global `~/.himan` config/cache, project default config, and project `himan.lock`.
- `src/utils/` contains path, repo id, agent config, version, and error helpers.
- `tests/` mirrors major units and includes a CLI integration suite with temporary Git remotes and homes.
- `docs/` contains product and implementation notes for MVP, v1.0, global source behavior, blueprints, and error codes.

## Entry Points And Routing

`src/bin/himan.ts` builds the main grouped CLI through `buildCli()`. The main CLI exposes:

- Top-level `init`
- `source init|add|use|list|init-docs|clone|sync`
- `resource list|history|create|rename`; `rename` is currently marked not recommended; `resource list` without a type groups all source resources, `--brief` hides descriptions, and `--installed` lists current project installs instead of source resources
- `project list|install|dev|uninstall|publish`
- `agent list|use|current|clear`
- Backward-compatible top-level resource/project lifecycle commands

Dedicated binaries call the same builders:

- `src/bin/himan-source.ts` -> source commands
- `src/bin/himan-resource.ts` -> resource commands plus backward-compatible project commands
- `src/bin/himan-project.ts` -> project commands

Commander output is centralized in `src/cli/shared.ts` and `src/bin/shared.ts`. Business actions use `runAction()` so `HimanError` and Commander errors are formatted consistently. Commands with `--json` return structured error payloads on `stderr`.

## API And Data

The project has no HTTP API. It integrates with local Git repositories and filesystem state.

- Global state lives under `~/.himan`.
- Source repositories are cached under `~/.himan/repos/<repoId>`.
- Versioned installed resources are stored under `~/.himan/store/<type>/<name>/<version>/`.
- Source config is stored in `~/.himan/config.json`.
- Global default agents are stored in `~/.himan/config.json`.
- Resource list cache is stored in `~/.himan/index.json`.
- Project lock state is stored in `<project>/himan.lock`; no-argument `install` restores from the source recorded in the lock, not from the current default source.
- Project default agents are stored in `<project>/.himan/config.json`.
- `create` and `dev` edit resources in the current project's agent target folders, such as `.agents/skills/<name>` for Codex. Legacy `.himan/dev/<type>/<name>` folders are still recognized as publish sources and cleaned up after publish.
- Project-installed resources are materialized under agent folders such as `.cursor/rules/<name>`, `.agents/skills/<name>` for Codex, `.claude/commands/<name>`, and `.openclaw/...`; install mode controls whether each target is a symlink or a copy.
- `install <type> <name[@version]> --global` materializes the resource under the matching user-level agent folder below home, such as `~/.cursor/rules/<name>`, `~/.agents/skills/<name>` for Codex, `~/.claude/commands/<name>`, and `~/.openclaw/...`. Global installs prefer `--agent`, then the current project's lock entry for that resource, then the default install agent resolution, and do not write `<project>/himan.lock`.

Resource source layout uses plural type directories in the source repo:

- `README.md` is the recommended source-level entry document for resource index, usage examples, default agent policy, and maintenance notes.
- `CHANGELOG.md` is the recommended source-level change history for added, changed, deprecated, and removed resources.
- `rules/<name>/himan.yaml` is recommended metadata; without it, publish and docs use `content.md` as the default entry.
- `commands/<name>/himan.yaml` is recommended metadata; without it, publish and docs use `content.md` as the default entry.
- `skills/<name>/himan.yaml` is recommended metadata; without it, publish and docs use `SKILL.md` as the default entry. Newly scaffolded skill metadata includes `analysis` with static content token estimates, a content hash, empty dependency lists, and generation metadata for hooks/log analysis.

Git tags use `<type>/<name>@<semver>`, for example `rule/code-review@1.0.0`.

`himan source init-docs` scaffolds source-level `README.md` and `CHANGELOG.md` in the current default Git source cache, then commits and pushes when files changed. It preserves existing files by default, supports `--force`, `--dry-run`, and `--json`, and does not change agent install targets. With `--force`, generated docs scan existing `rule`, `command`, and `skill` resources into the README index and CHANGELOG initial entries; resource refs prefer the latest semver Git tag, falling back to `himan.yaml` `version`; when `himan.yaml` is absent, docs generation indexes resources by default entry and reads `SKILL.md` front matter for skill descriptions. `himan source clone` copies a Git source branch plus Himan-managed resource tags into an empty target Git repository; `himan source sync` writes the latest resource snapshots into one target commit and creates the corresponding latest resource tags.

`create` writes a scaffold into the current project agent target folder for direct validation. `publish` uses legacy `.himan/dev` first, then current project agent target folders, then the source repo resource directory; it updates the source-level README resource index between `<!-- himan:resources:start -->` / `<!-- himan:resources:end -->` markers and appends `[Unreleased]` changelog entries. `publish` validates `himan.yaml` when present, but missing metadata is allowed when the default entry file exists; if the resource content matches the latest published version, publish stops with `E_PUBLISH_NO_CHANGES` before changing docs, tags, store, or lock state. After publish, the published version is installed from the new store version in copy mode. The default install target is the current project with `himan.lock` updated; `publish --global` installs to user-level agent folders without writing the project lock. `rename` is currently marked not recommended; it moves the source resource directory, updates metadata names, updates source-level docs, preserves old tags, creates a new latest-version tag when old history exists, and by default migrates the current project's install targets, legacy dev copy, and `himan.lock` entry.

## UI And Components

Not applicable. This is a Node CLI package with no frontend UI.

## Shared Modules

There is no monorepo package sharing. Shared behavior is local to `src/`:

- CLI builders and command helpers in `src/cli/`
- Domain contracts in `src/domain/resource.ts`
- State persistence in `src/state/`
- Source, Git, resource, and version adapters in `src/adapters/`
- Cross-cutting helpers in `src/utils/`

## Generated Files

- `dist/` is generated by `pnpm run build` from `src/` and is ignored by git. Do not edit it by hand.
- `node_modules/`, coverage output, caches, logs, and package tarballs are ignored.
- `pnpm-lock.yaml` is a source-controlled dependency lockfile and should change only with dependency updates.
- `himan.lock` is generated in consuming projects by install flows; this repository does not currently have one.

## Project Rules

- The codebase uses TypeScript `strict` mode with `module` and `moduleResolution` set to `NodeNext`.
- Because the package is ESM, source imports include `.js` extensions even when importing `.ts` source files.
- Keep bin files thin; command registration belongs in `src/cli/`, orchestration in `src/services/`, and Git/filesystem details in adapters or state stores.
- Resource types are limited to `rule`, `command`, and `skill`.
- Supported agent configs are `cursor`, `claude-code`, `codex`, and `openclaw`; aliases and base directories are normalized in `src/utils/agent-configs.ts`.
- Default agents are configured with `himan agent use`; project config takes precedence over global config.
- Business errors should use `HimanError` and stable `errorCodes` from `src/utils/errors.ts`.
- Registry source is reserved and intentionally returns `E_NOT_IMPLEMENTED`.
- Version bumps use semver through `VersionResolver`.
- Tests use Vitest, `node:fs` temp directories, mocked homes, and local Git repositories for CLI integration.
- User-visible CLI behavior changes, new commands/options, output changes, and install/publish workflow changes should update `CHANGELOG.md` under `[Unreleased]`.

## Validation Notes

- For documentation-only changes, no code validation is usually required beyond file review.
- For TypeScript changes, run `pnpm run typecheck` or `pnpm run verify` depending on scope.
- For CLI behavior changes, run `pnpm test`; the integration test builds `dist/` in `beforeAll`.
- Before release, run `pnpm run verify`.
- GitHub Actions verify PRs into `master` with typecheck, tests, and build; publish to npm on `master` through npm Trusted Publishing/OIDC; check that `v{package.version}` does not already exist for PRs into `master`; and create/push `v{package.version}` tags after pushes to `master`.
