# Changelog

All notable changes to this project are documented in this file.

The format is based on Keep a Changelog, and this project follows semver for the npm package version.

## [Unreleased]

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
