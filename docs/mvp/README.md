# himan MVP 功能点与技术设计

## 1. MVP 目标

在 1 周内交付一个可实际使用的最小版本，完成 `rule` 资产的管理与发布闭环。

MVP 只覆盖：
- 单 repo
- 仅 `rule`
- 本地 CLI
- Git Tag 资源级版本

MVP 不覆盖：
- `command` / `skill`
- 多 repo
- 远程 registry
- AI 搜索
- PR 自动化发布

---

## 2. MVP 功能清单

### 2.1 `init`

命令：
- `himan init <git_repo>`

行为：
- clone 远程仓库到 `~/.himan/repos/<repo-id>`
- 建立本地元信息（默认仓库、基础目录）

---

### 2.2 `list`

命令：
- `himan list rule`
- `himan list --json`（可选增强）

行为：
- 扫描 repo 中 `rules/*/himan.yaml`
- 返回资源名、描述、目标平台、当前可用版本

---

### 2.3 `history`

命令：
- `himan history rule <name>`

行为：
- 读取并过滤 tag：`rule/<name>@*`
- 按 semver 排序输出历史版本

---

### 2.4 `install`

命令：
- `himan install rule <name>`
- `himan install rule <name>@<version>`

行为：
- 若未指定版本，默认安装最新稳定版本
- 从 repo 导出对应版本资源到 store
- 创建项目软链：`.cursor/rules/<name> -> ~/.himan/store/...`

---

### 2.5 `dev`

命令：
- `himan dev rule <name>`

行为：
- 将已安装版本复制到 `project/.himan/dev/<name>`
- 项目软链切换到 dev 目录
- 支持本地可编辑调试

---

### 2.6 `publish`

命令：
- `himan publish rule <name> --patch|--minor|--major`

行为：
- diff 检测 dev 与 repo 差异
- 按 semver 计算新版本
- 回写 repo、commit、tag、push
- 同步新版本至本地 store
- 项目软链切回新发布版本

---

### 2.7 `create`（设计中）

命令（规划）：
- `himan create <type> <name> [options]`

目标：
- 支持创建 `rule/command/skill` 资源骨架
- 标准化生成 `himan.yaml` 与模板文件
- 衔接后续 `publish` 流程

---

## 3. MVP 技术架构

### 3.1 分层结构

- CLI 层：命令解析、参数校验、输出格式化
- Service 层：`InitService`、`InstallService`、`PublishService` 等
- Domain 层：资源模型、版本策略、路径策略
- Infra 层：Git/Fs/Semver/Yaml 适配器

设计原则：
- store 不可变
- 开发态与运行态分离
- 项目目录只保留引用（软链）

---

### 3.2 目录与数据结构

全局目录：
- `~/.himan/repos`：仓库缓存
- `~/.himan/store/rule/<name>/<version>`：不可变版本缓存

项目目录：
- `.cursor/rules`：运行态软链
- `.himan/dev`：开发态可编辑目录

资源目录约定：
- `rules/<name>/himan.yaml`
- `rules/<name>/content.md`

---

### 3.3 核心技术点

- Git：clone/fetch/tag/archive/push
- Semver：版本计算与排序
- YAML：资源元数据解析和校验
- Symbolic Link：安装与切换
- Diff：发布前变更检测

详细实现请参考：
- [MVP 详细技术实现方案](./impl.md)
- [资源创建命令技术设计](./create-resource.md)

---

## 4. MVP 非功能要求

- 幂等：重复执行 `install/dev` 不破坏状态
- 可恢复：发布失败后可重新执行，不遗留半状态
- 可诊断：错误信息清晰（repo、tag、路径、权限）
- 可测试：关键流程具备最小集成测试

---

## 5. MVP 测试策略

最小测试集：
- 版本解析：tag 过滤、排序、next version 计算
- 安装流程：latest 与指定版本安装
- dev 流程：软链切换与本地编辑可见
- publish 流程：commit/tag/store 同步正确
- 异常流程：版本不存在、仓库不可达、工作区脏

---

## 6. MVP 交付标准

- 命令可执行且帮助信息完整
- 主流程可在真实项目中成功运行
- 有基础文档（快速开始 + 常见错误）
- 具备向阶段 2 扩展的数据与接口基础
