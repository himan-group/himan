# Repository Map

## Overview

`@hi-man/himan` is an ESM TypeScript CLI for managing prompt and agent assets. It manages `rule`, `command`, `skill`, and Codex-specific `config` resources from a Git-backed source, installs them into project-specific or user-level agent folders, supports in-place project development, publishes semver-tagged versions, and keeps a `himan.lock` for reproducible project installs.

The npm package exposes a single binary:

- `himan` -> `dist/bin/himan.js`

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
- `himan agent use <agent[,agent]> [--project|-g|--global]`
- `himan agent current`
- `himan agent clear [--project|-g|--global]`

## Source Layout

- `src/bin/` contains the executable entry file and the shared `runCliMain` wrapper.
- `src/cli/` builds commander programs, command groups, command registration, and CLI error formatting.
- `src/services/index.ts` contains `ServiceFactory`, the main application orchestration layer.
- `src/domain/` contains resource types, doctor result types, and data contracts.
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

- Top-level `setup` (legacy alias `init`), including optional `--agent`, `--install type/name[@version],...`, `--mode`, and `--json` quick-start setup; `himan system setup` is the grouped form
- Top-level `doctor [--json]`, equivalent to `himan system doctor`
- `repo add|alias|rename|use|list|init-docs|clone|sync`, with `source` kept as a compatibility alias; `repo rename` changes the local config name and may also update alias with `--alias`, including for the current source; `repo use` switches by source name or alias, and can set the target alias with `--alias`; old current sources without aliases must still be aliased before switching away; `repo list` marks the selected source as `(current)`
- `system setup|doctor|audit stats|list|issues`; `migrate` and `cleanup` are planned for the `system` group
- `resource list|history|create|comment|dev|publish|archive|restore|rename`; `rename` is currently marked not recommended; `resource list` without a type groups all active source resources, sorts resources within each category by descending `comment.score` with unrated resources last, `--source` selects a source alias for source lists, `--brief` hides descriptions, `--comment` shows comment text, `--archived` lists archived resources, and `--include-archived` includes archived resources; `resource list --installed` is deprecated in favor of `project list`; `resource publish` can use `--source <alias>`
- `project list|install|uninstall`; direct installs require `--include-archived` for archived resources, can use `--source <alias>` for explicit source selection, and support `install skill <name[@version]> -r [--depth <n>]` for skill dependency installs declared in `himan.yaml` (default depth `1` when `-r/--recursive` is present); lock-file installs can restore archived resources already recorded in `himan.lock`; `uninstall -g` removes user-level global install targets without changing project lock
- `agent list|use|current|clear`
- Backward-compatible top-level resource/project lifecycle commands

Commander output is centralized in `src/cli/shared.ts` and `src/bin/shared.ts`. Business actions use `runAction()` so `HimanError` and Commander errors are formatted consistently. Commands with `--json` return structured error payloads on `stderr`.

## API And Data

The project has no HTTP API. It integrates with local Git repositories and filesystem state.

- Global state lives under `~/.himan`.
- Source repositories are cached under `~/.himan/repos/<repoId>`.
- Versioned installed resources are stored under `~/.himan/store/<type>/<name>/<version>/`.
- Machine-level install registry lives at `~/.himan/installed.json`; it records project and global installs (scope, projectDir, agent, type/name/version, source, mode, targetPath, updatedAt) and is the authoritative source for `system audit` managed/drifted classification and global versions. Project `himan.lock` remains the commit-friendly reproducible project manifest.
- Source config is stored in `~/.himan/config.json`; source item keys are local config names, while optional `alias` values are the user-facing references accepted by `source use` and resource `--source` options.
- Global default agents are stored in `~/.himan/config.json`.
- Resource list cache is stored in `~/.himan/index.json`.
- Project lock state is stored in `<project>/himan.lock`; no-argument `install` restores each resource from its recorded lock source, not from the current default source. The top-level lock `source` is the default for resources without an explicit source, while additional named sources are stored under `sources` and referenced by `resources[].source`.
- Project default agents are stored in `<project>/.himan/config.json`.
- `create` and `dev` edit resources in the current project's agent target folders. Codex-specific canonical paths are `.codex/rules/<name>`, `.agents/commands/<name>`, `.agents/skills/<name>`, and `.codex/configs/<name>`. `.codex/config.toml` is kept synchronized to the active installed config. Legacy `.himan/dev/<type>/<name>` folders are still recognized as publish sources and cleaned up after publish.
- Project-installed resources are materialized under agent folders such as `.cursor/rules/<name>`, `.claude/commands/<name>`, and `.openclaw/...`; Codex-specific installs use `.codex/rules/<name>` for rules, `.agents/skills/<name>` for skills, and `.codex/configs/<name>` for config resources. Install mode controls whether each target is a symlink or a copy.
- `install <type> <name[@version]> -g` / `--global` materializes the resource under the matching user-level agent folder below home, such as `~/.cursor/rules/<name>`, `~/.claude/commands/<name>`, and `~/.openclaw/...`. Codex-specific global installs use `~/.codex/rules/<name>` for rules, `~/.agents/skills/<name>` for skills, and `~/.codex/configs/<name>` plus `~/.codex/config.toml` for config resources. Global installs prefer `--agent`, then the current project's lock entry for that resource, then the default install agent resolution, and do not write `<project>/himan.lock`.
- Source-level archived resources are stored under `archive/rules/<name>`, `archive/commands/<name>`, and `archive/skills/<name>` in the Git source. They are omitted from default source lists, README resource indexes, and source sync active snapshots unless a command explicitly asks for archived resources.
- `doctor` checks Node.js, Git, Himan home directories, current source configuration, source resource scanning, effective agent settings, project lock state, archived lock references, and materialized project install targets; it exits non-zero when any check has `error` status.

Resource source layout uses plural type directories in the source repo:

- `README.md` is the recommended source-level entry document for resource index, usage examples, default agent policy, and maintenance notes.
- `CHANGELOG.md` is the recommended source-level change history for added, changed, deprecated, and removed resources.
- `rules/<name>/himan.yaml` is recommended metadata; without it, publish and docs use `content.md` as the default entry.
- `commands/<name>/himan.yaml` is recommended metadata; without it, publish and docs use `content.md` as the default entry.
- `skills/<name>/himan.yaml` is recommended metadata; without it, publish and docs use `SKILL.md` as the default entry. Newly scaffolded skill metadata includes `analysis` with static content token estimates, a content hash, empty dependency lists, and generation metadata for hooks/log analysis.
- Resource metadata may include `comment.score` from 1 to 10 and optional `comment.text` capped at 64 words or Chinese characters, managed by `himan comment` / `himan resource comment` and shown in source lists/README indexes.
- `archive/<plural>/<name>/himan.yaml` may include `archived`, `archivedAt`, and `archiveReason` metadata written by `himan resource archive`.

Git tags use `<type>/<name>@<semver>`, for example `rule/code-review@1.0.0`.

`himan repo init-docs` scaffolds source-level `README.md` and `CHANGELOG.md` in the current default Git source cache, then commits and pushes when files changed. It preserves existing files by default, supports `--source <alias>`, `--force`, `--repair-history`, `--dry-run`, and `--json`, and does not change agent install targets. With `--force`, generated docs scan existing `rule`, `command`, `skill`, and `config` resources into the README index and CHANGELOG initial entries, and also write a managed `Use With Himan` section with the `@hi-man/himan` npm link plus common source bind, agent setup, list, install/uninstall, publish, and archive commands; resource refs prefer the latest semver Git tag, falling back to `himan.yaml` `version`; when `himan.yaml` is absent, docs generation indexes resources by default entry and reads `SKILL.md` front matter for skill descriptions. With `--repair-history`, it repairs managed historical data in existing docs: rebuilds README managed sections and migrates historical publish entries from source CHANGELOG `[Unreleased]` into date release headings based on matching resource tag dates. `himan repo clone` copies a Git source branch plus Himan-managed resource tags into an empty target Git repository; `himan repo sync` writes the latest resource snapshots into one target commit and creates the corresponding latest resource tags.

`create` writes a scaffold into the current project agent target folder for direct validation. `publish` uses legacy `.himan/dev` first, then current project agent target folders, then the selected source repo resource directory; it refuses archived resources until they are restored, updates the source-level README managed sections, including the category-grouped resource index between `<!-- himan:resources:start -->` / `<!-- himan:resources:end -->` and the managed `Use With Himan` guide block, keeps unreleased source edits under `## [Unreleased]`, and records publish entries under date release headings like `## [2026-05-19]`. `publish --source <alias>` selects a non-default source by alias. Batch forms are handled by the same command: `publish --all`, `publish <type> --all`, and `publish <type> a,b,c`; when naming multiple resources explicitly, pass them as one comma-separated argument such as `publish skill skill-a,skill-c`. `publish` validates `himan.yaml` when present, but missing metadata is allowed when the default entry file exists; if the resource content matches the latest published version, single-resource publish stops with `E_PUBLISH_NO_CHANGES`, while batch publish records that resource as skipped and continues. After publish, the published version is installed from the new store version in copy mode. The default install target is the current project with `himan.lock` updated; `publish -g` / `publish --global` installs to user-level agent folders without writing the project lock. `archive` moves active source resources into `archive/<plural>/<name>`, optionally writes archive metadata, updates source docs, and does not delete existing tags, store snapshots, or project installs. `restore` moves archived resources back into active type directories and removes archive metadata. `rename` is currently marked not recommended; it moves the source resource directory, updates metadata names, updates source-level docs, preserves old tags, creates a new latest-version tag when old history exists, and by default migrates the current project's install targets, legacy dev copy, and `himan.lock` entry.

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
- Resource types are `rule`, `command`, `skill`, and `config`; Codex-specific `config` resources are currently implemented only for Codex, with Cursor and Claude Code config management reserved for future work.
- Supported agent configs are `cursor`, `claude-code`, `codex`, and `openclaw`; aliases and base directories are normalized in `src/utils/agent-configs.ts`.
- Default agents are configured with `himan agent use`; project config takes precedence over global config.
- `himan system setup --agent <agent[,agent]>` writes the current project default agent, and `himan system setup --install <type/name[@version],...>` installs selected resources after source initialization; `himan init` remains as a legacy alias.
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
- GitHub Actions verify PRs into `dev` or `master` with typecheck, tests, and build; publish to npm on `master` through npm Trusted Publishing/OIDC; check that `v{package.version}` does not already exist for PRs into `master`; and create/push `v{package.version}` tags after pushes to `master`.
