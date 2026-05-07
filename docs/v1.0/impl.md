# himan v1.0 技术方案

本文档基于当前实现现状与 `docs/mvp/impl.md` 的设计原则，给出 v1.0 的架构、数据约定与关键流程方案。本文档中的“状态”按当前仓库实现同步维护。

> 当前行为事实源：仓库根目录 [README.md](../../README.md) 和 [Codex repo map](../codex/repo-map.md)。本文保留 v1.0 目标和缺口说明。

---

## 1. 现状基线（来自当前实现）

当前已经稳定可用：

- Git 源初始化、资源扫描、历史版本查询
- `create` / `list` / `history` / `publish` 支持 `rule`、`command`、`skill`
- `install` / `dev` / `uninstall` 已支持 `rule`、`command`、`skill`
- 版本事实来源是 Git Tag：`<type>/<name>@<semver>`
- 全局目录已形成：仓库缓存、版本 store、配置文件
- 已引入 `himan.lock`（安装写入、无参 install 复现、卸载删除条目、发布后更新锁定条目）
- 已支持基础多源管理（命名 source 的 add/use/list 与默认源切换）
- 已支持本地索引缓存（list 结果写入 `~/.himan/index.json`）
- 已支持基础发布前校验（已有 `himan.yaml` 的字段、资源类型/名称匹配、入口文件存在；缺少元数据时按默认入口推断）

当前剩余缺口（对比 v1.0 目标）：

- 发布前校验仍缺少 lint/schema 版本化等扩展治理
- PR 驱动发布路径未实现
- 多源仍是“单来源生效（default）”，尚不支持跨源同时生效与跨源聚合检索

---

## 2. v1.0 目标与边界

### 2.1 阶段 2 目标与当前状态

对齐 `docs/global/README.md` 阶段 2：

1. `command` / `skill` 安装与开发态能力（已完成）
2. lock 文件与可复现安装（已完成）
3. 多 repo 资源来源（已完成基础能力：命名源 add/use/list + default 生效）
4. 发布前校验（未完成）
5. 本地索引缓存加速检索（已完成基础能力）
6. 可选 PR 驱动发布路径（未完成）

### 2.2 非目标（v1.0 不做）

- 远程 Registry 平台化
- 组织权限、审批流、策略控制面
- AI 语义搜索与运营分析

---

## 3. 架构方案

### 3.1 分层延续（继承 MVP）

- **CLI 层**：命令入口、参数校验、输出格式
- **编排层**：生命周期流程（init/list/history/install/dev/uninstall/publish）
- **领域层**：资源模型、版本策略、安装目标策略、锁文件模型
- **配置层**：全局 source/default agent 配置、项目 default agent 配置、lock 状态
- **适配层**：Git 操作、文件系统、元数据解析、索引读写

设计原则沿用 MVP：

- store 不可变（已缓存版本不覆盖）
- 开发态与运行态分离
- 版本以 Git Tag 为唯一事实来源

### 3.2 源适配扩展

v1.0 仍以 Git 为主。在多源层面，当前已落地基础能力：

- 配置中支持多个命名源（source alias）
- 命令支持 `source add/use/list/init-docs`
- 业务命令默认读取 current/default source（单来源生效）
- `create` / `publish` 自动维护当前 Git source 根目录 `README.md` 资源索引和 `CHANGELOG.md` `[Unreleased]` 条目

下一步待补：跨源同时生效、跨源聚合索引与按命令显式指定 source（可选参数）。

---

## 4. 数据与目录约定

### 4.1 全局目录

- `~/.himan/repos/`：多源仓库缓存
- `~/.himan/store/<type>/<name>/<version>/`：不可变版本快照
- `~/.himan/config.json`：默认源与命名源列表
- `~/.himan/index.json`（可选）：当前默认源优先的索引缓存

### 4.2 项目目录

- `.himan/dev/`：开发态副本
- 运行态安装目标由 agent 和资源类型共同决定：
  - `cursor` -> `.cursor/{rules|commands|skills}/<name>`
  - `claude-code` -> `.claude/{rules|commands|skills}/<name>`
  - `codex` -> `.agents/{rules|commands|skills}/<name>`
  - `openclaw` -> `.openclaw/{rules|commands|skills}/<name>`
- 开发态目录：
  - `rule`：`.himan/dev/rule/<name>`
  - `command`：`.himan/dev/command/<name>`
  - `skill`：`.himan/dev/skill/<name>`

> 注：资源类型映射到 `rules|commands|skills`，agent 映射到对应工具目录；README 中的路径约定是当前用户文档事实源。

### 4.3 锁文件

- 项目根新增 `himan.lock`
- 记录：source alias、source 类型、repo/repoId、资源类型、资源名、精确版本、agent、安装模式、更新时间
- 行为：
  - 显式 install 写入/更新当前 default source 信息
  - 无参数 install 使用 lock 中记录的 source 批量恢复，不依赖当前 default source
  - uninstall 删除条目
  - publish 后用新版本以 copy 模式重新安装当前资源、更新 lock，并退出 dev mode

---

## 5. 资源与元数据模型

v1.0 在 MVP 基础上扩展 `himan.yaml` 字段治理：

- 必填：`name`、`type`、`version`、`entry`
- 推荐：`description`、`agents`、`tags`
- 校验分层：
  1. 读取时最小校验（不中断全量扫描）
  2. 发布前严格校验（阻断不合法发布）

兼容策略：

- 对旧资源缺少非必填字段保持向后兼容
- 新增字段均按可选处理，不破坏现有资源

---

## 6. 命令与流程设计

### 6.1 `install`

v1.0 统一支持三类资源：

- 解析版本：优先显式版本，其次历史最新
- store 复用：已存在版本直接复用，不重复导出
- 项目引用：按类型创建目标到对应目录，支持软链或复制
- lock 联动：写入当前安装状态
- 无参数安装：`himan install` 从 `himan.lock` 记录的 source 和版本批量复现安装

### 6.2 `dev`

- 从当前安装版本复制到 `.himan/dev` 对应位置
- 项目引用切换到 dev 副本
- 重复执行保持幂等（目录已存在默认不覆盖）

### 6.3 `uninstall`

- 删除项目侧引用（不删除 store 历史）
- 清理 lock 对应条目
- 未安装时返回可诊断错误

### 6.4 `publish`

发布源优先级：dev 副本 > 源仓库资源目录。

发布流程：

1. preflight：工作区状态、元数据校验、入口存在性校验
2. 变更检测：无变更则拒绝发布（或提示）
3. 版本计算：按 patch/minor/major 递增
4. 写回源仓库并提交、打 tag、推送
5. 同步新版本到 store
6. 若当前项目安装该资源，则更新项目引用
7. 若该资源存在于 lock，则同步更新 lock 中版本

可选扩展：PR 驱动发布（生成分支与 PR，而非直接推送主分支）。

---

## 7. 索引与检索方案

### 7.1 目标

降低多 repo 下的 `list` 与检索成本。

### 7.2 方案

- 维护本地聚合索引（资源基础元数据 + 最新版本摘要）
- 触发更新时机：init/fetch 后、publish 后
- 失效策略：源更新后增量重建；异常可全量重建

当前落地（基础版）：
- list 时优先读取 `~/.himan/index.json`
- 缓存按资源目录下 `himan.yaml` 内容 hash 失效，失效后回退仓库扫描并写回 index

### 7.3 降级策略

索引不可用时回退到仓库扫描，保证功能可用优先。

---

## 8. 兼容性与迁移

- 对现有项目：保持 `rule` 路径与行为不变
- 对旧配置：自动迁移到“default source + sources 列表”结构
- 对无 lock 项目：首次 install 自动创建 lock
- 对旧资源目录：继续支持现有 `rules/commands/skills` 结构

---

## 9. 测试方案

### 9.1 自动化测试

- 单元：版本解析、元数据校验、锁文件读写、路径策略
- 集成：
  - 三类型 install/dev/uninstall/publish 全链路
  - 命名 source 的 add/use/list，以及 default source 下的 list/install
  - 发布前校验失败分支（无变更、元数据错误、入口缺失）

### 9.2 手动验证

- 真远端权限/网络异常
- 不同平台软链行为（Windows 单独标注）

---

## 10. 实施里程碑（回顾）

- **M1**：元数据扩展 + uninstall + preflight 基础（已完成基础能力）
- **M2**：command/skill install/dev 全链路（已完成）
- **M3**：lock 文件 + 多 repo + 本地索引（已完成基础能力）
- **M4**：PR 发布可选能力 + 文档与发布收口（进行中）

当前建议：将扩展 preflight（lint/schema 版本化）与 PR 发布作为 `v1.0.x` 收口项，并在发行说明中明确状态。

---

## 11. 验收标准

v1.0 验收通过需满足（按当前范围）：

1. 已完成能力稳定可用（至少含：三类型闭环、lock、多源 default 生效、索引基础能力）
2. 自动化测试覆盖主路径并稳定通过
3. 文档与 CLI 行为一致，错误信息可诊断
4. 对现有 rule 用户无破坏性回归
