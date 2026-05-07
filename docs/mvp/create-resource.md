# himan `create` 命令说明（rule / command / skill）

说明「新建资源」的命令、目录与元数据约定，支撑 `create -> edit -> publish` 工作流。

---

## 1. 设计目标

- 支持三类资源：`rule`、`command`、`skill`
- 统一目录结构、`himan.yaml` 与默认入口内容
- 与 `list` / `history` / `publish` / `install` / `dev` / `uninstall` 对所有类型保持一致

**本阶段不做：** AI 生成正文、通过 Registry 在线创建、创建后自动发布。

---

## 2. 命令

```bash
himan create <type> <name> [options]
```

- `name`：kebab-case，例如 `code-review`

**常用选项：**

- `--description`：描述
- `--agent`：目标 Agent，逗号分隔；未指定时使用当前项目默认 agent、全局默认 agent，最终回退到 `cursor`
- `--entry`：入口文件名（各类型有默认值）
- `--template`：模板名；MVP 仅内置 **basic**，其它名称会报错
- `--force`：目录已存在时覆盖
- `--dry-run`：只展示将创建的内容，不写盘
- `--json`：结构化输出

**默认入口文件：**

- `rule`、`command` → `content.md`
- `skill` → `SKILL.md`

---

## 3. Source 仓库结构

Git source 仓库推荐先维护仓库级 `README.md` 和 `CHANGELOG.md`，用于说明整个资源集合的使用方式与变更历史。它们位于仓库根目录，不属于任何单个资源，也不会通过 `himan install` 安装到 agent 目录。

```text
repo/
  README.md
  CHANGELOG.md
  rules/
  commands/
  skills/
```

- `README.md`：说明 source 的用途、资源索引、安装示例、默认 agent 策略和维护约定
- `CHANGELOG.md`：记录 source 级别的新增资源、资源变更、废弃、移除和重要发布说明
- `rules/`、`commands/`、`skills/`：资源类型根目录，由 himan 扫描

可用 `himan source init-docs` 生成根目录文档模板。命令默认只创建缺失的 `README.md` / `CHANGELOG.md`；已有文件会保留，除非显式传 `--force`。`--dry-run` 只返回将执行的创建、覆盖或跳过动作，不写盘。

`create` 和 `publish` 会自动维护根目录文档：

- `README.md`：只维护 `<!-- himan:resources:start -->` / `<!-- himan:resources:end -->` 标记内的资源索引；如果旧 README 没有标记，则在文件末尾追加受控资源索引区
- `CHANGELOG.md`：向 `[Unreleased]` 写入资源变更；新增资源写入 `Added`，发布版本写入 `Changed`

推荐的 `README.md` 基本结构：

```md
# Team Himan Source

## Resources

<!-- himan:resources:start -->

- rule/code-review: Code review behavior for backend changes.
- command/create-mr: MR creation workflow.
- skill/api-debugging: API debugging workflow.

<!-- himan:resources:end -->

## Usage

\`\`\`bash
himan source add team <git_url>
himan source use team
himan install rule code-review
\`\`\`

## Maintenance

- Publish resource versions with himan publish.
- Record source-level changes in CHANGELOG.md.
```

推荐的 `CHANGELOG.md` 基本结构：

```md
# Changelog

## [Unreleased]

### Added

- Added rule/code-review.

### Changed

- Updated skill/api-debugging usage guidance.
```

## 4. 资源目录与元数据

`create` 生成资源目录，结构示例：

```text
repo/
  rules/<name>/
    himan.yaml
    content.md
  commands/<name>/
    himan.yaml
    content.md
  skills/<name>/
    himan.yaml
    SKILL.md
```

`himan.yaml` 最小字段示例：

```yaml
name: code-review
type: rule
version: 0.1.0
entry: content.md
description: enforce code review standards
agents:
  - cursor
```

- `version` 为初始占位；**正式发布版本以 Git Tag 为准**
- `agents` 来自 `--agent` 或默认 agent 解析结果

---

## 5. 流程概要

1. 读取本地配置，确认已初始化源
2. 校验类型与资源名格式
3. 解析目标路径 `rules|commands|skills/<name>`
4. 目录已存在且无 `--force` → 报错
5. 生成 `himan.yaml` 与入口模板（`--dry-run` 则不落盘）
6. 终端或 `--json` 输出结果；下一步由用户编辑再 `publish`

创建能力随源类型走同一抽象：**Git 已实现，Registry 未实现。**

---

## 6. 模板

- 当前仅 **basic**：最简结构与提示性说明
- 后续可扩展更多模板名；自定义模板目录可作为后续增强

---

## 7. 错误场景（产品语义）

- 资源目录已存在
- 模板不存在（含请求了尚未支持的模板名）
- 资源名不合法
- 不支持的资源类型
- 源未初始化或当前源不支持创建

---

## 8. 测试关注点

- 名称与类型校验、默认 entry/agents、重复创建与 `--force`、`--dry-run` 不写盘、创建后 `list` 可见

---

## 9. 与资源工作流衔接

```text
create → edit → publish
```

`create` 会在当前 Git source 缓存仓库中生成资源目录；用户编辑该目录后执行 `publish`。资源已有发布版本并安装到项目后，可再进入 `dev` 工作流：

```bash
himan create rule code-review --description "enforce standards"
himan publish rule code-review --patch
himan install rule code-review
himan dev rule code-review
# 编辑 .himan/dev/rule/code-review/
himan publish rule code-review --patch
```

创建与发布职责分离，便于审核与版本治理。
