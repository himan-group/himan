# himan v1.0 版本规划（简版）

本版本按 [全周期路线图](../global/README.md) 的「阶段 2：增强版」收敛，目标是在 Git 模式下提升可复现能力与发布稳定性。

执行顺序与分工见 [impl.md](./impl.md)。

---

## 1. v1.0 目标

- 支持 `rule / command / skill` 三类资源的统一管理
- 提供可复现安装与更稳定的发布流程
- 支持多来源资产的统一检索与安装

---

## 2. 核心范围（来自阶段 2）

1. `command` / `skill` 类型能力补齐（与 `rule` 一致的主流程）
2. lock 文件（项目依赖快照）
3. 多 repo 管理（多来源）
4. 发布前校验（lint / schema / 兼容性检查）
5. PR 驱动发布（可选）
6. 本地索引缓存（如 `index.json`）

### 当前进展（已实现）

- 已完成：`command` / `skill` 的 `install` / `dev` / `publish` / `uninstall` 主流程
- 已完成：`himan.lock` 基础能力
  - `install <type> <name[@version]>` 自动写入/更新 lock
  - `install`（无参数）按 lock 批量复现安装
  - `uninstall` 删除项目链接并同步移除 lock 条目
  - `publish` 在资源已锁定时同步更新 lock 版本
- 待完成：多 repo、发布前校验、本地索引、PR 驱动发布

---

## 3. v1.0 命令面（冻结目标）

- 基础：`init`、`list`、`history`、`create`
- 生命周期：`install`、`dev`、`uninstall`、`publish`
- 发布能力：`publish` 集成 preflight 校验；PR 发布可选
- 可复现能力：安装与卸载可与 lock 联动

---

## 4. 不在 v1.0 范围

- 远程 Registry 平台
- 组织权限与审批流
- AI 搜索与运营分析

以上属于路线图后续阶段。

---

## 5. 约定与交付

- 数据与路径约定：
  - 全局目录：`~/.himan/repos`、`~/.himan/store`、`~/.himan/config.json`
  - 项目目录：`.himan/dev`（安装目标路径在实现前冻结）
- 交付要求：
  - 主流程可跑通（含三类型）
  - 自动化测试覆盖关键路径
  - 文档与行为一致

---

## 6. 验收标准

- 阶段 2 的 6 项核心能力全部落地，或在发行说明中明确延后到 `v1.0.x`
- 发布流程具备可诊断错误信息与失败恢复路径
- 多来源安装与版本锁定可用于团队复现
