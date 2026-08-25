# v1.0 系统盘点与 CLI 分组重构开发计划

> 依据：[2026-08-25_system-audit.md](./issues/2026-08-25_system-audit.md)
> 状态：进行中（阶段 1 已开始）
> 当前包版本：0.8.8，目标发布版本：1.0.0

## 实现状态

- 阶段 1（CLI 分组重构）：已完成并提交（`refactor(cli): regroup source into repo and add system group`）。
- 阶段 2.0（中央安装登记）与阶段 2（`system audit`）：已实现，待审查。
- 阶段 3（`migrate`）：已实现（私有本地 source 落点），待审查。
- 阶段 4（`cleanup`）：已实现（dry-run 预览 + 移入系统废纸篓），待审查。
- 阶段 5（agent 落位引导）：已实现（`create` 落位指引 + placement 指南 + 审计标记语义），待审查。
- 发布收尾：已完成（版本升至 1.0.0，`CHANGELOG.md` 归档为 `[1.0.0] - 2026-08-25`，`release:dry` 验证通过；实际 `npm publish` 由 CI 在 master 合并后执行）。

## 执行方式

- 每个阶段独立分支 + PR，跑绿 `pnpm run verify` 后交付审查。
- 用户可见变更同步记录到 `CHANGELOG.md` 的 `[Unreleased]`。
- 文档与帮助只宣传新写法（`repo` / `system setup` / `system doctor` / `system audit` 等）；旧写法（`source` / `init` / `doctor` / 顶层生命周期命令）保留为兼容别名。
- 破坏性变更按规格在发布时升级 major 版本至 1.0.0，走 `release:dry` / `release` 脚本。

## 已确认决策（阶段 0）

1. `migrate` 落点：私有本地 source（方案 b，store 仍当缓存）。
2. copy 模式托管标识：中央安装登记 `~/.himan/installed.json`。
3. `audit` 不带子命令时默认输出 `stats`。
4. "agent 已安装"以对应配置目录存在为准。

## 阶段 1：CLI 分组重构

目标：`source` 更名为 `repo`（保留别名）；新增 `system` 组；`init` 迁移为 `system setup`（顶层 `setup` 别名 + `init` legacy 别名）；`doctor` 迁入 `system` 组（保留顶层别名）；移除 `source init` / `repo init`；`resource list --installed` 降级为 deprecated。

步骤：

1. `src/cli/builders.ts`：注册 `repo`（`.alias("source")`）与 `system` 组；顶层 `setup`（`.alias("init")`）与 `doctor`；更新 `appendCommandGroupsHelp`。
2. 新增 `src/cli/setup-command.ts`：实现 `setup` 交互向导（TTY 按 来源 → agents → 初始安装 → 模式 逐项提示，执行前确认摘要；非 TTY 缺失必填报错；`--json` 不交互），保留 `<git_repo>`、`--agent`、`--install`、`--mode`、`--json`。
3. `src/cli/source-commands.ts`：移除 `registerInitCommand` 及 `includeInit` 入口。
4. `src/cli/resource-commands.ts`：`resource list --installed` 输出 deprecated 提示并引导使用 `himan project list`。
5. 测试：`tests/cli/commands.integration.test.ts` 增加别名等价、`source init` / `repo init` 移除、deprecated 提示、setup 非交互路径用例。
6. 文档同步：`README.md`、`docs/command-reference.md`、`docs/user-guide.md`、`docs/repository-map.md`、`docs/v1.0/impl.md`。
7. `CHANGELOG.md` `[Unreleased]` 记录破坏性变更。
8. 验证：`pnpm run verify`。

验收（对应规格 Acceptance Criteria）：

- `himan repo list` 与 `himan source list` 行为一致，`source` 仍可用。
- `himan system doctor` 与 `himan doctor` 行为一致。
- `himan system setup <repo>` 与 `himan setup <repo>` 等价；`himan init` 仍可用；`source init` / `repo init` 不再提供。
- `himan resource list --installed` 提示改用 `himan project list`。
- TTY 下 `setup` 缺参逐项提示并确认后执行；非 TTY 缺参报错。

## 阶段 2.0：中央安装登记（前置）

规格把登记放在阶段 5，但 `system audit` 的全局 scope 验收依赖登记展示版本与来源，因此把写入路径前移。

1. 新增 `src/state/installed-registry-store.ts`：`~/.himan/installed.json`，条目含 scope（project/global）、projectDir、agent、type/name/version/source/mode、targetPath、updatedAt。
2. `src/services/index.ts`：`installWithSource` / `installGlobal` / `installFromLock` / `uninstall` / `uninstallGlobal` / `publish` 写路径同步登记。
3. 旧安装兼容：按 symlink 指向 store + 内容哈希启发式补识别并回填。

## 阶段 2：`system audit stats|list|issues`

1. 新增 `src/domain/audit.ts`：AuditResource、AuditIssue、AuditStats、分类（managed/unmanaged/drifted/redundant/orphan-store-cache）。
2. 新增 `src/adapters/audit/system-auditor.ts`：全局 + 当前项目扫描；识别顺序为路径约定 → `himan.yaml` / `SKILL.md` front matter → 安装证据（symlink 目标、内容哈希、中央登记）；Copilot 特殊映射；排除 `node_modules` / `.git` / 缓存。
3. 共享 lock target 缺失检查，`system doctor` 与 `system audit` 同源实现。
4. `src/cli/system-commands.ts`：注册 `audit` 三视图，`--json`、`--scope global|project|all`（默认 all）、`--agent`；无子命令默认 `stats`。
5. 测试与文档同步。

## 阶段 3：`migrate`

1. 新增私有本地 source（`src/adapters/source/local-source-adapter.ts`，配置 source type 增加 `local`；`registry` 名称保留）。
2. 流程：识别（复用 `resource-analysis`）→ 补 `himan.yaml` → 写入私有 source → 登记托管（文件可保留原位）。
3. CLI：`himan system migrate <path>`，选项 `--type`、`--agent`、`--dry-run`、`--json`。

## 阶段 4：`cleanup`

1. 输入来自 audit 分类结果，默认 `--dry-run` 预览；确认执行移入系统废纸篓而非硬删。
2. CLI：`himan system cleanup`，选项 `--scope`、`--agent`、`--dry-run`、`--json`。

## 阶段 5：agent 落位引导

1. 新增 placement 类 skill/rule 资源，说明规范位置与管理标记。
2. `create` 成功输出加落位指引。
3. 中央安装登记补全（`create` / `publish` 侧）。

## 发布收尾

- `CHANGELOG.md` `[Unreleased]` 汇总破坏性变更。
- 版本升级至 1.0.0，走 `release:dry` / `release`。
- 回归：`source` / `init` / `doctor` / 顶层生命周期命令全部可用。

## 依赖与顺序

- 阶段 1 → 2.0 → 2 → 3 → 4 → 5；阶段 3、4 依赖阶段 2 的分类结果稳定，阶段 5 依赖命令树定稿。
- 阶段 3、4 可并行，但需在 audit 分类稳定后进行。
