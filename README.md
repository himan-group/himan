# himan

himan（含义为"Hey, man"），AI Coding 时代的 Prompt / Agent 资产管理系统（CLI + Git source）

## 环境要求

- Node.js 22.x；本仓库开发环境由 [.nvmrc](./.nvmrc) 固定为 `22.22.1`。
- Git；Git source 的初始化、版本查询、安装和发布都依赖本机 Git。

## 安装与运行

### 使用 npm 包

全局安装后可直接使用 `himan`：

```bash
npm install -g @hi-man/himan
himan --help
```

也可以一次性运行主入口：

```bash
npx @hi-man/himan --help
pnpm dlx @hi-man/himan --help
```

### 命令入口

包内提供四个 CLI 入口：

- `himan <子命令>`（主入口）
- `himan-source <子命令>`（source 相关）
- `himan-resource <子命令>`（resource/project 相关）
- `himan-project <子命令>`（project 相关）

下文默认使用 `himan` 主入口；三个专用入口在对应章节单独列出。

## 一分钟上手

以下示例假设你已有一个可访问的 himan Git source 仓库，仓库中存在 `my-rule` 的资源版本 tag，并且你拥有发布所需的 Git push 权限。

```bash
himan init https://github.com/your-org/your-himan-registry.git
himan list rule
himan agent use codex
himan install rule my-rule
himan dev rule my-rule
# 编辑项目下 .himan/dev/rule/my-rule/
himan publish rule my-rule --patch
```

- **rule / command / skill**：都支持 `create`、`list`、`history`、`install`、`dev`、`publish`、`uninstall`。
- 安装后项目目标位置（按 `agents`，默认 `cursor`）：
  - `cursor` -> `.cursor/{rules|commands|skills}/<name>`
  - `claude-code` -> `.claude/{rules|commands|skills}/<name>`
  - `codex` -> `.agents/{rules|commands|skills}/<name>`
  - `openclaw` -> `.openclaw/{rules|commands|skills}/<name>`
- 开发态目录：
  - `rule` -> `.himan/dev/rule/<name>`
  - `command` -> `.himan/dev/command/<name>`
  - `skill` -> `.himan/dev/skill/<name>`
- lock 文件：`install <type> <name[@version]>` 会写入 `himan.lock`；`himan install`（无参数）会按 lock 批量恢复安装。
- 安装模式：默认 `--mode link` 使用软链；也可用 `--mode copy` 将资源复制到目标 agent 目录，lock 会记录并复现该模式。
- 默认 agent：`agent use <agent>` 默认写当前项目 `.himan/config.json`；加 `--global` 写入 `~/.himan/config.json`。当前项目配置优先于全局配置。

版本以 Git tag 为准，格式：`rule/my-rule@1.0.0`。更多设计见 [docs/mvp](./docs/mvp/README.md)。

## 常用命令

### 1) source（数据源）

| 命令                          | 说明                                             |
| ----------------------------- | ------------------------------------------------ |
| `init <git_url>`              | 初始化默认源（当前为 Git）并写入 `~/.himan/config.json` |
| `source add <name> <git_url>` | 添加命名 Git 源                                    |
| `source use <name>`           | 切换默认源                                          |
| `source list [--json]`        | 查看已配置源（标记当前 default）                     |
| `source init <git_url>`       | 与 `init` 等价，便于统一走 `himan source ...` 入口     |

等价独立命令：

- `himan-source init <git_url>`
- `himan-source add <name> <git_url>`
- `himan-source use <name>`
- `himan-source list [--json]`

### 2) resource（资源）

| 命令                             | 说明                                                                                |
| -------------------------------- | ----------------------------------------------------------------------------------- |
| `list [type] [--agent a,b] [--json]` | 列出当前 default source 的资源；可按 agent 过滤；`type` 默认 `rule` |
| `history <type> <name> [--json]` | 按 tag 查看版本历史                                                                 |
| `create <type> <name>`           | 脚手架；常用选项：`--description`、`--agent a,b`、`--dry-run`、`--force`、`--json` |

### 3) project（当前项目）

| 命令                              | 说明                                                      |
| --------------------------------- | --------------------------------------------------------- |
| `install [type] [name[@version]] [--agent a,b] [--mode link\|copy]` | 有参数时安装指定资源；**无参数**时按 `himan.lock` 批量安装；可覆盖安装目标 agent 或安装模式 |
| `dev <type> <name>`               | 切换到开发态，并按安装模式将项目目标指向或复制自 `.himan/dev/...` |
| `uninstall <type> <name>`         | 从项目移除安装目标，并同步删除 `himan.lock` 条目           |
| `publish <type> <name>`           | 默认 `--patch`；可选 `--minor` / `--major`（勿同时使用多个） |

### 4) agent（默认 Agent）

| 命令 | 说明 |
|------|------|
| `agent list [--json]` | 查看支持的 agent |
| `agent use <agent[,agent]> [--project\|--global] [--json]` | 设置当前项目或全局默认 agent；默认 `--project` |
| `agent current [--json]` | 查看当前项目、全局和最终生效的默认 agent |
| `agent clear [--project\|--global] [--json]` | 清除当前项目或全局默认 agent；默认 `--project` |

也可使用分组命令（与上面等价）：

- `himan resource list|history|create ...`
- `himan-resource list|history|create ...`（兼容保留：也可执行 install/dev/uninstall/publish）
- `himan project install|dev|uninstall|publish ...`
- `himan-project install|dev|uninstall|publish ...`
- `himan agent list|use|current|clear ...`

说明：资源与项目相关命令统一使用 `--agent` 指定目标 Agent。
若未显式传 `--agent`，`create` / `install` 会使用当前项目默认 agent、全局默认 agent、资源 metadata 或内置默认 `cursor` 中最合适的一项；`dev` 会优先使用 lock 中记录的 agent。

`publish` 优先使用项目里 `.himan/dev` 对应目录，否则用源仓库里对应目录。需要可推送的 Git 权限。若该资源已在 lock 中，发布后会同步更新 lock 版本。

`--json` 模式下，失败时会输出机器可读错误 JSON（`stderr`）。错误码定义见 [docs/error-codes.md](./docs/error-codes.md)。

多源说明：当前是「**多来源可配置，单来源生效**」模型。业务命令（`list/install/history/dev/publish`）只作用于当前 default source；切换后再执行命令。

## 当前范围

- 源：**仅 Git**（`init`）。Registry 适配器已预留，尚未实现。
- 包定位：当前仅承诺 CLI 使用，不提供稳定的 Node.js 程序化 API。

## FAQ

**Q: 为什么执行 `source add` 之后，`list` 结果没有变化？**  
A: `source add` 只是在本地新增一个可用来源，不会自动切换当前生效来源。当前模型是“多来源可配置，单来源生效（default）”。  
请执行：

```bash
himan source use <name>
himan source list
```

确认目标来源已成为 `(default)` 后，再执行 `list/install/history/dev/publish`。

**Q: `list` 和 `source list` 有什么区别？**  
A: `source list` 查看「我配置了哪些来源」；`list` 查看「当前 default source 里有哪些资源」。

## 开发与维护

源码开发、测试和 npm 发包流程见 [docs/development.md](./docs/development.md)。
