# himan MVP 详细技术实现方案

本文档描述 MVP 阶段每个功能点通过什么技术实现，以及关键模块与实现细节。

---

## 1. 技术栈与实现原则

技术栈：
- TypeScript + Node.js LTS
- `commander`：CLI 命令解析
- `simple-git`：Git 操作封装
- `yaml`：资源元数据解析
- `semver`：版本计算与排序
- `fs/promises`：文件、目录、软链处理

实现原则：
- `~/.himan/store` 必须不可变（immutable）
- 开发态（`.himan/dev`）与运行态（`.cursor/rules`）分离
- 项目目录只保留引用，不复制发布态资源
- 版本唯一事实来源是 Git Tag

---

## 2. 功能到技术映射

### 2.1 `himan init <git_repo>`

目标：
- 初始化本地仓库缓存与基础配置

实现：
- 规范化 `repo-id`（由 URL 推导）
- `simple-git.clone(repo, ~/.himan/repos/<repo-id>)`
- 若目录已存在，则执行 `git fetch --tags`
- 写入 `~/.himan/config.json`（默认仓库、更新时间等）

关键点：
- 初始化过程幂等
- 对网络不可达、鉴权失败提供明确错误码

---

### 2.2 `himan list rule`

目标：
- 列出可用 rule 资源

实现：
- 扫描 `<repo>/rules/*/himan.yaml`
- 解析字段：`name/type/version/entry/targets/description`
- 过滤 `type=rule`
- 支持标准输出与 `--json`

关键点：
- 对 `himan.yaml` 做 schema 校验
- 无效资源跳过并输出 warning

---

### 2.3 `himan history rule <name>`

目标：
- 查询 rule 历史版本

实现：
- 执行 `git tag --list "rule/<name>@*"`
- 通过正则提取版本号
- 使用 `semver.valid` 过滤合法版本
- 使用 `semver.rsort` 倒序输出

关键点：
- 忽略非法 tag，不影响主流程
- 空历史返回友好提示

---

### 2.4 `himan install rule <name>[@version]`

目标：
- 安装指定版本或最新版本 rule 并在项目生效

实现：
1. 解析目标版本（无版本时取历史最新）
2. 用 `git archive <tag> rules/<name>` 导出资源目录
3. 写入 `~/.himan/store/rule/<name>/<version>`
4. 创建软链 `.cursor/rules/<name> -> store/...`

关键点：
- store 目录已存在时进行校验后复用
- 软链采用原子替换，避免中间态

---

### 2.5 `himan dev rule <name>`

目标：
- 切换到可编辑开发态

实现：
- 从当前安装版本复制到 `.himan/dev/<name>`
- 更新软链 `.cursor/rules/<name> -> .himan/dev/<name>`

关键点：
- dev 目录已存在默认不覆盖
- 通过状态文件记录当前引用来源（store/dev）

---

### 2.6 `himan publish rule <name> --patch|--minor|--major`

目标：
- 将 dev 变更发布为新版本并同步本地安装态

实现：
1. preflight：检查 repo 状态、dev 目录、工作区条件
2. diff：比较 `.himan/dev/<name>` 与 `rules/<name>`
3. 版本：取最新 tag，`semver.inc` 计算 next version
4. 回写：用 dev 内容覆盖 repo 目标资源
5. Git：`add`、`commit`、`tag rule/<name>@<version>`、`push --tags`
6. 同步：写入 store 新版本并切换项目软链

关键点：
- 同版本发布直接拒绝
- 发布失败可重试，不破坏已有 store 版本

---

### 2.7 `himan create <type> <name> [options]`（设计中）

目标：
- 新建 `rule/command/skill` 资源骨架，统一结构与元数据

实现要点：
1. 参数校验（`type/name/options`）
2. 解析目标路径（`rules|commands|skills/<name>`）
3. 生成 `himan.yaml` 与 entry 模板文件
4. 冲突处理（`--force`）与试运行（`--dry-run`）
5. 输出可追踪结果（`--json`）

关键点：
- 与 `ResourceSourceAdapter` 对齐，Git 先实现、Registry 预留
- 创建后不自动发布，遵循 `create -> edit -> publish` 工作流

---

## 3. 模块设计

建议模块：
- `RepoManager`：clone、fetch、tag、archive、push
- `ResourceScanner`：扫描与解析资源元数据
- `VersionResolver`：历史版本、最新版本、next version
- `Installer`：store 写入与软链管理
- `DevWorkspace`：dev 拷贝、状态切换
- `Publisher`：发布流程编排（含 preflight 与补偿）
- `StateStore`：配置与项目状态读写

### 3.1 存储源适配层（兼容 Git 与未来 Registry）

为避免业务层直接依赖 Git 命令语义，MVP 阶段引入统一的资源源接口：

- `ResourceSourceAdapter`（统一抽象）
  - `init(sourceConfig): Promise<void>`
  - `list(type): Promise<ResourceMeta[]>`
  - `history(type, name): Promise<VersionInfo[]>`
  - `pull(type, name, version, targetDir): Promise<void>`
  - `publish(type, name, version, sourceDir, options): Promise<PublishResult>`

- `GitSourceAdapter`（当前默认实现）
  - 内部复用 `RepoManager`、`ResourceScanner`、`VersionResolver`
  - `history` 对应 Git Tag（`rule/<name>@<version>`）
  - `pull` 对应 `git archive` 导出资源
  - `publish` 对应 commit/tag/push 流程

- `RegistrySourceAdapter`（未来实现，MVP 预留）
  - `history/list` 对接 registry API
  - `pull` 对接包下载或内容拉取接口
  - `publish` 对接上传、版本登记与权限校验

业务层调用规则：
- `InitService/ListService/InstallService/PublishService` 只依赖 `ResourceSourceAdapter`
- 通过配置选择实现（默认 `git`，后续可切换 `registry`）
- `store`、`dev`、软链逻辑保持不变，仅替换“资源来源”

最小配置建议：
- `~/.himan/config.json` 增加 `source.type` 字段
  - `source.type = "git"`（MVP 默认）
  - `source.type = "registry"`（二期启用）

这样可以保证：
- MVP 快速落地，不增加过多实现成本
- 二期接入 registry 时无需重写命令层与安装/开发工作流

与 `create` 的关系：
- `create` 同样应通过 `ResourceSourceAdapter` 抽象实现
- Git/Registry 切换时，命令层无需改动，仅替换适配器实现

---

## 4. 关键实现细节

- 路径统一：集中在 `PathResolver`，避免路径散落
- 错误模型：定义错误码（例如 `E_TAG_NOT_FOUND`、`E_SCHEMA_INVALID`）
- 幂等策略：重复执行 `install/dev` 不破坏既有状态
- 失败恢复：流程中断后支持继续重试
- 平台策略：MVP 明确支持 macOS/Linux，Windows 后续扩展

---

## 5. 测试建议（围绕实现）

- 单元测试：
  - tag 解析与 semver 计算
  - 元数据校验与路径解析
- 集成测试：
  - `init/list/history/install/dev/publish` 全链路
  - 异常场景：tag 不存在、仓库不可达、软链冲突、权限不足

---

## 6. 实施输出物

MVP 实现阶段建议同步产出：
- 命令级接口定义（参数、返回、错误）
- 模块依赖图（Service/Domain/Infra）
- 最小可运行示例仓库
- 回归测试清单与结果记录

补充设计文档：
- [资源创建命令技术设计](./create-resource.md)
