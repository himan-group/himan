# himan MVP 详细技术实现方案

本文档从**行为与技术选型**说明 MVP 如何实现，不绑定具体源码文件或符号名。

---

## 1. 技术栈与原则

- TypeScript，运行于 Node.js LTS
- CLI 解析、Git 封装、YAML 解析、Semver、基于 Promise 的文件与软链操作

**原则：**

- 本地 store 按版本存放，已存在的版本目录不被覆盖（安装时复用缓存）
- 开发目录 `.himan/dev` 与运行态 `.cursor/rules` 分离
- 正式发布版本以 **Git Tag** 为唯一事实来源；`himan.yaml` 中的 version 在发布时会与 tag 对齐

---

## 2. 功能到实现要点

### 2.1 `init <git_repo>`

- 确保全局目录（缓存仓库、store、配置）存在
- 由仓库 URL 推导稳定 id，首次克隆、后续拉取（含 tags）
- 写入本地配置：当前源为 Git、仓库地址与 id
- CLI 仅提供「Git URL」初始化；Registry 类型虽可在配置中预留，但尚无可用实现

### 2.2 `list [type]`

- 在缓存仓库内按类型扫描子目录，读取 `himan.yaml`
- 校验类型与必填字段（如 name、entry），不符的目录跳过
- 支持人类可读与 `--json` 输出

### 2.3 `history <type> <name>`

- 列出匹配 `<type>/<name>@*` 的 tag，解析 semver，非法 tag 忽略
- 按版本倒序输出

### 2.4 `install rule <name>[@version]`

- 命令层仅接受 `rule`
- 无版本则取该资源历史中的最新 semver
- 若本地 store 已有该版本目录则不再从 Git 导出；否则从对应 tag 导出资源树到 store
- 在项目中创建/更新软链，指向 store 中该版本

### 2.5 `dev rule <name>`

- 命令层仅接受 `rule`；依赖已安装（能解析当前软链目标）
- 将当前安装内容复制到 `.himan/dev/rule/<name>`（目录已存在则默认不覆盖）
- 软链改为指向 dev 目录

### 2.6 `publish <type> <name>`

- 发布源：优先项目 `.himan/dev/<type>/<name>`，否则缓存仓库内该资源目录
- 下一版本：基于历史最新 tag；无历史则从 `0.0.0` 按 patch/minor/major 递增
- 将内容同步回缓存仓库中的规范路径，更新元数据中的版本字段，提交、打 tag、推送
- 将新 tag 对应内容拉取到 store 新版本目录
- 仅 **rule** 同时更新项目内 `.cursor/rules` 软链；command/skill 不操作项目软链

### 2.7 `create <type> <name>`

- 校验类型与资源命名规则
- 在缓存仓库中创建 `rules|commands|skills/<name>` 及 `himan.yaml`、入口模板
- 支持覆盖、试运行、JSON 输出；创建后不自动发布

---

## 3. 架构：源适配与编排

为避免上层与「一定是 Git」强耦合：

- 抽象一层 **资源源**：初始化、列表、历史、按版本拉取内容、发布、创建
- **Git** 为当前唯一完整实现
- **Registry** 为占位：调用即提示未实现，二期对接 API 与下载/上传

编排层负责：解析配置选择源、rule 的 store 路径、dev 拷贝、`.cursor/rules` 软链；与具体 Git 子命令细节隔离。

配置中可区分源类型并预留 Registry 所需字段（如 endpoint）；当前 CLI 初始化路径只写入 Git 源。

---

## 4. 其他实现注意点

- 全局路径与用户主目录约定一致，避免魔法字符串散落
- 错误应能区分：未初始化、资源不存在、版本不存在、模板不支持、重复创建等
- 幂等与重试：安装、dev、发布在合理重复执行下行为可预期
- 平台：优先保证 macOS/Linux；Windows 软链与路径差异可后续单独验证

---

## 5. 测试

- 运行仓库内测试脚本（如 `pnpm test`），包含单元场景与 CLI 端到端场景（临时 HOME、本地裸仓库模拟远端等）
- 仍建议补充：真实网络失败、Windows、并发安装等

---

## 6. 文档与示例

- 命令参数与快速上手以根 README 为准
- 创建资源字段与目录约定见 [create-resource.md](./create-resource.md)
