# Subagent 资源类型需求规格

Date: 2026-08-25

Status: 需求讨论稿（proposed），未实现，未排期。

## Goal

- 新增 `subagent` 资源类型：把"提示词定义的子代理"作为 himan 可管理的资源，纳入现有生命周期（source 扫描 → store 快照 → 项目/全局安装 → lock/中央登记 → publish/archive/comment）。
- 支持 Codex（TOML）与 Claude Code（Markdown + YAML frontmatter）的已知存放约定；其他 agent 待调研。

## Background And Necessity

- Codex 等 coding agent 支持通过提示词定义 subagent（自定义 agent）。
- 已知存放约定：
  - Codex：`~/.codex/agents/<name>.toml`（用户级）/ `.codex/agents/<name>.toml`（项目级），每个 TOML 文件定义一个自定义 agent。
  - Claude Code：`~/.claude/agents/<name>.md`（用户级）/ `.claude/agents/<name>.md`（项目级），Markdown + YAML frontmatter。
- 现状 subagent 只能手动放置，himan 无法扫描、安装、版本化或清理；与现有 `rule` / `command` / `skill` / `config` 类型并列，需要纳入统一资源模型。

## Scope

In scope:

- 第五种资源类型 `subagent`（类型目录映射 `agents/`）。
- 生命周期复用：source 扫描、store 快照、项目/全局安装、lock/中央登记、publish/archive/comment。
- 单文件资源适配（TOML / MD），安装为文件级而非目录级。
- 元数据解析：Codex TOML、Claude Code YAML frontmatter（YAML 可复用 skill 的 frontmatter 解析模式）。

Out of scope:

- 本规格仅文档，不排期实现。
- Cursor / OpenClaw / Copilot 的存放约定（待调研）；WorkBuddy / deepseek-harness 规划中（待调研）。
- 各 agent 的交互协议、权限模型与运行行为。

## Naming

- 资源类型命名：`subagent` vs `agent`。倾向 `subagent`，避免与现有 `agent` 命令组（默认 agent 配置）混淆。

## Path Mapping（已知）

| Agent | 用户级 | 项目级 | 格式 |
| --- | --- | --- | --- |
| Codex | `~/.codex/agents/<name>.toml` | `.codex/agents/<name>.toml` | TOML |
| Claude Code | `~/.claude/agents/<name>.md` | `.claude/agents/<name>.md` | Markdown + YAML frontmatter |
| Cursor / OpenClaw / Copilot | 待调研 | 待调研 | - |
| WorkBuddy / deepseek-harness（规划中） | 待调研 | 待调研 | - |

## Proposed Behavior

- 扫描：按各 agent 的 `agents/` 目录识别，按格式（TOML / YAML frontmatter）解析名称、描述与元数据；无元数据时按文件名推断。
- 安装：文件级安装（单文件），遵循分场景默认策略（全局 link / 项目 copy）；agent 不支持链接时强制 copy。
- 版本管理：纳入 store 快照与中央安装登记（`installed.json`），与现有类型一致。
- 与 machine audit 的关系：subagent 会被 `system audit` 发现为 unmanaged，可通过 `system migrate` 纳入管理。

## Key Design Decisions (Pending)

1. 类型命名（`subagent` vs `agent`）。
2. 单文件资源在 store 中的组织（如 `store/subagent/<name>/<version>/<file>`）与多 agent 格式并存时的目录结构。
3. frontmatter 解析：YAML 可复用 skill 解析器；TOML 需要新增解析器。
4. link 模式下单文件 symlink 的兼容性（部分 agent 可能不跟随单文件链接）。

## Suggested Phases

- 阶段 A：类型定义、扫描与元数据解析（Codex TOML + Claude Code MD）。
- 阶段 B：create / install / publish 主流程（文件级安装）。
- 阶段 C：archive / restore / comment / 中央安装登记接入。
- 阶段 D：其他 agent（Cursor / OpenClaw / Copilot / WorkBuddy / deepseek-harness）存放约定调研与支持。

## Acceptance Criteria

- Given source 仓库含 `agents/<name>.toml`，When 执行 `resource list subagent`，Then 正确显示名称与元数据。
- Given 安装 subagent 到 codex，Then 项目级目标为 `.codex/agents/<name>.toml`，全局目标为 `~/.codex/agents/<name>.toml`。
- Given 安装 subagent 到 claude-code，Then 项目级目标为 `.claude/agents/<name>.md`，全局目标为 `~/.claude/agents/<name>.md`。
- Given 机器上存在未托管的 subagent 文件，When 执行 `system audit list`，Then 标记为 unmanaged 并给出路径。

## Validation

- 文档阶段：人工审查。
- 实现阶段：`pnpm run typecheck`、`pnpm test`；CLI 行为变更记录到 `CHANGELOG.md` 的 `[Unreleased]`。

## Existing References

- 资源类型定义：`src/domain/resource.ts`
- 资源扫描：`src/adapters/resource/resource-scanner.ts`
- agent 路径映射：`src/utils/agent-configs.ts`
- 服务编排：`src/services/index.ts`
- 关联规格：`docs/v1.0/issues/2026-08-25_system-audit.md`（machine audit / migrate / cleanup）
- 资源支持矩阵：`docs/technical-design/agent-resource-support-matrix.md`

## Open Questions

1. 类型命名（`subagent` vs `agent`）。
2. 其他 agent 的存放约定。
3. 单文件资源是否支持 link 模式。
