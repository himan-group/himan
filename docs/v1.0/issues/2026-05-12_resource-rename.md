# Resource Rename

Date: 2026-05-12

Status: implemented, but not recommended for general use yet.

## Goal

- Add a first-class ability to rename a `rule`, `command`, or `skill` resource.
- Treat resource names as part of resource identity, because directory paths, metadata, Git tags, local store paths, lock entries, and agent install targets all depend on the name.
- Preserve already published versions under the old name so existing `himan.lock` files remain reproducible.

## Scope

In scope:

- Add CLI commands:
  - `himan resource rename <type> <old-name> <new-name> [--dry-run] [--json] [--no-project]`
  - Backward-compatible top-level alias: `himan rename <type> <old-name> <new-name> ...`
- Support resource types `rule`, `command`, and `skill`.
- Rename the resource in the current default source.
- Update source-level `README.md` resource index and `CHANGELOG.md` `[Unreleased]`.
- Update `himan.yaml` `name` when present.
- Update `SKILL.md` front matter `name` for metadata-less skills when it equals the old name.
- Migrate the current project's installed resource paths and `himan.lock` entry by default.

Out of scope:

- Rewriting or deleting old Git tags.
- Rewriting historical versions so `history <new-name>` includes every old-name version.
- Registry source rename support.
- Cross-project lock migration.
- Global install migration under user-level agent directories.

## Existing References

- CLI command registration:
  - `src/cli/resource-commands.ts`
  - `src/cli/project-commands.ts`
  - `src/cli/builders.ts`
- Service orchestration:
  - `src/services/index.ts`
- Source adapter contract and Git implementation:
  - `src/adapters/source/resource-source-adapter.ts`
  - `src/adapters/source/git-source-adapter.ts`
  - `src/adapters/source/registry-source-adapter.ts`
- Resource metadata scanning:
  - `src/adapters/resource/resource-scanner.ts`
- Project lock state:
  - `src/state/project-lock-store.ts`
- Install target path calculation:
  - `src/utils/agent-configs.ts`
- Stable errors:
  - `src/utils/errors.ts`

## Proposed Behavior

### Identity And Versioning

- Rename is a source-level identity move, not a mutation of published history.
- Existing tags such as `skill/old-name@1.2.3` remain untouched.
- If the old resource has published history, the new resource gets a tag at the latest old version, for example `skill/new-name@1.2.3`.
- If the old resource has no published history, only the source working tree is renamed; the next publish creates the first tag for the new name.
- `history old-name` continues to show old tags.
- `history new-name` starts at the rename tag or later publishes.

### Conflict Rules

- `new-name` must be valid kebab-case, using the same validation as `create`.
- `old-name === new-name` fails with `E_INVALID_INPUT`.
- Missing old resource fails with `E_RESOURCE_NOT_FOUND`.
- Existing new resource directory, scanned metadata entry, or matching new-name Git tag fails with `E_RESOURCE_EXISTS`.
- Registry source fails with `E_NOT_IMPLEMENTED`.

### Source Rename

- Move `<type>s/<old-name>` to `<type>s/<new-name>`.
- If `himan.yaml` exists:
  - Update `name` to `new-name`.
  - Preserve `type`, `entry`, `description`, `agents`, `version`, and any other metadata fields.
- If `himan.yaml` is missing and the resource is a skill:
  - If `SKILL.md` front matter has `name: old-name`, update it to `name: new-name`.
  - If no front matter name exists, no metadata edit is required because scanner falls back to the directory name.
- Maintain source docs:
  - README resource index should list the new name only.
  - CHANGELOG should append `- Renamed \`<type>/<old-name>\` to \`<type>/<new-name>\`.`
- Commit and push source changes. If a rename tag is needed, create and push it with the same commit.

### Project Migration

- By default, rename also attempts to migrate the current working directory project.
- If `himan.lock` contains `<type>/<old-name>`:
  - Preserve `agents`, `mode`, and source information.
  - Use the new-name latest-version tag when one is created, so no-argument `himan install` can restore the renamed resource.
  - Rename the lock entry to `<new-name>`.
  - Remove old project agent target paths.
  - Materialize new project agent target paths from the existing installed path or store path.
- If no lock entry exists but old agent target paths exist:
  - Move or rematerialize matching project targets to the new name where possible.
  - Avoid creating a new lock entry unless the old resource was already locked.
- `--no-project` skips install target and lock migration.

## Implementation Plan

1. Extend `src/domain/resource.ts` with `RenameOptions` and `RenameResult`.
2. Extend `ResourceSourceAdapter` with `rename(type, oldName, newName, options)`.
3. Implement `GitSourceAdapter.rename`:
   - Validate old and new source state.
   - Move directories.
   - Update YAML or skill front matter metadata.
   - Maintain source README and CHANGELOG.
   - Commit and push changes.
   - Create new-name latest-version tag only when old history exists.
4. Implement `RegistrySourceAdapter.rename` as `E_NOT_IMPLEMENTED`.
5. Add `ServiceFactory.rename`:
   - Validate names and type.
   - Call source adapter rename.
   - Migrate current project state unless `--no-project` is set.
6. Add `ProjectLockStore.renameResource` to update lock entries atomically.
7. Register CLI commands in `resource-commands.ts` and top-level builders.
8. Update README, `docs/codex/repo-map.md`, and changelog when implementation lands.

## Acceptance Criteria

- `himan resource rename skill old-name new-name` succeeds for an existing skill.
- `himan rename skill old-name new-name` behaves the same as the grouped command.
- `himan list skill` shows `new-name` and no longer shows `old-name`.
- `himan.yaml` or `SKILL.md` front matter reflects `new-name` when applicable.
- Source README resource index and CHANGELOG are updated.
- For a previously published resource, the old tag remains and the new latest-version tag exists.
- Current project old install target is removed and new install target works.
- Current project `himan.lock` records the new name while preserving agents and mode, and points at a version that exists under the new name.
- `himan install` with no arguments restores the renamed resource from lock.
- Invalid name, missing old resource, and conflicting new resource return stable errors.

## Validation

- Add Git adapter tests for source rename with:
  - `himan.yaml` metadata.
  - Metadata-less skill front matter.
  - existing new-name conflict.
  - published history and rename tag behavior.
- Add CLI integration tests for:
  - grouped command and top-level alias.
  - project lock and install target migration.
  - `--dry-run`, `--json`, and `--no-project`.
- Add service-level tests for lock entry rename behavior.
- Run:
  - `pnpm run typecheck`
  - `pnpm test`
