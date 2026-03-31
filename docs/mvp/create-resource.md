# himan `create` 命令实现说明（rule / command / skill）

本文档说明“新建资源”能力的命令、数据结构和实现方案。该能力在 MVP 中已落地，用于标准化 `create -> edit -> publish` 工作流。

---

## 1. 设计目标

- 支持快速创建三类资源：`rule`、`command`、`skill`
- 统一生成目录结构、`himan.yaml` 元数据和默认内容模板
- 保持与现有 `list/history/install/dev/publish` 流程兼容
- 与现有存储源适配层一致（Git 先实现，Registry 预留）

非目标（本阶段不做）：
- AI 自动生成资源内容
- 远程 Registry 直接建资源
- 资源发布自动化（创建后自动 commit/tag/push）

---

## 2. 命令设计

主命令：

```bash
himan create <type> <name> [options]
```

类型：
- `type`: `rule | command | skill`

参数：
- `name`: 资源名（kebab-case，例：`code-review`）

选项：
- `--description <text>`：资源描述
- `--target <list>`：目标平台，逗号分隔（默认 `cursor`）
- `--entry <file>`：入口文件名（按类型有默认值）
- `--template <name>`：模板名（默认 `basic`）
- `--force`：目标目录已存在时覆盖
- `--json`：JSON 输出结果
- `--dry-run`：仅展示将创建的文件，不落盘

默认入口文件：
- `rule` -> `content.md`
- `command` -> `content.md`
- `skill` -> `SKILL.md`

---

## 3. 资源目录规范

创建后的仓库结构：

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

`himan.yaml` 最小字段：

```yaml
name: code-review
type: rule
version: 0.1.0
entry: content.md
description: enforce code review standards
targets:
  - cursor
```

说明：
- `version` 为资源初始版本（未发布态），正式版本仍以 Git Tag 为准
- `targets` 由 `--target` 解析，未指定时默认 `["cursor"]`

---

## 4. 技术实现方案

## 4.1 分层职责

- CLI 层
  - 解析 `create` 参数
  - 校验 `type/name/options`
  - 输出标准化结果

- Service 层（`CreateService`）
  - 解析目标仓库（当前 source 配置）
  - 执行创建流程编排
  - 处理冲突策略（存在目录 / force / dry-run）

- Adapter 层
  - `ResourceSourceAdapter` 增加创建抽象：
    - `create(type, name, options): Promise<CreateResult>`
  - `GitSourceAdapter` 实现实际文件落盘
  - `RegistrySourceAdapter` 保持 `NOT_IMPLEMENTED`

- Domain 层
  - `CreateOptions` / `CreateResult` / `ResourceTemplate`
  - 类型到目录映射、默认 entry 映射

---

## 4.2 关键流程

1. 读取 `~/.himan/config.json`，确认 source 可用  
2. 校验参数：
   - `type` 必须为 `rule|command|skill`
   - `name` 必须匹配 `^[a-z0-9]+(?:-[a-z0-9]+)*$`
3. 计算资源路径：
   - `rules/<name>` / `commands/<name>` / `skills/<name>`
4. 冲突检查：
   - 已存在且无 `--force` -> 报错
5. 渲染模板：
   - 生成 `himan.yaml`
   - 生成 entry 文件内容
6. 输出结果：
   - 人类可读输出 + `--json`
   - 返回下一步建议（编辑 -> publish）

---

## 4.3 模板策略

内置模板（MVP）：
- `basic`：最简模板，包含结构和提示注释

后续扩展：
- `strict-review`
- `frontend-command`
- `analysis-skill`

模板加载优先级（建议）：
1. 用户自定义模板目录（可选）
2. 内置模板

---

## 5. 接口草案

`ResourceSourceAdapter` 扩展：

```ts
create(
  type: ResourceType,
  name: string,
  options: CreateOptions
): Promise<CreateResult>
```

数据结构建议：

```ts
type ResourceType = "rule" | "command" | "skill";

interface CreateOptions {
  description?: string;
  targets?: string[];
  entry?: string;
  template?: string;
  force?: boolean;
  dryRun?: boolean;
}

interface CreateResult {
  type: ResourceType;
  name: string;
  resourceDir: string;
  files: string[];
  dryRun: boolean;
}
```

---

## 6. 错误模型

新增错误码建议：
- `E_RESOURCE_EXISTS`：资源目录已存在
- `E_TEMPLATE_NOT_FOUND`：模板不存在
- `E_INVALID_RESOURCE_NAME`：资源名非法
- `E_UNSUPPORTED_RESOURCE_TYPE`：资源类型不支持

---

## 7. 测试策略

单元测试：
- 名称校验
- 类型到目录映射
- 默认 entry/targets 逻辑
- `--target` 解析（逗号分隔）

集成测试：
- `create rule` 成功落盘
- `create command/skill` 成功落盘
- 重复创建报错 / `--force` 覆盖
- `--dry-run` 不落盘
- 创建后 `list` 可见（对应类型）

---

## 8. 与现有流程衔接

建议用户工作流：

```text
create -> edit -> publish
```

示例：

```bash
himan create rule code-review --description "enforce standards"
himan dev rule code-review
# 编辑内容
himan publish rule code-review --patch
```

该设计确保“资源创建”与“版本发布”职责分离，便于团队治理与审核。
