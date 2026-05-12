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
- 加 `--global` 时会安装到用户级 agent 目录，并仍按当前项目生效的 agent 选择目标：
  - `cursor` -> `~/.cursor/{rules|commands|skills}/<name>`
  - `claude-code` -> `~/.claude/{rules|commands|skills}/<name>`
  - `codex` -> `~/.agents/{rules|commands|skills}/<name>`
  - `openclaw` -> `~/.openclaw/{rules|commands|skills}/<name>`
- 开发态目录：
  - `rule` -> `.himan/dev/rule/<name>`
  - `command` -> `.himan/dev/command/<name>`
  - `skill` -> `.himan/dev/skill/<name>`
- lock 文件：项目安装 `install <type> <name[@version]>` 会写入 `himan.lock`，记录 source、精确版本、agent 和安装模式；`himan install`（无参数）会按 lock 记录的 source 批量恢复安装，不受当前 default source 切换影响。`--global` 安装不写当前项目的 `himan.lock`。
- 安装模式：默认 `--mode copy` 将资源复制到目标 agent 目录；也可用 `--mode link` 使用软链，lock 会记录并复现该模式。
- 默认 agent：`agent use <agent>` 默认写当前项目 `.himan/config.json`；加 `--global` 写入 `~/.himan/config.json`。当前项目配置优先于全局配置。

版本以 Git tag 为准，格式：`rule/my-rule@1.0.0`。更多设计见 [docs/mvp](./docs/mvp/README.md)。

## Source 仓库结构

himan Git source 是一个普通 Git 仓库，推荐先维护仓库级 `README.md` 和 `CHANGELOG.md`，用于说明整个资源集合，而不是把说明文档塞进每个 agent 的最终消费目录。

```text
your-himan-source/
  README.md
  CHANGELOG.md
  rules/
    my-rule/
      himan.yaml
      content.md
  commands/
    my-command/
      himan.yaml
      content.md
  skills/
    my-skill/
      himan.yaml
      SKILL.md
```

- `README.md`：source 仓库入口文档，建议记录资源目录说明、推荐安装方式、默认 agent 策略、常用资源索引和维护约定。
- `CHANGELOG.md`：source 仓库级变更记录，建议记录新增、变更、废弃、移除的资源，以及重要版本发布说明。
- `rules/`、`commands/`、`skills/`：按资源类型分组；每个子目录是一份 himan 资源。
- `himan.yaml`：可选资源元数据；存在时供 himan 扫描、校验、读取入口和默认 agent。
- `content.md` / `SKILL.md`：资源主入口；没有 `himan.yaml` 时，`rule` / `command` 默认使用 `content.md`，`skill` 默认使用 `SKILL.md`。

可通过 `himan source init-docs` 为当前 default source 生成根目录文档模板；默认只创建缺失文件，`--force` 会覆盖已有 `README.md` / `CHANGELOG.md`，并把当前 source 中已有的 `rule`、`command`、`skill` 整理进 README 资源索引和 CHANGELOG 初始条目；资源引用会优先带上 Git tag 中的最新 semver 版本；对于尚未补齐 `himan.yaml` 的资源，会按默认入口识别，skill 还会读取 `skills/<name>/SKILL.md` front matter。`--dry-run` 可预览结果。有实际文件变更时，命令会提交并 push 到当前 Git source。

`himan create` 和 `himan publish` 会自动维护 source 根目录文档：

- `README.md`：只更新 `<!-- himan:resources:start -->` 和 `<!-- himan:resources:end -->` 之间的资源索引；如果没有 marker，会在文件末尾追加一个受控资源索引区。
- `CHANGELOG.md`：向 `[Unreleased]` 下追加资源变更条目；`create` 记录 `Added`，`publish` 记录 `Changed` / published version。

仓库根目录的 `README.md` 和 `CHANGELOG.md` 不会被安装到 agent 目录；agent 只消费被安装的具体资源目录。当前安装实现会 materialize 资源目录本身，因此对 Cursor 这类要求特定单文件格式的 agent，资源目录内应避免放入会干扰识别的额外文件。

## 常用命令

### 1) source（数据源）

| 命令                          | 说明                                             |
| ----------------------------- | ------------------------------------------------ |
| `init <git_url>`              | 初始化默认源（当前为 Git）并写入 `~/.himan/config.json` |
| `source add <name> <git_url>` | 添加命名 Git 源                                    |
| `source use <name>`           | 切换默认源                                          |
| `source list [--json]`        | 查看已配置源（标记当前 default）                     |
| `source init-docs [--force] [--dry-run] [--json]` | 为当前 default source 生成仓库级 README/CHANGELOG |
| `source init <git_url>`       | 与 `init` 等价，便于统一走 `himan source ...` 入口     |

等价独立命令：

- `himan-source init <git_url>`
- `himan-source add <name> <git_url>`
- `himan-source use <name>`
- `himan-source list [--json]`
- `himan-source init-docs [--force] [--dry-run] [--json]`

### 2) resource（资源）

| 命令                             | 说明                                                                                |
| -------------------------------- | ----------------------------------------------------------------------------------- |
| `list [type] [--agent a,b] [--brief] [--installed] [--json]` | 默认列出当前 default source 的资源；未传 `type` 时按 `rule`/`command`/`skill` 分组展示全部资源；可按 agent 过滤；默认显示描述，`--brief` 可隐藏描述；`--installed` 改为查看当前项目 `himan.lock` 中的已安装资源 |
| `history <type> <name> [--json]` | 按 tag 查看版本历史                                                                 |
| `create <type> <name>`           | 脚手架；常用选项：`--description`、`--agent a,b`、`--dry-run`、`--force`、`--json` |

### 3) project（当前项目）

| 命令                              | 说明                                                      |
| --------------------------------- | --------------------------------------------------------- |
| `list [type] [--agent a,b] [--json]` | 查看当前项目 `himan.lock` 中记录的已安装资源；未传 `type` 时按 `rule`/`command`/`skill` 分组展示 |
| `install [type] [name[@version]] [--global] [--agent a,b] [--mode link\|copy]` | 有参数时从当前 default source 安装指定资源；**无参数**时按 `himan.lock` 记录的 source 批量安装；加 `--global` 时安装到用户级 agent 目录且不写项目 lock；可覆盖安装目标 agent 或安装模式 |
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
- `himan project list|install|dev|uninstall|publish ...`
- `himan-project list|install|dev|uninstall|publish ...`
- `himan agent list|use|current|clear ...`

说明：资源与项目相关命令统一使用 `--agent` 指定目标 Agent。
若未显式传 `--agent`，`create` / `install` 会使用当前项目默认 agent、全局默认 agent、资源 metadata 或内置默认 `cursor` 中最合适的一项；`dev` 会优先使用 lock 中记录的 agent。`install --global` 会优先复用当前项目 lock 里该资源的 agent，未命中时再使用默认 install 解析顺序，但目标根目录是用户 home 下对应 agent 目录。

`publish` 优先使用项目里 `.himan/dev` 对应目录，否则用源仓库里对应目录。若资源目录包含 `himan.yaml`，发布前会校验元数据与入口文件；若没有 `himan.yaml`，则按默认入口推断最小元数据并发布，不会强制创建 `himan.yaml`。若待发布资源内容与最新已发布版本一致，则以 `E_PUBLISH_NO_CHANGES` 终止发布。发布需要可推送的 Git 权限。发布 commit 会包含资源目录以及自动维护的 source 根目录 `README.md` / `CHANGELOG.md`。发布成功后会从新版本 store 以 `copy` 模式重新安装到项目目标、更新 lock，并删除对应 `.himan/dev/<type>/<name>` 开发目录。

`--json` 模式下，失败时会输出机器可读错误 JSON（`stderr`）。错误码定义见 [docs/error-codes.md](./docs/error-codes.md)。

多源说明：当前是「**多来源可配置，单来源生效**」模型。显式资源命令（`list/install <type> .../history/dev/publish`）作用于当前 default source；`himan install` 无参数恢复时使用 `himan.lock` 中记录的 source。

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
