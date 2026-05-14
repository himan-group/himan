---
name: himan-skill-metadata
description: Create or update Himan skill metadata. Use when Codex creates, edits, migrates, or audits a skill folder with SKILL.md and should also generate or refresh a matching himan.yaml file containing static analysis metadata such as content token estimates, hashes, dependencies, scripts, MCP tools, and generation details.
---

# Himan Skill Metadata

Use this skill when a task creates or updates a Himan/Codex skill. The output skill folder should contain both `SKILL.md` and `himan.yaml`.

## Workflow

1. Finish `SKILL.md` first, including front matter `name` and `description`.
2. Identify static dependencies:
   - Other skills the instructions require or recommend.
   - Scripts bundled under `scripts/`.
   - MCP tools the skill explicitly tells Codex to use.
3. Generate or update `himan.yaml` with `type: skill`, `entry: SKILL.md`, `agents`, and `analysis`.
4. Re-run metadata generation after any material edit to `SKILL.md`, references, scripts, or dependency declarations.
5. Validate that `himan.yaml.name` matches `SKILL.md` front matter and the folder name.

## Preferred Script

Use the bundled script when possible:

```bash
node scripts/build_himan_yaml.mjs <skill-dir> \
  --agent codex \
  --generated-by codex \
  --measured-by codex \
  --skill common-project-changelog \
  --mcp-tool functions.exec_command
```

The script writes `<skill-dir>/himan.yaml`. It reads `SKILL.md`, estimates static token counts, hashes text package content, detects bundled scripts, records dependencies passed on the command line, and resolves the resource version.

Version resolution order:

1. Explicit `--version`.
2. Nearest project `himan.lock` entry matching `skill/<name>`.
3. Source Git tags matching `skill/<name>@<version>`, when the skill directory is inside `skills/<name>` or `archive/skills/<name>`.
4. Himan store path version when the skill directory is under `store/skill/<name>/<version>`.
5. Existing `<skill-dir>/himan.yaml` `version`.
6. `0.0.1` for a new skill with no known existing version.

If an exact tokenizer is available in the environment, prefer exact token counts and set `analysis.content.tokenizer` to the tokenizer name. Otherwise the script uses `approx-char-v1` with `ceil(chars/4)` and records that estimator explicitly.

## Required Shape

Use this structure for skill metadata:

```yaml
name: example-skill
type: skill
version: 0.0.1
entry: SKILL.md
description: Do the example workflow.
agents:
  - codex
analysis:
  content:
    tokenizer: approx-char-v1
    tokenEstimator: ceil(chars/4)
    entryTokens: 120
    packageTokens: 180
    contentHash: sha256:...
    measuredAt: "2026-05-13T00:00:00.000Z"
    measuredBy: codex
  dependencies:
    skills:
      - common-project-changelog
    scripts:
      - path: scripts/build_himan_yaml.mjs
    mcpTools:
      - functions.exec_command
  generation:
    generatedBy: codex
    generatedAt: "2026-05-13T00:00:00.000Z"
    model: gpt-5
    promptRef: skill-creator
```

## Rules

- Treat `analysis` as static build-time metadata, not runtime telemetry.
- Keep token fields tied to the tokenizer or estimator that produced them.
- Keep `contentHash` based on package text content, excluding `himan.yaml` itself.
- Do not let the new-resource default overwrite an existing skill version; resolve it from lock/source metadata or pass `--version` explicitly.
- Use `0.0.1` only for newly created skill resources with no known existing version, unless the user explicitly requests a different initial version.
- Use `agents: [codex]` for Codex-only skills unless the user asks for another target.
- Do not invent dependencies. Record only dependencies implied by the skill instructions or bundled files.
