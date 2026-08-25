# AI Coding Agent 资源支持矩阵

Date: 2026-08-25

Status: 参考文档。生态事实经联网核实，截至 2026-08-25；himan 适配情况以代码为准，随生态演进更新。

## 说明

- 列 = himan 资源类型（`rule` / `command` / `skill` / `config` / `subagent` / `MCP`）。
- 每个单元格同时标注两个维度：
  - **生态原生支持**（agent 官方/社区约定，联网核实）；
  - **himan 当前适配**（代码事实，见 `src/utils/agent-configs.ts` 与 `src/services/index.ts`）。
- 图例：✅ 原生支持且 himan 已适配 ｜ ⚠️ 存在但为 legacy 或 himan 待适配 ｜ ❌ himan 未实现 / 生态不适用。
- himan 当前支持 agent：`cursor` / `claude-code` / `codex` / `openclaw` / `copilot`；规划中：`workbuddy` / `deepseek-harness`；不纳入：`gemini-cli`（见"支持策略决策"）。

## 矩阵

| Agent | rule | command | skill | config | subagent | MCP |
| --- | --- | --- | --- | --- | --- | --- |
| **Codex** | ✅ AGENTS.md（项目根 + `~/.codex/AGENTS.md` + `AGENTS.override.md`）；himan 映射 `.codex/rules` ⚠️ Codex 原生读取的是 AGENTS.md，需适配 | ❌ 官方已弃用自定义 slash command，并入 skills；himan 的 `.agents/commands` 转维护态 | ✅ `.agents/skills/<name>/SKILL.md`（行业新标准，`~/.codex/skills` 为 legacy 名称）；himan 已映射 | ✅ `.codex/config.toml`；himan `config` 类型目前唯一实现 | ✅ `.codex/agents/<name>.toml`（用户级 `~/.codex/agents/`）；himan 规划中 | ✅ `~/.codex/mcp.json` / `.codex/mcp.json`；himan 规划中 |
| **Claude Code** | ✅ CLAUDE.md（项目 + 全局）；himan 映射 `.claude/rules` ⚠️ 原生机制是 CLAUDE.md，需拼接/适配 | ⚠️ `.claude/commands/` 为 legacy，v2.1.3 起并入 Skills（仍兼容）；himan 已映射 | ✅ `.claude/skills/<name>/SKILL.md`（项目）/ `~/.claude/skills/`（用户）；himan 已映射 | ⚠️ `.claude/settings.json`；himan `config` 仅 codex，此处预留 | ✅ `.claude/agents/<name>.md`（YAML frontmatter）；himan 规划中 | ✅ `.mcp.json`（项目）/ `~/.claude.json`（用户）；himan 规划中 |
| **Cursor** | ✅ `.cursor/rules/*.mdc`（`.cursorrules` 已废弃，且当前只识别 `.mdc`）；himan 需确保 `.mdc` 格式 | ⚠️ 自定义 command 已让位 skills（2.4+ 提供 migrate-to-skills）；himan `.cursor/commands` 兼容性待核 | ✅ `.cursor/skills/<name>/SKILL.md`（2.4+）；himan 已映射 | ❌ himan 未实现（Cursor 配置分散） | ✅ `.cursor/agents/<name>.md`（项目）/ `~/.cursor/agents/`（用户），并兼容读取 `.claude/agents` / `.codex/agents`；himan 规划中 | ✅ `.cursor/mcp.json` / `~/.cursor/mcp.json`；himan 规划中 |
| **Copilot** | ✅ `.github/instructions/*.instructions.md` + AGENTS.md；himan 当前拼接 `.github/copilot-instructions.md`（旧约定，待适配） | ⚠️ prompt files（`.github/prompts/*.prompt.md`）承担命令/技能；himan `command` 不支持 copilot | ⚠️ 新机制 `.github/skills/*/SKILL.md`；himan 当前映射 prompt files（旧），待升级 | ❌ himan 未实现（VS Code / Copilot 设置） | ⚠️ VS Code Copilot 自定义 agents 支持，位置待核 | ⚠️ VS Code Copilot 支持 MCP，位置待核 |
| **OpenClaw**（保留） | ⚠️ 工作区用 AGENTS.md / SOUL.md 手册；himan `.openclaw/rules` 待核 | ✅ 原生 slash commands，skills 可注册为命令；himan `.openclaw/commands` 待核 | ✅ 支持 skills（`openclaw skills install`）；himan `.openclaw/skills` 待核 | ❌ himan 未实现（每 agent 状态/配置目录） | ✅ agents / sub-agents（`~/.openclaw/agents/`，sub-agent 用 `sub-agent.md`）；himan 规划中 | ⚠️ 支持，配置文件位置待核 |
| **WorkBuddy**（规划中） | ✅ WORKBUDDY.md / AGENTS.md 规则文件 ｜ himan 未纳入 | ⚠️ 无独立 command 体系，技能可作命令触发 ｜ himan 未纳入 | ✅ `~/.workbuddy/skills/<name>/SKILL.md`（用户）/ `{workspace}/.workbuddy/skills/<name>/SKILL.md`（项目），与 OpenClaw skills 兼容 ｜ himan 未纳入 | ✅ 记忆/日志/bot·channel/MCP 配置 ｜ himan 未纳入 | ✅ subagents / hooks / connectors ｜ himan 未纳入 | ✅ `.mcp.json` + MCP 配置 ｜ himan 未纳入 |
| **deepseek-harness (dsh)**（规划中） | ⚠️ 待核 ｜ himan 未纳入 | ⚠️ 插件可注册命令类能力，独立体系待核 ｜ himan 未纳入 | ✅ Agent Skills 标准（`~/.dsh` 技能目录 + `dsh-skill` / `dsh-tool-skill`，目录自动发现）｜ himan 未纳入 | ✅ `~/.dsh`（`$DSH_HOME`）配置根目录 ｜ himan 未纳入 | ✅ 支持子 Agent ｜ himan 未纳入 | ✅ 支持（插件 bundle 可带 MCP server）｜ himan 未纳入 |

## 支持策略决策（2026-08-25）

- **保留 OpenClaw（先保留）**：撤销此前基于热度回落的放弃决定。OpenClaw 是连接 WhatsApp / Telegram / Discord 等消息应用的自托管**网关**，其底层引擎为 Pi，且与 WorkBuddy 等"类 Claw"产品技能互通（WorkBuddy 兼容 OpenClaw 技能生态）；支持 OpenClaw 技能格式即覆盖整个 Claw 生态，定位为 **Claw 生态入口**。
- **不纳入 Gemini CLI**：面向消费者的版本（free / AI Pro / Ultra）已于 2026-06-18 停止服务，官方转向 Antigravity CLI；open-source 二进制虽仍在发版，但个人用户群体已大幅萎缩。
- **核心保留**：`codex` / `claude-code` / `cursor`（行业排名与生态标准齐全）；**Copilot 保留，以后可能废弃**（用户量大但格式特殊、演进频繁，先保留为维护态，列为未来废弃候选）。
- **规划支持**：`workbuddy` / `deepseek-harness`（均兼容 Agent Skills 标准，skill 类型可低成本接入；deepseek-harness 为 2026-08 新开源的 v0.1 预览版，优先级低于 WorkBuddy）。
- **纳入门槛**：先看是否是 coding agent；再看是否支持跨工具标准（AGENTS.md / `.agents/skills` / `SKILL.md` / `.mcp.json`）；最后看活跃度与稳定性。
- 代码层面：`openclaw` 保留其路径映射，不从 `src/utils/agent-configs.ts` 移除；新增 agent 时按纳入门槛评估。

## himan 适配现状与缺口

1. **rule 没有死，但格式在换代**：AGENTS.md 成为跨工具标准；Cursor 淘汰 `.cursorrules` 改用 `.cursor/rules/*.mdc`；Copilot 从单个 `copilot-instructions.md` 演进到 `.github/instructions/` 目录。himan 当前把 rule 安装到 `.codex/rules` / `.claude/rules` 可能不被原生读取，是最需要修复的适配缺口。
2. **command 正在被 skills 吸收**：Codex 官方弃用自定义 slash command、Claude Code 把 commands 合并进 Skills、Cursor 提供迁移工具。himan 的 `command` 类型应转维护态，`create` 时引导用户使用 skill，未来按 Keep a Changelog 流程 deprecate。
3. **skill 是当前事实标准**：位置趋于统一（`.agents/skills` / `.claude/skills` / `.cursor/skills` / `.github/skills` / `.workbuddy/skills` / `~/.dsh`），Pi / WorkBuddy / deepseek-harness 均兼容 Agent Skills 标准。himan 方向正确，需要把 Copilot 从 prompt files 升级到 `.github/skills`。
4. **subagent 在主流 agent 中都有明确约定**：Codex 为 TOML，Claude / Cursor 为 Markdown + YAML frontmatter，格式不统一，需要 per-agent 适配；WorkBuddy / deepseek-harness 支持 subagents，约定待调研。详见 `docs/v1.0/issues/2026-08-25_subagent-resource.md`。
5. **MCP 配置位置每个 agent 都不同**（`.mcp.json` / `.cursor/mcp.json` / `.codex/mcp.json` / `~/.claude.json` 等），适合做成 `mcp` 资源类型统一管理（与 mmcp 等工具同类）。

## 未来方向（记录）

- OpenClaw 保留（Claw 生态入口）；WorkBuddy / deepseek-harness 规划支持；Gemini CLI 不纳入（见"支持策略决策"）。
- 新增 `mcp` 资源类型（独立需求，待建文档）。
- rule 目标格式适配：Cursor `.mdc`、Copilot `.github/instructions/`、Codex/Claude 的 AGENTS.md/CLAUDE.md 拼接。
- `command` 转维护态并引导迁移到 skill。
- Copilot skill 从 `.github/prompts` 升级到 `.github/skills`。
- Copilot 保留但列为未来废弃候选。
- `subagent` 资源类型（独立需求，已建文档）。

## 参考来源

- AGENTS.md 标准与生态：<https://www.morphllm.com/agents-md-guide>、<https://www.tembo.io/blog/agents-md>
- Cursor rules / skills / subagents：<https://www.morphllm.com/cursor-rules-best-practices>、<https://cursor.com/cn/changelog/2-4>、<https://stevekinney.com/courses/ai-development/cursor-subagents>
- Codex skills 目录（`~/.codex/skills` legacy，`~/.agents/skills` 新标准）：<https://github.com/openai/codex/issues/14337>
- Codex subagents（`~/.codex/agents/*.toml`）：<https://developers.openai.com/codex/subagents>
- Codex 弃用自定义 slash command：<https://github.com/openai/codex/issues/13893>
- Claude Code skills：<https://code.claude.com/docs/en/skills>；commands 并入 skills：<https://github.com/kcenon/claude-config/issues/183>、<https://claudelint.com/rules/commands/commands-deprecated-directory>
- Claude Code subagents：<https://github.com/agentpatterns-ai/website/blob/main/tools/claude/sub-agents.md>
- Copilot：<https://github.com/griddynamics/rosetta/blob/main/instructions/r2/core/configure/github-copilot.md>、<https://raw.githubusercontent.com/microsoft/vscode-docs/main/docs/copilot/guides/customize-copilot-guide.md>
- OpenClaw 定位与生态（保留依据）：<https://github.com/openclaw/openclaw>、<https://docs.claw.so/engine/pi/>、<https://www.eweek.com/news/openclaw-pi-coding-agent-ai-tools-neuron/>
- MCP 配置文件位置：<https://github.com/koki-develop/mmcp>、<https://socket.dev/npm/package/%40coding-agent-fabric%2Fplugin-mcp>
- WorkBuddy：<https://www.ifanr.com/1658088>、<https://m.ithome.com/html/927230.htm>、<https://cloud.tencent.com.cn/developer/article/2702699>
- deepseek-harness：<https://github.com/deepseek-ai/deepseek-harness>、<https://www.infoq.cn/article/de9AljWc4ejW2KAyW8dD>、<https://upstash.com/blog/upstash-skills-now-supports-deepseek-harness-and-zed>
- Gemini CLI 消费者版停用（不纳入依据）：<https://9to5google.com/2026/06/17/gemini-cli-code-assist-shutting-down/>、<https://developers.google.cn/gemini-code-assist/docs/deprecations/code-assist-individuals>、<https://www.tembo.io/blog/gemini-cli-pricing>
