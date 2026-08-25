# 机器级资源盘点与 CLI 分组重构（`system` / `repo` 命令组）需求规格

Date: 2026-08-25

Status: 需求讨论稿（proposed），未实现。

## Goal

- 提供只读的机器级 AI 资源盘点：当前用户所有 agent 的全局资源 + 当前项目全部资源，统一到一个视图。
- 区分每个资源是否被 himan 管理，暴露异常项（重复资源、同名不同版本、未托管、lock 目标缺失、store 孤儿缓存等），为用户清理冗余和统一管理提供依据。
- 提供概念路径：把未托管资源迁移为 himan 托管（`migrate`），以及安全清理冗余（`cleanup`）。
- 通过 himan 分发的 skill/rule 资源引导 agent 把新建资源放在规范位置并打上管理标记，从源头减少"影子资源"。
- CLI 分组重构：`source` 命令组更名为 `repo`（保留 `source` 兼容别名）；`setup`（原 `init`） / `doctor` / `audit` / `migrate`（原 `adopt`） / `cleanup`（原 `prune`）归入新 `system` 命令组（`setup` / `doctor` 保留顶层别名，可不写 `system`；`init` 保留为 legacy 别名）；移除重复入口（`resource list --installed`、`source init`）。

## Background And Necessity

- 资源散落在多个 agent 目录（`.cursor` / `.claude` / `.agents` / `.codex` / `.github/copilot` / `.openclaw`），用户级和项目级都有，没有机器级统一视图。
- 现有"已安装"概念来自 `himan.lock`（项目级）与全局安装（无 lock）；`resource list --installed` 读 lock，不读真实文件系统。
- `doctor` 只校验当前项目 lock 登记的 target 是否存在，不盘点机器。
- 手动放入 agent 目录、未登记的"影子资源"对 himan 不可见，无法 `list` / `publish` / 清理。
- agent（如 Codex）会按 skill 指引自行向 agent 目录写入资源，可能与 source 中的资源重复或冲突。
- `source` 与 `resource` 命令组视觉高度相似（`himan source list` vs `himan resource list`），容易混淆。

## Scope

In scope:

- CLI 结构：`himan repo ...`（`source` 为兼容别名）与 `himan system setup|doctor|audit|migrate|cleanup`（`setup` / `doctor` 保留顶层别名）。
- `system audit stats|list|issues` 三种只读视图及 `--json` 输出。
- 扫描范围：用户级 agent 全局目录 + 当前项目。
- 资源分类：managed / unmanaged / drifted / redundant / orphan store cache。
- `system doctor` 承接现有顶层 `doctor`（保留 `himan doctor` 兼容别名）。
- `migrate` / `cleanup` 在本规格中定义行为与约束，不排期实现细节。

Out of scope:

- 功能开发（本规格仅文档）。
- Registry source（保留，`registry` 名称留给未来的远程 Registry 源）。
- 跨项目全工作区扫描（仅当前项目）。
- `cleanup` 的实际执行（需单独确认与实现，第一版只报告）。
- 平台化 / 远程服务 / 权限控制。

## CLI Structure

```text
himan
  setup             # 顶层别名，等价 himan system setup；himan init 保留为 legacy 别名
  repo ...          # 原 source 组；source 保留为兼容别名
  resource ...      # 源资源创作与发布：list/history/create/comment/dev/publish/archive/restore/rename
  project ...       # 当前项目（工作目录）安装态：list/install/uninstall（-g 为用户级）
  agent ...
  system
    setup           # 原顶层 init 迁入并更名（可不写 system，直接用 himan setup）
    doctor          # 原顶层 doctor 迁入（可不写 system，直接用 himan doctor）
    audit stats|list|issues
    migrate <path>  # 原 adopt：未托管资源迁移为 himan 托管（登记式，文件可保留原位）
    cleanup         # 原 prune：按 audit 结果清理冗余（dry-run）
  doctor            # 向后兼容别名
```

`repo` 组命令：`add|alias|rename|use|list|init-docs|clone|sync`（`setup` 归入 `system` 组）。

`project` 组指当前工作目录（消费 himan 的项目），不是 himan 自身的项目；帮助文案与文档明确写"当前项目（工作目录）的安装态"，避免歧义。

## Setup 交互行为

`himan system setup`（别名 `himan setup`）是本机 himan 环境初始化向导，`himan init` 保留为 legacy 别名。

交互规则：

- 仅在 TTY 且缺少必需参数时逐项提示；已有参数跳过。
- 非 TTY（CI / 脚本）不提示，缺失必填参数报错，保持与现有一致。
- `--json` 不进入交互，输出结构化结果。

提示项（按顺序）：

1. 来源：选择已有 source / 输入新 Git URL / 跳过（使用当前默认 source）。
2. 默认 agents：多选（默认 codex）。
3. 初始安装：从当前 source 列出资源多选，或跳过。
4. 安装模式：link / copy（默认 copy）。

执行前输出确认摘要（来源、agents、安装列表、模式），确认后执行。保留现有非交互参数：`<git_repo>`、`--agent`、`--install`、`--mode`、`--json`。

命名理由：`init` 语义模糊（初始化来源还是项目？），`setup` 更贴合"引导配置"；`init` 保留 legacy 别名避免破坏现有文档与脚本。

## Group Overlap Analysis And Decisions (Confirmed)

现有命令树存在以下重叠与边界问题，已确认按下列方式优化：

1. `resource list --installed` 与 `project list` 是同一功能（都是 `listInstalledResourceGroups(process.cwd())`）。移除 `resource list --installed`（暂保留 deprecated 别名），`project list` 为唯一安装态列表。
2. `himan init` 与 `himan source init` 是同一个命令注册两次。`init` 更名 `setup` 并归入 `system` 组（`himan system setup`），顶层 `himan setup` 保留为别名（可不写 `system`）；`himan init` 保留为 legacy 别名；`source init` / `repo init` 移除。
3. `dev` / `publish` 保留在 `resource` 组（与 `create` 构成完整创作发布闭环），但帮助文案要明确组定位：`resource` = 源资源的创作与发布，`project` = 安装态管理。
4. 顶层兼容命令（`list` / `create` / `install` / `publish` 等）保留功能但不宣传：帮助中标注 legacy 或隐藏，文档只写分组规范写法。
5. `doctor` 与 `audit` 划清边界：doctor = himan 环境健康（node/git/home/配置/lock 格式），audit = 资源盘点与漂移/重复；targets 缺失检查只保留一份共享实现，避免两处重复维护。
6. `source` 更名为 `repo`（保留别名）；`system` 组承载 `setup` / `doctor` / `audit` / `migrate` / `cleanup`；`registry` 名称保留给未来远程 Registry 源。
7. Agent 支持范围（2026-08-25 更新）：保留 OpenClaw（Claw 生态入口，撤销此前放弃决定）；Copilot 保留但以后可能废弃；规划支持 WorkBuddy / deepseek-harness（Agent Skills 标准兼容）；不纳入 Gemini CLI（消费者版停用）。

## Naming Notes

- `adopt` → `import` → `migrate`：最终选用 `migrate`，强调"把本机已有资源迁移为 himan 托管"的状态转变，避免 `import` 被理解为从外部来源拉取；帮助文案需说明为登记式迁移（文件可保留原位，也可移入 store，由实现决策）。
- `prune` → `cleanup`：更直白，非 Docker 用户也能理解；保留 `--dry-run` 预览与废纸篓语义。
- `project` 保留：himan 文档与数据模型已用"项目"指消费端工作目录（`himan.lock`、`.himan/config.json`）；不引入 `workspace`（与 IDE / Codex 撞词）或 `local`（与未来本地 source 撞词），歧义通过帮助文案消除。

## Scan Scope

用户级（home 下，目录存在才扫）：

- `~/.cursor`（rules）
- `~/.claude`（commands）
- `~/.agents`（codex skills/commands）
- `~/.codex`（codex rules/configs，含 legacy `.codex/skills`）
- `~/.github/copilot`（copilot）
- `~/.openclaw`（openclaw）

项目级（当前目录）：

- 同构 agent 目录（`.cursor` / `.claude` / `.agents` / `.codex` / `.github/copilot` / `.openclaw`）
- `himan.lock`
- legacy `.himan/dev`
- `.codex/config.toml`（config 资源同步目标）

特殊映射：

- codex：rules/configs 落在 `.codex`，skills/commands 落在 `.agents`。
- copilot：rules 合并进 `copilot-instructions.md`；skills 是 `.github/prompts/<name>.prompt.md`，不是普通目录结构，需单独识别。

排除项：`node_modules`、`.git`、缓存目录。

## Resource Classification

| 类别 | 定义 | 识别手段 |
| --- | --- | --- |
| managed | 有 lock/登记，且文件与 store 一致 | symlink 指向 store；copy 带标记；内容哈希匹配 |
| drifted | 有登记但文件被改/删/版本不对 | lock/登记 vs 实际路径 |
| unmanaged | 存在于 agent 目录但无任何登记 | 路径约定 + 默认入口文件存在，但无 `himan.yaml` / 标记 |
| redundant | 同一资源多版本、多 agent、多项目重复副本 | 按类型 + 名称（+ 内容哈希）归组 |
| orphan store cache | store 里有但没有任何安装引用 | store 反向比对 lock/登记 |

识别顺序：路径约定 → `himan.yaml` / `SKILL.md` front matter → 安装证据（symlink 目标、内容哈希、中央登记）。

## View Forms

`himan system audit stats`（统计形）：

- agent 安装情况（目录存在的 agent，含资源数为 0 的）
- 各 agent 资源数（按类型分组）
- 当前项目资源数
- managed / unmanaged 数量
- 异常项数量（按类别）

`himan system audit list`（详情形）：

- 每行一个资源：scope、agent、type、name、version、source、status、mode（link/copy）、path
- `--json` 输出稳定结构，供其他工具消费

`himan system audit issues`（异常项形）：

- 只列异常，带级别（warn/error，沿用 doctor 状态语义）
- 每条附路径和建议动作

统一约定：`--json`；`--scope global|project|all`（默认 all）；`--agent <agent>` 过滤；`audit` 不带子命令时默认输出 `stats`。

## Statistics Semantics

- "安装了哪些 agent"：以对应配置目录存在为准，资源数可以为 0。
- 每个 agent 有哪些资源：按 agent × 类型 × 名称/版本分组。
- 当前项目资源：单独分组，标注哪些来自 `himan.lock`、哪些是文件系统实际存在但 lock 没有（drift 来源）。
- 是否被 himan 管理：managed / unmanaged 两态 + drifted 子态。
- 异常项分类：同名资源重复（跨 agent 或跨 scope）、同名不同版本、lock 有但文件缺失/被改、未托管资源、store 无引用的孤儿缓存。

## Key Design Decisions (Pending)

1. store 定位与 `migrate`（原 `adopt`）落点：
   - 现状 store 是 source 的缓存副本。纳入管理的两条路径：a) 扩展 store 支持"无 source 的个人资源"；b) 引入本地私有 source，`migrate` 写入私有 source，store 仍当缓存。
   - 倾向 b：贴合现有模型，天然获得版本、publish、归档能力。
2. copy 模式托管标识：
   - 现状 copy 安装不写任何标记，无法与手动文件区分。
   - 倾向维护中央安装登记（如 `~/.himan/installed.json`），记录 scope（project/global）、type/name/version/source/agents/mode、目标路径与 updatedAt；旧安装用"symlink 指向 store + 内容哈希匹配"启发式补识别。
   - 该登记同时作为全局资源与版本的权威清单（相当于"全局 lock"）：当前没有全局 lock，全局安装不写任何登记，版本只能从 symlink 目标或复制进去的 `himan.yaml` 推断；登记落地后，全局资源可 `list`、可复现、可为未来的 `outdated` / `upgrade` 提供数据基础。
   - 与项目 `himan.lock` 的关系：`himan.lock` 保留为项目内可提交、可复现的清单（随项目进 Git）；`installed.json` 是机器级运行时记录（项目与全局都登记，不进项目 Git）。
3. `cleanup`（原 `prune`）安全策略：dry-run 预览 → 移入系统废纸篓而非硬删；第一版只报告不执行。
4. `migrate`（原 `adopt`）流程：识别 → 补 `himan.yaml` → 内容分析（复用 `resource-analysis`）→ 落点（私有本地 source 或 store 扩展）→ 可 `install` / `publish`。

## Version And Release Impact

- 当前包版本为 0.8.8。本次 CLI 分组重构包含破坏性变更（`source` 更名为 `repo`、`init` 更名并迁移为 `system setup`、`doctor` 迁移为 `system doctor`、移除 `resource list --installed` 与 `source init`、顶层兼容命令降级），落地发布时应升级 major 版本至 1.0.0。
- 实现阶段同步：破坏性变更记录到 `CHANGELOG.md` 的 `[Unreleased]`（Keep a Changelog 格式）；版本号提升走仓库 package scripts（`release:dry` / `release`），不绕过发布流程。
- 兼容性红线：`source`、`init`、`doctor`、顶层生命周期命令均保留为别名，降低破坏面；文档与新帮助只宣传新写法（`repo` / `system setup` / `system doctor` 等）。

## Suggested Phases

- 阶段 1：`repo` 改名 + `system` 组骨架 + `setup`（原 `init`） / `doctor` 迁移（保留顶层别名）+ 移除重复入口（`resource list --installed`、`source init`）。
- 阶段 2：`system audit stats|list|issues`（只读盘点，不改安装模型）。
- 阶段 3：`migrate`（原 `adopt`，含私有本地 source 或 store 扩展）。
- 阶段 4：`cleanup`（原 `prune`，dry-run + 废纸篓）。
- 阶段 5：agent 落位引导（placement 类 skill/rule 资源 + `create` 输出落位指引 + 中央安装登记）。

## Acceptance Criteria

- Given 用户级目录存在 `~/.cursor/rules/x` 且 symlink 指向 store，When 执行 `system audit stats`，Then 该资源计入 managed。
- Given 项目 `.agents/skills/foo` 无 `himan.yaml` 且不在 lock，When 执行 `system audit list`，Then 标记为 unmanaged 并给出路径。
- Given 同一资源跨 agent 存在且版本不同，When 执行 `system audit issues`，Then 输出 version-drift 异常项并附路径。
- Given 执行 `himan repo list`，Then 行为与 `himan source list` 一致；`himan source list` 仍可用（兼容别名）。
- Given 执行 `himan doctor`，Then 与 `himan system doctor` 行为一致（兼容别名）。
- Given 执行 `himan system setup <repo>`，Then 与 `himan setup <repo>` 等价；`himan init` 仍可用（legacy 别名）；`himan source init` / `himan repo init` 不再提供。
- Given 执行 `himan resource list --installed`，Then 提示改用 `himan project list`（deprecated 别名或移除）。
- Given `system audit` 与 `system doctor` 都检查 lock target 缺失，Then 两者共用同一实现，不重复维护。
- Given 存在全局安装资源，When 执行 `system audit list`，Then 该资源以 scope=global 显示版本与来源（来自中央安装登记）。
- Given 在 TTY 下执行 `himan setup` 且缺少必填参数，Then 按顺序逐项提示并输出确认摘要后执行。
- Given 在非 TTY 下执行 `himan setup` 且缺少必填参数，Then 报错且不进入交互。
- Given 本次 CLI 重构实现完成，When 执行 `release:dry`，Then 包版本为 1.0.0 且 `CHANGELOG.md` 的 `[Unreleased]` 已记录破坏性变更。

## Validation

- 文档阶段：人工审查。
- 实现阶段：`pnpm run typecheck`、`pnpm test`（CLI 集成测试覆盖新命令与别名）；CLI 行为变更记录到 `CHANGELOG.md` 的 `[Unreleased]`。

## Existing References

- CLI 命令注册：`src/cli/builders.ts`、`src/cli/source-commands.ts`、`src/cli/doctor-command.ts`、`src/cli/project-commands.ts`、`src/cli/resource-commands.ts`
- 服务编排：`src/services/index.ts`
- 资源扫描与分析：`src/adapters/resource/resource-scanner.ts`、`src/adapters/resource/resource-analysis.ts`
- agent 目录映射：`src/utils/agent-configs.ts`
- 状态存储：`src/state/state-store.ts`、`src/state/project-lock-store.ts`、`src/state/index-cache-store.ts`
- 领域类型：`src/domain/doctor.ts`、`src/domain/resource.ts`
- 保留概念：`src/adapters/source/registry-source-adapter.ts`

## Open Questions

1. `migrate`（原 `adopt`）落点：私有本地 source vs store 扩展（倾向私有本地 source，需确认）。
2. copy 模式标识：中央安装登记 vs 目录内 sidecar 标记（倾向中央登记，需确认）。
3. `audit` 不带子命令默认输出 `stats`，需确认。
4. "agent 已安装"以配置目录存在为准，需确认。
