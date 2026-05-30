# Himan Copilot Agent 支持 — 技术方案

> 状态: 待评审  
> 创建: 2026-05-30  
> 关联蓝图: `docs/blueprint.md`

## 1. 设计目标

为 himan 新增 `copilot` agent，使 VS Code 内置的 GitHub Copilot 能够消费 himan 管理的 prompt 资产。

**范围**:
- 新增 `copilot` 作为第 5 个受支持的 agent
- `rule` 类型资源拼接同步到 `.github/copilot-instructions.md`
- `skill` 类型资源一对一映射到 `.github/prompts/<name>.prompt.md`
- `command` 类型暂不支持
- `config` 类型不支持（与 cursor/claude-code/openclaw 一致）

**非目标**:
- 不改变现有 agent 的行为
- 不引入新的资源类型
- 不实现 Copilot 特有的配置文件格式（如 `.github/copilot/config.json`）

## 2. 核心技术决策

### 2.1 目录隔离策略

**决策**: baseDir 使用 `.github/copilot/`，而非 `.github/`

**理由**:
- `.github/` 目录通常已有 workflows、issue templates 等 GitHub 原生文件
- 使用子目录 `.github/copilot/` 避免与用户现有 `.github/` 内容冲突
- himan 内部管理资源在 `.github/copilot/rules/<name>/` 和 `.github/copilot/skills/<name>/`
- 最终输出文件在 himan 外部约定路径：`.github/copilot-instructions.md` 和 `.github/prompts/<name>.prompt.md`

```
项目根目录/
├── .github/
│   ├── copilot/                    ← himan 管理的内部存储
│   │   ├── rules/
│   │   │   └── my-rule/
│   │   │       └── content.md
│   │   └── skills/
│   │       └── my-skill/
│   │           └── SKILL.md
│   ├── copilot-instructions.md     ← himan 生成的聚合文件（rule 拼接）
│   └── prompts/                    ← himan 生成的 skill 映射
│       └── my-skill.prompt.md
├── .cursor/                        ← 其他 agent 不受影响
└── .claude/
```

### 2.2 Rule 拼接模式

**决策**: 多个 rule 拼接为单个 `copilot-instructions.md`，每个 rule 用注释标注来源

**理由**:
- GitHub Copilot 只读取单个 `copilot-instructions.md` 文件
- 无法像 cursor/claude-code 那样用目录组织多个 rule
- 拼接是唯一符合 Copilot 约定的方式

**拼接格式**:
```markdown
<!-- himan:rule:my-code-review -->
<content.md 原始内容>

<!-- himan:rule:my-style-guide -->
<content.md 原始内容>
```

### 2.3 Skill 一对一映射

**决策**: 每个 skill 的 `SKILL.md` 复制/链接到 `.github/prompts/<name>.prompt.md`

**理由**:
- GitHub Copilot 的 prompt 文件是独立文件，天然适合一对一映射
- 文件名约定: `<skill-name>.prompt.md`，与 Copilot 的 `.prompt.md` 后缀匹配

### 2.4 同步触发时机

**决策**: 在 `materializePreparedInstall()` 和 `uninstall()` 中嵌入同步逻辑

**理由**:
- 遵循 codex config 的现有模式（`activateConfigResource` / `reactivateProjectConfig`）
- 确保每次 install/uninstall 后 Copilot 读取的文件保持最新
- 不引入新的顶层命令或用户可见步骤

### 2.5 向后兼容

**决策**: 不实现 copilot 的 `legacyBaseDirs`

**理由**:
- copilot 是全新 agent，没有历史遗留目录需要兼容
- 如果未来 GitHub Copilot 改变约定，可通过 `legacyBaseDirs` 迁移

## 3. 修改范围

### 3.1 文件变更清单

| 文件                                | 变更类型 | 说明                                                                                            |
| ----------------------------------- | -------- | ----------------------------------------------------------------------------------------------- |
| `src/utils/agent-configs.ts`        | **修改** | 新增 AGENT_CONFIGS 条目 + `getAgentBaseDir()` 分支 + `getResourcePathCandidatesForAgent()` 分支 |
| `src/services/index.ts`             | **修改** | 新增 4 个 copilot 专用方法 + install/uninstall 流程嵌入                                         |
| `tests/utils/agent-configs.test.ts` | **修改** | 新增 6+ 测试用例                                                                                |
| `docs/user-guide.md`                | **修改** | Agent 列表 + 安装目标表格                                                                       |
| `README.md`                         | **修改** | 3 处 agent 列表                                                                                 |
| `AGENTS.md`                         | **修改** | installed resources 引用                                                                        |

### 3.2 不改动的文件

CLI 层（`src/cli/agent-commands.ts`、`project-commands.ts`、`resource-commands.ts`、`source-commands.ts`）**无需修改** — 它们通过 `getSupportedAgentNames()` 和 `normalizeAgent()` 自动适配新 agent。

状态层（`src/state/*`）**无需修改** — agents 数组以通用形式存储。

## 4. 数据契约 / Domain Model

### 4.1 Agent Config 扩展

```typescript
// src/utils/agent-configs.ts — AGENT_CONFIGS 新增条目
{
  name: "copilot",
  aliases: ["copilot", "github-copilot", "vs-code-copilot"],
  baseDir: ".github/copilot",
  legacyBaseDirs: [],
}
```

`SupportedAgent` 类型自动扩展为 `"cursor" | "claude-code" | "codex" | "openclaw" | "copilot"`。

### 4.2 路径解析契约

| 函数                                                                | copilot 行为                                                                         |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `getAgentBaseDir("copilot", type)`                                  | 所有 type 统一返回 `".github/copilot"`                                               |
| `getAgentBaseDirCandidates("copilot")`                              | 返回 `[".github/copilot"]`                                                           |
| `getResourcePathCandidatesForAgent(rootDir, type, name, "copilot")` | rule: `[".github/copilot/rules/<name>"]`; skill: `[".github/copilot/skills/<name>"]` |

### 4.3 Copilot 输出路径（Service 层私有）

```typescript
// 以下为 ServiceFactory 私有方法，不导出

// rule 拼接目标
getCopilotInstructionsPath(rootDir: string): string
// → "<rootDir>/.github/copilot-instructions.md"

// skill 映射目标
getCopilotPromptPath(rootDir: string, name: string): string
// → "<rootDir>/.github/prompts/<name>.prompt.md"
```

### 4.4 Install/Uninstall 流程扩展点

```
install() → installWithSource() → prepareInstall() → materializePreparedInstall()
                                                           │
                                                           ├── materializeResource() (现有)
                                                           ├── activateConfigResource() (codex config)
                                                           └── syncCopilotTargets()     ← 新增

uninstall()
    │
    ├── fs.rm(linkPath)               (现有)
    ├── lockStore.removeResource()    (现有)
    ├── reactivateProjectConfig()     (codex config)
    └── syncCopilotTargets()          ← 新增
```

## 5. Runtime / Integration 设计

### 5.1 `syncCopilotTargets()` 核心流程

```
syncCopilotTargets(rootDir, type, installedResources?)
    │
    ├── type === "rule"
    │   ├── 扫描 .github/copilot/rules/ 下所有已安装 rule
    │   ├── 读取每个 rule 的 content.md
    │   ├── 拼接为 copilot-instructions.md
    │   └── 写入 .github/copilot-instructions.md
    │
    ├── type === "skill"
    │   ├── 对每个 skill:
    │   │   ├── source: .github/copilot/skills/<name>/SKILL.md
    │   │   ├── target: .github/prompts/<name>.prompt.md
    │   │   └── 复制或链接到 target
    │   └── 清理 .github/prompts/ 中已卸载的 skill
    │
    └── 其他 type: no-op
```

### 5.2 全局安装

`installGlobal` 时 copilot 对应的全局路径:
- rule: `~/.github/copilot/rules/<name>/` → 拼接写入 `~/.github/copilot-instructions.md`
- skill: `~/.github/copilot/skills/<name>/` → 映射到 `~/.github/prompts/<name>.prompt.md`

> **注意**: 全局安装的 `copilot-instructions.md` 对 VS Code Copilot 是否生效取决于 Copilot 是否读取 home 目录下的 `.github/` 配置。当前已知 Copilot 仅读取项目级 `.github/copilot-instructions.md`。全局安装主要服务于跨项目共享场景，具体生效范围待验证。

### 5.3 错误处理

| 场景                                     | 行为                                         |
| ---------------------------------------- | -------------------------------------------- |
| `.github/` 目录不存在                    | 自动创建（`fs.mkdir` recursive）             |
| `.github/copilot-instructions.md` 已存在 | 直接覆盖（himan 管理该文件）                 |
| rule 的 `content.md` 读取失败            | 跳过该 rule，记录 warning，继续处理其他 rule |
| `.github/prompts/` 目录不存在            | 自动创建                                     |

### 5.4 并发安全性

- `syncCopilotInstructions()` 在写入时使用先写临时文件再 `rename` 的模式，避免并发读取到不完整内容
- uninstall 时先删除 `.github/prompts/<name>.prompt.md`，再更新 lock，保证一致性

## 6. CLI / API 设计

### 6.1 用户可见命令

无新增命令。现有命令自动支持 copilot:

```bash
# 查看支持的 agent（自动包含 copilot）
himan agent list
# 输出:
# - cursor
# - claude-code
# - codex
# - openclaw
# - copilot

# 设置默认 agent
himan agent use copilot

# 安装 rule 到 copilot
himan install rule my-code-review --agent copilot

# 安装 skill 到 copilot
himan install skill my-skill --agent copilot
```

### 6.2 别名支持

```bash
himan agent use github-copilot    # → copilot
himan agent use vs-code-copilot    # → copilot
```

## 7. 配置设计

无新增配置项。agent 配置沿用现有的 `~/.himan/config.json` 和 `<project>/.himan/config.json` 的 `agents` 字段。

```json
{
  "agents": ["copilot"]
}
```

## 8. 测试策略

### 8.1 单元测试 (`tests/utils/agent-configs.test.ts`)

| 用例                                                                   | 验证点                                          |
| ---------------------------------------------------------------------- | ----------------------------------------------- |
| `normalizeAgent("copilot")`                                            | 返回 `"copilot"`                                |
| `normalizeAgent("github-copilot")`                                     | 返回 `"copilot"`                                |
| `normalizeAgent("vs-code-copilot")`                                    | 返回 `"copilot"`                                |
| `normalizeAgent("GitHub Copilot")`                                     | 返回 `undefined`（暂不支持带空格别名）          |
| `normalizeAgents(["copilot", "codex"])`                                | 去重返回 `["codex", "copilot"]`                 |
| `getProjectResourcePaths(..., "rule", "my-rule", ["copilot"])`         | 返回 `[".github/copilot/rules/my-rule"]`        |
| `getProjectResourcePaths(..., "skill", "my-skill", ["copilot"])`       | 返回 `[".github/copilot/skills/my-skill"]`      |
| `getGlobalResourcePaths(..., "rule", "my-rule", ["copilot"])`          | 返回 `["<home>/.github/copilot/rules/my-rule"]` |
| `getResourcePathCandidatesForAgent(..., "rule", "my-rule", "copilot")` | 返回 `[".github/copilot/rules/my-rule"]`        |
| `getSupportedAgentNames()`                                             | 包含 `"copilot"` 且排序正确                     |

### 8.2 集成测试 (建议新增)

| 用例                                   | 验证点                                                 |
| -------------------------------------- | ------------------------------------------------------ |
| install rule → copilot-instructions.md | 文件生成，内容包含 rule 的 content.md                  |
| install 多个 rule                      | copilot-instructions.md 包含所有 rule 内容，带分隔注释 |
| uninstall rule                         | copilot-instructions.md 不再包含已卸载 rule            |
| install skill → `.github/prompts/`     | `<name>.prompt.md` 生成，内容匹配 SKILL.md             |
| uninstall skill                        | 对应 `.prompt.md` 文件删除                             |

### 8.3 回归测试

- 所有现有 agent 测试必须通过（cursor/claude-code/codex/openclaw 行为不变）
- `pnpm run verify`（typecheck + test + build）全部通过

## 9. 开发顺序

### Phase 1: Agent 配置层（独立，无依赖）

1. 在 `AGENT_CONFIGS` 中新增 copilot 条目
2. 在 `getAgentBaseDir()` 中新增 copilot 分支（统一返回 `.github/copilot`）
3. 在 `getResourcePathCandidatesForAgent()` 中新增 copilot 分支
4. 更新测试 `tests/utils/agent-configs.test.ts`
5. 运行 `pnpm test` 验证

**验收标准**: `himan agent list` 输出包含 `copilot`，`himan agent use copilot` 设置成功

### Phase 2: Service 层同步逻辑（依赖 Phase 1）

1. 新增私有方法: `getCopilotInstructionsPath()`, `getCopilotPromptPath()`
2. 新增 `syncCopilotInstructions(rootDir)`: 拼接 rule 到 `copilot-instructions.md`
3. 新增 `syncCopilotSkill(rootDir, name, resourcePath)`: 映射 skill 到 `.prompt.md`
4. 新增 `removeCopilotSkill(rootDir, name)`: 删除 skill 的 prompt 文件
5. 新增 `syncCopilotTargets(rootDir, type)`: 统一入口，按 type 分发
6. 在 `materializePreparedInstall()` 中嵌入 copilot sync（在 config 处理之后，lock 写入之前）
7. 在 `uninstall()` 中嵌入 copilot sync（在 config `reactivateProjectConfig` 之后）
8. 在 `uninstallGlobal()` 中嵌入 copilot sync（在 config 清理之后）

**验收标准**: install rule/skill 后对应文件正确生成，uninstall 后正确清理

### Phase 3: 文档更新（依赖 Phase 2）

1. 更新 `docs/user-guide.md` — agent 列表 + 安装目标表格
2. 更新 `README.md` — 3 处 agent 列表
3. 更新 `AGENTS.md` — installed resources 引用

**验收标准**: 文档准确描述 copilot 的安装目标路径和行为

### Phase 4: 最终验证

```bash
pnpm run verify      # typecheck + test + build
himan agent list     # 包含 copilot
himan agent use copilot
himan install rule <name> --agent copilot  # 验证 copilot-instructions.md
himan install skill <name> --agent copilot # 验证 .github/prompts/
```

## 10. 风险与处理

| 风险                                                    | 影响                      | 处理                                                                          |
| ------------------------------------------------------- | ------------------------- | ----------------------------------------------------------------------------- |
| VS Code Copilot 改变文件约定                            | 输出文件不被 Copilot 识别 | himan 的 agent 抽象层可快速适配；`legacyBaseDirs` 机制支持迁移                |
| 用户手动编辑 `.github/copilot-instructions.md` 后被覆盖 | 用户手动内容丢失          | 文档中明确标注 himan 管理该文件；未来可考虑 `<!-- himan:managed -->` 区块机制 |
| `.github/` 目录权限问题                                 | 安装失败                  | 标准 `HimanError` 错误处理，与现有 agent 一致                                 |
| 多个 source 的 rule 拼接冲突                            | 内容不协调                | rule 拼接添加 source 标注注释；未来可考虑优先级排序                           |
| 全局安装的 copilot 文件不生效                           | 功能无实际效果            | 文档标注已知限制；主要场景为项目级安装                                        |

## 11. 后续扩展点

1. **command 类型支持**: 如果 GitHub Copilot 未来支持自定义命令文件，可将 command 映射到 `.github/prompts/` 或新约定路径
2. **config 类型支持**: 如果 Copilot 开放配置文件格式（如 `.github/copilot/config.json`），可参考 codex config 模式实现
3. **增量更新**: 当前每次 install/uninstall 都全量重写 `copilot-instructions.md`。如果 rule 数量很大，可优化为增量编辑
4. **用户自定义区块**: 在 `copilot-instructions.md` 中保留 `<!-- himan:user -->` 区块，允许用户在 managed 内容之外添加个人规则
5. **Agent 发现机制**: 未来可考虑自动检测项目中的 agent 配置文件，自动推荐合适的 agent

## 12. 开发约束

- 遵循现有分层架构：`src/utils/` 负责配置，`src/services/` 负责编排
- 遵循 codex 的特殊处理模式：在 `getAgentBaseDir()` 中做 agent 判断，在 service 层做文件映射
- 所有新增方法标记为 `private`，不改变 `ServiceFactory` 的公开 API
- TypeScript `strict` 模式，ESM + `NodeNext` moduleResolution
- 源文件 import 使用 `.js` 扩展名
- 错误使用 `HimanError` + `errorCodes`
- 不引入新的 npm 依赖
- 在 `vitest.config.ts` 已有的测试框架下编写测试
