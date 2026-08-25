# Changelog

All notable changes to this project are documented in this file.

The format is based on Keep a Changelog, and this project follows semver for the npm package version.

## [Unreleased]

### Added

- Added `himan setup` and `himan system setup` as the environment setup wizard, replacing `himan init`; `himan init` remains as a legacy alias.
- Added the `system` command group with `system setup` and `system doctor`.
- Added the machine-level install registry at `~/.himan/installed.json`, recording project and global installs so global resources can be listed and versioned.
- Added `himan system audit stats|list|issues` for machine-level resource inventory with managed / unmanaged / drifted classification, duplicate and version-drift detection, lock target checks, and orphan store cache reporting.
- Added `himan system migrate <path>` to onboard unmanaged local resources into a private local source (`~/.himan/local-source/`) with generated `himan.yaml` metadata and static analysis, making them installable via `--source local`.

### Changed

- Changed the `source` command group to `repo` (`himan repo ...`); `source` remains as a compatibility alias.
- Moved `doctor` under the `system` command group; `himan doctor` remains as a top-level alias.

### Removed

- Removed the duplicate `himan source init` command; `himan init` is now only available as the legacy top-level alias.

### Deprecated

- Deprecated `himan resource list --installed`; use `himan project list` instead.

## [0.8.8] - 2026-06-09

### Changed

- Changed default source from shopee to himan in `himan.lock`, and removed redundant `sources` block.
- Changed `E_VERSION_NOT_FOUND` error message to include resource type, name, and all available versions, making install failures easier to diagnose.

## [0.8.7] - 2026-06-06

### Changed

- Changed the built-in default agent from `cursor` to `codex`. When no agent is configured (project, global, or resource metadata), `himan` now resolves to `codex` instead of `cursor`. This affects `create`, `install`, and other commands that rely on default agent resolution.

## [0.8.6] - 2026-06-01

### Added

- Added bundled project skills `common-project-blueprint`, `common-project-mvp`, and `common-project-tech-design` to the default local skill set used in this repository.

### Changed

- Changed agent/type validation so `command` resources now reject `copilot` as an install/create target with `E_INVALID_INPUT`, matching documented Copilot support scope.
- Changed Copilot rule instruction sync to write `.github/copilot-instructions.md` in stable alphabetical rule order, reducing non-deterministic diffs across runs.
- Changed runtime and documented Node.js support range to `>=20 <23 || >=24`, and updated `doctor` validation to match.

## [0.8.5] - 2026-05-30

### Added

- Added `copilot` agent support for VS Code Copilot. Rules are concatenated into `.github/copilot-instructions.md`; skills are mapped to `.github/prompts/<name>.prompt.md`. Aliases include `github-copilot` and `vs-code-copilot`.

## [0.8.4] - 2026-05-29

### Changed

- Changed source README scaffolding and publish-time README maintenance so managed docs now include the `@hi-man/himan` npm link plus common commands for source binding, agent setup, resource discovery, install/uninstall, dependency install, publish, and archive/restore workflows.
- Changed skill dependency status output after install so Codex system skills under `~/.codex/skills/.system/<name>` are shown as `system built-in [codex]` instead of `NOT INSTALLED`.
- Changed the generated source README command examples to include short inline usage notes, drop the redundant `source add --alias team` example flag, recommend `coding agent + himan-skill-metadata` instead of `himan create skill` for new skills, and split recursive install examples into separate `-r` and `-r --depth 2` lines.

## [0.8.3] - 2026-05-29

### Changed

- Changed `himan install` skill output to show dependency status after successful installs, including project/global install detection for `-g` and recursive `-r` installs, with missing dependencies highlighted in terminal output.

### Fixed

- Fixed the GitHub Actions verify workflow so PRs into `dev` trigger CI checks again.
- Fixed GitHub Actions setup failures by replacing the external `pnpm/action-setup` action with Corepack-based pnpm activation and removing setup-node pnpm cache initialization before pnpm exists.
- Fixed source publish commits so they work in environments without global Git `user.name` or `user.email` configuration.

## [0.8.2] - 2026-05-26

### Changed

- Changed project `himan.lock` files to support additional named sources through `sources` and per-resource `source` references while keeping the top-level `source` as the default.

## [0.8.1] - 2026-05-26

### Fixed

- Preserved resource `comment.score` and `comment.text` when publishing from older project copies or regenerating Himan skill metadata.
- Prevented `install --source` and `publish --source` from overwriting a non-empty project's `himan.lock` source when the selected source is different.

## [0.8.0] - 2026-05-26

### Added

- Added `himan comment <type> <name> <score> [text...]` and `himan resource comment ...` for storing resource `comment.score` and optional `comment.text`, with list and source README score display.

### Changed

- Streamlined the project README and moved detailed usage and command reference content into dedicated docs.
- Changed resource list and source README resource indexes to sort resources within each category by descending `comment.score`, with unrated resources last.
- Moved grouped `dev` and `publish` commands from `himan project ...` to `himan resource ...` while preserving the top-level `himan dev` and `himan publish` shortcuts.
- Added `-g` / `--global` to `himan uninstall` for removing user-level global install targets without changing project lock.

## [0.7.2] - 2026-05-20

### Changed

- Clarified `himan publish` help and documentation with explicit multi-name examples such as `himan publish skill skill-a,skill-c`.

## [0.7.1] - 2026-05-20

### Removed

- Removed the dedicated npm binaries `himan-source`, `himan-resource`, and `himan-project`; use grouped commands through the `himan` entrypoint instead.

## [0.7.0] - 2026-05-20

### Added

- Added `himan install skill <name[@version]> -r --depth <n>` for recursive skill dependency installs declared in `himan.yaml`, defaulting to one dependency layer when `-r/--recursive` is present, with shared-dependency de-duplication and circular dependency detection.
- Added Codex-only `config` resources with source `configs/<name>/`, project/global install targets at `.codex/configs/<name>` / `~/.codex/configs/<name>`, and automatic activation of the single runtime file `.codex/config.toml`. Cursor and Claude Code config management remain follow-up work.
- Added batch publish support through `himan publish --all`, `himan publish <type> --all`, and `himan publish <type> a,b,c`, with live batch progress logs and skipped handling for `E_PUBLISH_NO_CHANGES`.

### Changed

- Changed Codex rule installs to use `.codex/rules/<name>` as the canonical path while keeping legacy `.agents/rules/<name>` detection, and added a publish-time cleanup prompt when Codex rules or skills are published from legacy paths that differ from the current canonical layout.

## [0.6.2] - 2026-05-19

### Changed

- Changed source-repo changelog updates during `himan publish` so publish entries are written under date release headings like `## [2026-05-19]` instead of accumulating under `## [Unreleased]`.
- Changed source-repo README resource index rendering to category-grouped Markdown sections, where each category has its own `Resource` / `Version` / `Description` table and resource names no longer repeat the type prefix.
- Added `himan source init-docs --repair-history` to repair existing source docs by rebuilding README managed resource indexes and migrating historical changelog entries from `[Unreleased]` into dated release sections.
- Changed source changelog section mapping so first-time `Published type/name@version` entries are recorded under `Added`, subsequent publishes under `Changed`, and archive events under `Removed`.
- Added `himan source init-docs --source <alias>` so source docs can be initialized for a specific configured source without switching the current default source.
- Changed `himan resource list` text output to grouped category tables with separate `Version` column and resource names without repeating `type/` prefixes.
- Fixed source index cache compatibility so resource list can repopulate `version` metadata from `himan.yaml` after upgrading.
- Changed `himan resource list` terminal text output to add subtle color highlighting for type headers, category labels, resource names, and versions (TTY only, respects `NO_COLOR`).

## [0.6.1] - 2026-05-18

### Fixed

- Fixed Codex resource detection so `dev` and `publish` can find skills under `.codex/skills/<name>` (legacy-compatible with `.agents/skills/<name>`).

## [0.6.0] - 2026-05-18

### Added

- Added source aliases with `himan source alias`, `himan source rename`, name-or-alias `source use`, `source use --alias` for one-step target aliasing, and `--source <alias>` selection for source resource listing, history, install, and publish flows.

### Changed

- Changed `source list` to mark the selected source as `(current)` instead of `(default)`.

## [0.5.2] - 2026-05-14

### Added

- Added `-g` as a shorthand for `--global` on `install`, `publish`, `agent use`, and `agent clear`.

### Fixed

- Fixed the `himan-resource-manage` skill to stop create/dev/publish workflows when the local Himan CLI is older than the project-directory resource flow.

## [0.5.1] - 2026-05-14

### Fixed

- Fixed `himan-skill-metadata` version resolution so existing skills use lock/source metadata before falling back to `0.0.1` for new skills.

## [0.5.0] - 2026-05-14

### Added

- Added `himan resource archive` and `himan resource restore` for moving source resources into `archive/<plural>/<name>`, listing archived resources, and explicitly installing archived history with `--include-archived`.
- Added the `himan-resource-manage` skill for creating, editing, validating, and publishing Himan resources from project agent folders.

### Changed

- Changed `himan doctor` to warn when a project lock references resources archived in its recorded source.

## [0.4.1] - 2026-05-14

### Added

- Added `himan doctor` to check local Node/Git availability, Himan home state, current source scanning, effective agents, project lock state, and installed targets.

### Changed

- Changed `create` and `dev` to use current project agent target directories for resource authoring, while `publish` now logs stages and can install the published version either into the current project or globally.
- Changed `himan init` to support quick-start setup with optional `--agent`, `--install type/name[@version],...`, `--mode`, and `--json`.

## [0.4.0] - 2026-05-13

### Added

- Added the `github-npm-publish` skill for reusable GitHub Actions npm release workflow guidance.
- Added `himan resource rename` and top-level `himan rename`, currently marked not recommended, to rename source resources, update metadata/docs, preserve old tags, create a latest-version tag for the new name, and migrate the current project's install targets and lock entry by default.
- Added `himan source clone` and `himan source sync` for cloning Git sources and syncing latest resource snapshots into another Git source.
- Added static `analysis` metadata to newly scaffolded skill `himan.yaml` files and a `himan-skill-metadata` skill for generating matching metadata when agents create skills.

## [0.3.5] - 2026-05-12

### Changed

- Changed the CLI version shortcut from `-V` to `-v`; `--version` remains supported.
- Changed the default install mode to `copy`; pass `--mode link` to install resources as symlinks.

## [0.3.4] - 2026-05-11

### Changed

- Changed project guidance to require changelog updates for user-visible CLI behavior changes.

### Fixed

- Fixed `himan publish` so publishing stops with `E_PUBLISH_NO_CHANGES` when the resource content matches the latest published version.

## [0.3.3] - 2026-05-11

### Added

- Added `himan project list` and `himan list --installed` to show resources recorded in the current project's `himan.lock`.

### Changed

- Changed `himan list` without a resource type to group all source resources by `rule`, `command`, and `skill`.
- Added `himan list --brief` to hide resource descriptions in concise list output.

## [0.3.2] - 2026-05-08

### Added

- Added `himan install <type> <name[@version]> --global` to install a resource into the matching user-level agent directory, reusing the current project's resource agent when available and without writing the project lock file.

## [0.3.1] - 2026-05-07

### Added

- Added the `common-project-changelog` skill to enforce changelog and version history placement rules.
- Added `scripts/release-changelog.mjs` so package version scripts release `[Unreleased]` changelog entries into the new version section.

### Changed

- Changed `himan source init-docs --force` to list existing source resources in generated docs.
- Changed `himan source init-docs` to commit and push generated source docs when files changed.
- Changed generated source docs to show the latest tagged resource version when one exists.
- Changed `himan publish` to allow resources without `himan.yaml` when their default entry file exists.
- Changed resource discovery to infer `rule`, `command`, and `skill` resources from default entry files when `himan.yaml` is absent.
- Changed `himan publish` to reinstall the published version in copy mode, update the lock file, and remove the resource dev directory.
- Changed package version scripts to archive `[Unreleased]` changelog entries after version bumps.

### Fixed

- Fixed `himan source init-docs --force` so existing Codex-style skills with `SKILL.md` front matter are included in generated source docs.

## [0.3.0] - 2026-05-07

### Added

- Added `himan source init-docs` to scaffold source-level `README.md` and `CHANGELOG.md` files.
- Added automatic source-level README/CHANGELOG maintenance for resource create and publish flows.

### Changed

- Documented the recommended Git source repository-level `README.md` and `CHANGELOG.md` convention.

## [0.2.2] - 2026-05-07

### Added

- Added a PR verify workflow that runs typecheck, tests, and build before merging to `master`.

## [0.2.1] - 2026-05-07

### Added

- Added this changelog to make release notes and user-visible changes explicit.
- Added npm package metadata for Node.js engine compatibility and package discovery.
- Added public contributing, security, and code of conduct documents.

### Changed

- Clean `dist` before every build so npm packages cannot include stale generated files.
- Aligned MVP, v1.0, and roadmap docs with current resource type and multi-agent behavior.
- Added publish preflight checks for resource metadata and entry files, with stable publish error codes.
- Restored lock-file installs from the source recorded in `himan.lock` instead of the current default source.
- Updated repository links to `https://github.com/himan-group/himan`.
- Updated Git source refresh to fast-forward clean cached working trees after fetch while preserving dirty local edits.
- Updated list cache invalidation to track `himan.yaml` metadata content instead of parent directory mtimes.
- Moved developer, testing, release, and CI maintenance documentation from README to `docs/development.md`.
- Improved README installation guidance for npm, one-off execution, local development, and CLI entry points.
- Included README-linked user documentation in the npm package and changed GitHub workflow links to repository URLs.

## [0.2.0] - 2026-05-06

### Added

- Added command groups for `source`, `resource`, `project`, and `agent`, while keeping backward-compatible top-level lifecycle commands.
- Added dedicated binaries: `himan-source`, `himan-resource`, and `himan-project`.
- Added default agent configuration commands for project and global scopes.
- Added multi-agent installation targets for `cursor`, `claude-code`, `codex`, and `openclaw`.
- Added `command` and `skill` lifecycle support across create, list, history, install, dev, publish, and uninstall flows.
- Added project `himan.lock` support for reproducible installs.
- Added copy install mode in addition to symlink mode.
- Added local index cache support for resource listing.
- Added repository guidance files for Codex workflows.

### Changed

- Split CLI registration into source, resource, project, agent, and shared command modules.
- Expanded README and planning docs to reflect multi-type resources, lock behavior, multi-agent targets, and source management.

## [0.1.0] - 2026-04-08

### Added

- Initial Git-backed CLI for managing prompt and agent assets.
- Added source initialization, resource listing, history, install, dev, publish, create, and uninstall workflows.
- Added resource metadata scanning from `himan.yaml`.
- Added semver tag-based resource versioning.
- Added local store, repo cache, config, and index state foundations.
- Added npm publishing and version tag GitHub Actions workflows.
- Added Vitest coverage for adapters, state, utilities, and CLI integration paths.
