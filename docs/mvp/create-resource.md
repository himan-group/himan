# himan `create` 命令说明（rule / command / skill）

说明「新建资源」的命令、目录与元数据约定，支撑 `create -> edit -> publish` 工作流。

---

## 1. 设计目标

- 支持三类资源：`rule`、`command`、`skill`
- 统一目录结构、`himan.yaml` 与默认入口内容
- 与 `list` / `history` / `publish` 对所有类型一致；**仅 rule** 另有 `install` / `dev`

**本阶段不做：** AI 生成正文、通过 Registry 在线创建、创建后自动发布。

---

## 2. 命令

```bash
himan create <type> <name> [options]
```

- `name`：kebab-case，例如 `code-review`

**常用选项：**

- `--description`：描述
- `--target`：目标平台，逗号分隔；未指定时默认包含 `cursor`
- `--entry`：入口文件名（各类型有默认值）
- `--template`：模板名；MVP 仅内置 **basic**，其它名称会报错
- `--force`：目录已存在时覆盖
- `--dry-run`：只展示将创建的内容，不写盘
- `--json`：结构化输出

**默认入口文件：**

- `rule`、`command` → `content.md`
- `skill` → `SKILL.md`

---

## 3. 资源目录与元数据

创建后的仓库结构示例：

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
targets:
  - cursor
```

- `version` 为初始占位；**正式发布版本以 Git Tag 为准**
- `targets` 来自 `--target`，未传时使用默认列表

---

## 4. 流程概要

1. 读取本地配置，确认已初始化源
2. 校验类型与资源名格式
3. 解析目标路径 `rules|commands|skills/<name>`
4. 目录已存在且无 `--force` → 报错
5. 生成 `himan.yaml` 与入口模板（`--dry-run` 则不落盘）
6. 终端或 `--json` 输出结果；下一步由用户编辑再 `publish`

创建能力随源类型走同一抽象：**Git 已实现，Registry 未实现。**

---

## 5. 模板

- 当前仅 **basic**：最简结构与提示性说明
- 后续可扩展更多模板名；自定义模板目录可作为后续增强

---

## 6. 错误场景（产品语义）

- 资源目录已存在
- 模板不存在（含请求了尚未支持的模板名）
- 资源名不合法
- 不支持的资源类型
- 源未初始化或当前源不支持创建

---

## 7. 测试关注点

- 名称与类型校验、默认 entry/targets、重复创建与 `--force`、`--dry-run` 不写盘、创建后 `list` 可见

---

## 8. 与 rule 工作流衔接

```text
create → edit → publish
```

rule 常见路径还可插入 `dev`：

```bash
himan create rule code-review --description "enforce standards"
himan dev rule code-review
# 编辑 .himan/dev/code-review/
himan publish rule code-review --patch
```

创建与发布职责分离，便于审核与版本治理。
