---
name: himan-resource-manage
description: Create, edit, validate, and publish Himan rule, command, or skill resources from project agent folders. Use when Codex needs to manage Himan resources with `himan create`, `himan dev`, project/global install target decisions, `himan publish`, lock-file verification, and a required Himan CLI version gate.
---

# Himan Resource Manage

Use this skill to manage Himan resources in the same directories agents consume, then publish them back to the current default Git source.

## Version Gate

Run this gate before any create, dev, publish, or discovery command:

```bash
himan --version
```

Require Himan CLI `0.4.1` or newer. Version `0.4.1` introduced the project-agent-folder create/dev flow this skill relies on.

If `himan` is missing, the version cannot be parsed, or the version is lower than `0.4.1`, stop the workflow. Tell the user:

```text
当前 himan 版本不支持项目目录内的资源 create/dev/publish 流程。请升级到 @hi-man/himan >= 0.4.1 后再继续。
```

Do not run `himan dev`, `himan create`, or `himan publish` after a failed version gate. Older versions may create `.himan/dev` copies or miss the publish/install lock-file behavior expected by this skill.

## Core Model

- Resource types are `rule`, `command`, and `skill`.
- Resource names should be kebab-case.
- `himan create` writes the scaffold into the current project agent target directory, not the source cache.
- `himan dev` edits a project-installed resource in place. If the resource only exists in a user-level global agent directory, `dev` copies it into the current project first.
- `himan publish` uses this source priority:
  1. Legacy `.himan/dev/<type>/<name>` if it exists.
  2. Current project agent target folders such as `.agents/skills/<name>`.
  3. Current default source repo resource folder.
- `himan publish` shows stage logs and installs the published version automatically.
- Publish default install target is the current project and updates `himan.lock`. Use `--global` to install the published version into user-level agent directories without writing the project lock.

## Discovery

Before authoring, establish the local state:

```bash
himan source list
himan agent current
himan project list
```

If the project may be incomplete or newly onboarded, run:

```bash
himan doctor
```

If there is no source configured, initialize one:

```bash
himan init <git_url> --agent <agent>
```

For quick setup with initial installs:

```bash
himan init <git_url> --agent codex --install rule/name,skill/name@1.0.0
```

## Create A New Resource

Use this when the user wants a new reusable resource.

1. Choose type, name, description, and agent targets.
2. Run create:

```bash
himan create <type> <name> --description "<description>" --agent <agent>
```

3. Edit the created project target directory. Common paths:

```text
cursor       -> .cursor/{rules|commands|skills}/<name>
claude-code  -> .claude/{rules|commands|skills}/<name>
codex        -> .agents/{rules|commands|skills}/<name>
openclaw     -> .openclaw/{rules|commands|skills}/<name>
```

4. Validate the resource in the consuming agent/project context when possible.
5. Publish after validation:

```bash
himan publish <type> <name> --patch
```

Use `--minor` or `--major` only when the user asks for that version impact or the change clearly warrants it.

## Edit An Existing Project Resource

Use this when the resource is already installed in the current project.

1. Confirm the installed resource and agents:

```bash
himan project list <type>
```

2. Switch to dev mode:

```bash
himan dev <type> <name>
```

3. If output says `Editing ... in place`, edit the reported project target directory directly.
4. Do not create or edit `.himan/dev` for new work. Treat `.himan/dev` as legacy compatibility only.
5. Publish:

```bash
himan publish <type> <name> --patch
```

After publish, verify the target and lock when this is a project install:

```bash
himan project list <type>
himan history <type> <name>
```

## Edit A Global Resource

Use this when the resource exists only in a user-level agent directory.

1. Run:

```bash
himan dev <type> <name>
```

2. If output says `Copied global ... into current project`, edit the copied current-project target.
3. Before publishing, explicitly tell the user the install target choice:
   - Current project: default, updates `himan.lock`.
   - Global: pass `--global`, does not update current project lock.
4. Publish with the chosen target:

```bash
himan publish <type> <name> --patch
himan publish <type> <name> --patch --global
```

## Publish Expectations

Watch the publish stage logs:

```text
[publish:prepare]
[publish:resolve-version]
[publish:publish-source]
[publish:sync-store]
[publish:install]
[publish:cleanup]
[publish:done]
```

If publish fails with `E_PUBLISH_NO_CHANGES`, do not force a version. Re-check whether the project target actually changed.

If publish succeeds:

- Current project publish: confirm `himan.lock` contains the new version.
- Global publish: confirm the user-level target path was updated.
- Do not manually edit `~/.himan/store`; store snapshots are versioned outputs.

## Avoid

- Do not edit source cache directories directly for normal create/dev work.
- Do not use `.himan/dev` as the default authoring location.
- Do not publish before the user or agent has validated the resource behavior.
- Do not assume `source add` changes the active source; use `himan source use <name>` when needed.
- Do not choose `--global` silently. Remind the user that global publish does not update the project lock.
