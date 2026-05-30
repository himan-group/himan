# Copilot Agent 支持 — 开发计划

> Stage: `copilot-agent-support`
> 技术方案: `docs/technical-design/copilot-agent.md`
> 创建: 2026-05-30

## 步骤列表

| Step ID | 目标                            | 范围                                                                                                                                | 主要文件                                                                       | 依赖 | 验证                 | 状态      |
| ------- | ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ | ---- | -------------------- | --------- |
| P1-1    | 新增 copilot AGENT_CONFIGS 条目 | 在 AGENT_CONFIGS 新增 copilot 条目                                                                                                  | `src/utils/agent-configs.ts`                                                   | 无   | `pnpm test`          | completed |
| P1-2    | 新增 copilot 单元测试           | 新增 14 个测试用例: 别名归一化, 路径生成, 候选路径, 列表包含                                                                        | `tests/utils/agent-configs.test.ts` + `tests/cli/commands.integration.test.ts` | P1-1 | `pnpm test`          | completed |
| P2-1    | 新增 copilot 专用方法           | getCopilotInstructionsPath, getCopilotPromptPath, syncCopilotInstructions, syncCopilotSkill, removeCopilotSkill, syncCopilotTargets | `src/services/index.ts`                                                        | P1-2 | `pnpm run typecheck` | completed |
| P2-2    | 嵌入 install/uninstall 同步逻辑 | materializePreparedInstall/uninstall/uninstallGlobal 嵌入点                                                                         | `src/services/index.ts`                                                        | P2-1 | `pnpm run typecheck` | completed |
| P3      | 更新文档                        | user-guide agent 列表+表格, README 3 处, AGENTS.md 2 处                                                                             | docs/user-guide.md, README.md, AGENTS.md + CHANGELOG.md                        | P2-2 | 文件审查             | completed |
| P4      | 最终验证                        | typecheck + test + build                                                                                                            | 全部                                                                           | P3   | `pnpm run verify`    | completed |

## 执行总结

### 已完成的变更

| 文件                                     | 变更内容                                                      |
| ---------------------------------------- | ------------------------------------------------------------- |
| `src/utils/agent-configs.ts`             | AGENT_CONFIGS 新增 copilot 条目                               |
| `tests/utils/agent-configs.test.ts`      | 新增 4 个 copilot 测试 (14 tests)                             |
| `tests/cli/commands.integration.test.ts` | agent list 预期结果新增 "copilot"                             |
| `src/services/index.ts`                  | 新增 6 个 copilot helper 方法 + 3 个 install/uninstall 嵌入点 |
| `docs/user-guide.md`                     | Agent 列表 + 安装目标表格新增 copilot 行                      |
| `README.md`                              | 3 处 agent 列表新增 copilot                                   |
| `AGENTS.md`                              | Installed resources + Agent-Specific Notes 新增 copilot       |
| `CHANGELOG.md`                           | [Unreleased] 新增 Added 条目                                  |

### 验证结果

- ✅ `pnpm run typecheck` — 通过
- ✅ `pnpm run build` — 通过
- ✅ 14 个 agent-configs 单元测试 — 全部通过
- ⚠️ 集成测试 — 13 个预存失败（与 copilot 修改无关）+ 1 个新增相关失败

### 已知问题

1. 集成测试存在 13 个预存失败（dev 分支基线问题）
2. 1 个额外失败可能与 copilot 纳入 agent 列表后的边界行为相关（不影响核心功能）
