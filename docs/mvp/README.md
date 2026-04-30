# himan MVP 功能点与技术设计

## 1. MVP 目标

在 1 周内交付一个可实际使用的最小版本，完成资源资产的管理与发布闭环。

**当前实现范围：**
- 单一默认源：Git（`himan init <git_repo>`，本地缓存仓库并写配置）
- 本地 CLI，命令说明见仓库根目录 [README.md](../../README.md)
- 资源版本以 Git Tag 为准，格式 `<type>/<name>@<semver>`
- 资源类型能力：
- `rule`：`create` / `list` / `history` / `install` / `dev` / `publish` / `uninstall`
- `command`：`create` / `list` / `history` / `install` / `dev` / `publish` / `uninstall`
- `skill`：`create` / `list` / `history` / `install` / `dev` / `publish` / `uninstall`
- 远程 Registry 源：仅占位，二期实现

**不包含：** 可用 Registry、AI 搜索、PR 自动发布。

---

## 2. MVP 功能清单

### 2.1 `init`

- `himan init <git_repo>`
- 克隆或更新远程仓库到用户目录下的缓存路径，并记录默认源配置。

### 2.2 `list`

- `himan list [type]`，`--json` 可选
- 扫描源仓库中各类型目录下的 `himan.yaml`，返回名称、描述、目标平台、入口文件等。

### 2.3 `history`

- `himan history <type> <name>`
- 按 tag 模式 `<type>/<name>@*` 列出历史，semver 合法项排序输出。

### 2.4 `install`

- `himan install <type> <name>` 或 `<name>@version`，`type` 支持 `rule|command|skill`
- 也支持 `himan install`（无参数）按 `himan.lock` 批量复现安装。
- 未指定版本则安装该资源最新 tag 对应版本。
- 若本地 store 中已有该版本缓存，则复用、不重新从 Git 导出；否则导出到 store。
- 在项目下按安装模式创建目标（默认 `--mode link` 软链；`--mode copy` 复制）：
  - `rule`：`.cursor/rules/<name>`
  - `command`：`.cursor/commands/<name>`
  - `skill`：`.cursor/skills/<name>`

### 2.5 `dev`

- `himan dev <type> <name>`，`type` 支持 `rule|command|skill`；需先 `install`。
- 将当前安装内容复制到项目开发目录（已存在则默认不覆盖），再按安装模式更新项目目标：
  - `rule`：`.himan/dev/rule/<name>`
  - `command`：`.himan/dev/command/<name>`
  - `skill`：`.himan/dev/skill/<name>`

### 2.6 `publish`

- `himan publish <type> <name> --patch|--minor|--major`（默认 patch，三选一）
- 发布内容优先取项目 `.himan/dev/<type>/<name>`，否则取源仓库内对应资源目录。
- 新版本：基于已有 tag 最新 semver 递增；无任何历史时从 `0.0.0` 起算。
- 写回源仓库、提交、打 tag、推送，并将该版本同步到本地 store。
- 若该资源在项目中已有安装目标，会按 lock 中的安装模式同步到新版本目录。

### 2.7 `create`

- `himan create <type> <name>` 及常用选项（描述、目标平台、dry-run、force、json 等）
- 生成 `rule` / `command` / `skill` 标准目录与 `himan.yaml`、入口模板
- 与 `publish` 衔接：`create → 编辑 → publish`

### 2.8 `agent`

- `himan agent list` 查看支持的 agent。
- `himan agent use <agent[,agent]>` 设置当前项目默认 agent；加 `--global` 设置全局默认 agent。
- `himan agent current` 查看当前项目、全局和最终生效的默认 agent。
- `himan agent clear` 清除默认 agent 配置；默认清除当前项目，加 `--global` 清除全局配置。
- 默认 agent 解析顺序：显式 `--agent` > 当前项目配置 > 全局配置 > 资源 metadata > `cursor`。

---

## 3. MVP 技术架构

### 3.1 分层（概念）

- **CLI**：解析参数、格式化输出、帮助与错误信息
- **编排**：初始化源、列表、历史、安装、开发态、发布、创建等资源生命周期
- **领域**：资源类型、版本、路径约定
- **适配**：Git 实现 + Registry 预留；扫描与解析元数据；版本计算；配置与全局路径

**原则：** store 按版本目录追加、不覆盖已有缓存；开发目录与项目安装目标分离；项目侧默认以软链引用资源，也支持复制。

### 3.2 目录与数据

**用户目录（如 `~/.himan`）：**
- `repos/…`：Git 源缓存
- `store/<type>/<name>/<version>/`：按版本的资源快照
- `config.json`：当前源类型（git / registry 预留）、仓库地址、全局默认 agent 等

**项目目录：**
- `.cursor/rules/<name>`：rule 运行态目标（软链或副本）
- `.himan/config.json`：项目默认 agent 配置
- `.himan/dev/rule/<name>`：rule 开发态可编辑副本

**源仓库内资源布局：**
- `rules/<name>/`、`commands/<name>/`、`skills/<name>/`，各含 `himan.yaml` 与约定入口文件（如 `content.md`、`SKILL.md`）。

### 3.3 技术依赖（概要）

- Git：克隆、拉取、tag、按 tag 导出目录、提交与推送
- Semver：排序与下一版本计算
- YAML：资源元数据
- 文件系统：目录复制、符号链接

更细的实现说明见 [impl.md](./impl.md)；创建资源见 [create-resource.md](./create-resource.md)。

---

## 4. 非功能要求

- 幂等：`install` / `dev` 重复执行不破坏合理预期状态
- 可恢复：发布失败可重试，不依赖未文档化的中间态
- 可诊断：错误信息能指向仓库、tag、路径或权限问题
- 可测试：主流程有自动化测试覆盖

---

## 5. 测试策略

- 自动化测试覆盖：版本解析、元数据扫描、配置、以及 CLI 主流程（含临时用户目录与模拟 Git 远端）。
- 建议人工补充：真实网络 clone、鉴权失败、推送拒绝、脏工作区等。

---

## 6. 交付标准

- 命令可执行，帮助信息完整
- 主流程在自动化测试中可回归
- 用户文档（根 README）与本 MVP 文档一致
- 配置与适配层为二期 Registry 预留扩展空间
